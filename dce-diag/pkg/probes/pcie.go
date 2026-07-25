package probes

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"

	"dce-diag/pkg/ocp"
)

type PCIeDevice struct {
	Address     string `json:"address"`
	Description string `json:"description"`
	LinkSpeed   string `json:"link_speed,omitempty"`
	LinkWidth   string `json:"link_width,omitempty"`
	MaxSpeed    string `json:"max_speed,omitempty"`
	MaxWidth    string `json:"max_width,omitempty"`
	Degraded    bool   `json:"degraded"`
}

var linkPattern = regexp.MustCompile(`Lnk(?:Cap|Sta):.*?Speed\s+([^,\s]+).*?Width\s+(x\d+)`)

func AuditPCIeBus(expectedDevices []string) ocp.DiagnosticResult {
	if runtime.GOOS == "darwin" {
		return auditDarwinPCIe(expectedDevices)
	}

	output, err := exec.Command("lspci", "-vvv").CombinedOutput()
	if err != nil {
		return pcieResult(ocp.StatusCannotRun, "", fmt.Sprintf("failed to execute lspci: %v", err), map[string]string{
			"raw_output": strings.TrimSpace(string(output)),
		})
	}

	devices, missing := parsePCIeOutput(string(output), expectedDevices)
	var degraded []PCIeDevice
	for _, device := range devices {
		if device.Degraded {
			degraded = append(degraded, device)
		}
	}
	if len(degraded) > 0 || len(missing) > 0 {
		return pcieResult(
			ocp.StatusFail,
			"RISER_CARD_OR_BUS",
			fmt.Sprintf("found %d degraded and %d missing PCIe device(s)", len(degraded), len(missing)),
			map[string]any{"degraded_devices": degraded, "missing_devices": missing},
		)
	}
	return pcieResult(ocp.StatusPass, "", "", map[string]any{
		"devices": devices,
		"summary": "all PCIe links operating at full negotiated width and speed",
	})
}

func auditDarwinPCIe(expectedDevices []string) ocp.DiagnosticResult {
	output, err := exec.Command("system_profiler", "SPPCIDataType", "-json").CombinedOutput()
	if err != nil {
		return pcieResult(ocp.StatusCannotRun, "", fmt.Sprintf("failed to execute system_profiler: %v", err), map[string]string{
			"raw_output": strings.TrimSpace(string(output)),
		})
	}

	var payload any
	if err := json.Unmarshal(output, &payload); err != nil {
		return pcieResult(ocp.StatusCannotRun, "", fmt.Sprintf("failed to parse system_profiler JSON: %v", err), nil)
	}

	devices := collectDarwinPCIeDevices(payload)
	lowerOutput := strings.ToLower(string(output))
	var missing []string
	for _, expected := range expectedDevices {
		if !strings.Contains(lowerOutput, strings.ToLower(expected)) {
			missing = append(missing, expected)
		}
	}
	if len(missing) > 0 {
		return pcieResult(ocp.StatusFail, "PCIE_DEVICE", fmt.Sprintf("found %d missing PCIe device(s)", len(missing)), map[string]any{
			"devices":         devices,
			"missing_devices": missing,
		})
	}
	return pcieResult(ocp.StatusPass, "", "", map[string]any{
		"devices":  devices,
		"platform": runtime.GOOS + "/" + runtime.GOARCH,
		"summary":  "macOS PCIe inventory completed; maximum link capability is reported when exposed by system_profiler",
	})
}

func collectDarwinPCIeDevices(value any) []PCIeDevice {
	var devices []PCIeDevice
	var walk func(any)
	walk = func(current any) {
		switch typed := current.(type) {
		case []any:
			for _, item := range typed {
				walk(item)
			}
		case map[string]any:
			name, hasName := typed["_name"].(string)
			if hasName {
				device := PCIeDevice{Description: name}
				for key, raw := range typed {
					text, ok := raw.(string)
					if !ok {
						continue
					}
					lowerKey := strings.ToLower(key)
					switch {
					case strings.Contains(lowerKey, "link_width") || strings.Contains(lowerKey, "pcie_width"):
						device.LinkWidth = text
					case strings.Contains(lowerKey, "link_speed") || strings.Contains(lowerKey, "pcie_speed"):
						device.LinkSpeed = text
					case strings.Contains(lowerKey, "device_id"):
						device.Address = text
					}
				}
				devices = append(devices, device)
			}
			for _, item := range typed {
				walk(item)
			}
		}
	}
	walk(value)
	return devices
}

func parsePCIeOutput(output string, expected []string) ([]PCIeDevice, []string) {
	var blocks []string
	var current []string
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			if len(current) > 0 {
				blocks = append(blocks, strings.Join(current, "\n"))
			}
			current = []string{line}
			continue
		}
		if len(current) > 0 {
			current = append(current, line)
		}
	}
	if len(current) > 0 {
		blocks = append(blocks, strings.Join(current, "\n"))
	}

	devices := make([]PCIeDevice, 0, len(blocks))
	lowerOutput := strings.ToLower(output)

	for _, block := range blocks {
		lines := strings.Split(block, "\n")
		if len(lines) == 0 {
			continue
		}
		header := strings.TrimSpace(lines[0])
		parts := strings.SplitN(header, " ", 2)
		device := PCIeDevice{Address: parts[0]}
		if len(parts) == 2 {
			device.Description = parts[1]
		}
		for _, line := range lines[1:] {
			match := linkPattern.FindStringSubmatch(line)
			if len(match) != 3 {
				continue
			}
			if strings.Contains(line, "LnkCap:") {
				device.MaxSpeed, device.MaxWidth = match[1], match[2]
			}
			if strings.Contains(line, "LnkSta:") {
				device.LinkSpeed, device.LinkWidth = match[1], match[2]
				device.Degraded = strings.Contains(strings.ToLower(line), "downgraded")
			}
		}
		devices = append(devices, device)
	}

	var missing []string
	for _, expectedDevice := range expected {
		if !strings.Contains(lowerOutput, strings.ToLower(expectedDevice)) {
			missing = append(missing, expectedDevice)
		}
	}
	return devices, missing
}

func pcieResult(status ocp.Status, fru, reason string, details any) ocp.DiagnosticResult {
	return ocp.DiagnosticResult{
		TestName:      "PCIe_Topology_Check",
		Timestamp:     time.Now().UTC(),
		Status:        status,
		FRULocation:   fru,
		FailureReason: reason,
		Details:       details,
	}
}
