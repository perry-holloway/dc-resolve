package probes

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"dce-diag/pkg/ocp"
)

// NVMeHealth is the normalized SMART/health telemetry for a single NVMe
// device, sourced from smartctl's NVMe SMART health information log.
type NVMeHealth struct {
	Device          string `json:"device"`
	ModelName       string `json:"model_name,omitempty"`
	SerialNumber    string `json:"serial_number,omitempty"`
	CriticalWarning int    `json:"critical_warning"`
	PercentageUsed  int    `json:"percentage_used"`
	MediaErrors     int64  `json:"media_errors"`
	AvailableSpare  int    `json:"available_spare"`
	SpareThreshold  int    `json:"available_spare_threshold"`
	Degraded        bool   `json:"degraded"`
	DegradedReason  string `json:"degraded_reason,omitempty"`
}

// NVMeAuditOpts configures AuditNVMeHealth thresholds.
type NVMeAuditOpts struct {
	// MaxPercentageUsed marks a drive degraded once its reported wear
	// indicator (NVMe SMART log's percentage_used) reaches this value.
	// Defaults to 90 when zero or negative.
	MaxPercentageUsed int
}

type smartctlScanDevice struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type smartctlScanOutput struct {
	Devices []smartctlScanDevice `json:"devices"`
}

type smartctlHealthLog struct {
	CriticalWarning         int   `json:"critical_warning"`
	AvailableSpare          int   `json:"available_spare"`
	AvailableSpareThreshold int   `json:"available_spare_threshold"`
	PercentageUsed          int   `json:"percentage_used"`
	MediaErrors             int64 `json:"media_errors"`
	NumErrLogEntries        int64 `json:"num_err_log_entries"`
}

type smartctlDeviceOutput struct {
	ModelName    string             `json:"model_name"`
	SerialNumber string             `json:"serial_number"`
	NVMeLog      *smartctlHealthLog `json:"nvme_smart_health_information_log"`
}

// AuditNVMeHealth scans for NVMe devices with smartctl and evaluates each
// device's SMART health log for critical warnings, recorded media errors,
// and wear beyond the configured threshold. It requires smartmontools
// (`smartctl`) to be installed; it reports CANNOT_RUN when the tool is
// unavailable or a scan/query fails outright.
func AuditNVMeHealth(opts NVMeAuditOpts) ocp.DiagnosticResult {
	threshold := opts.MaxPercentageUsed
	if threshold <= 0 {
		threshold = 90
	}

	smartctlPath, err := exec.LookPath("smartctl")
	if err != nil {
		return nvmeResult(ocp.StatusCannotRun, "", "smartctl is not installed or not on PATH", nil)
	}

	scanOutput, scanErr := exec.Command(smartctlPath, "--scan-open", "--json").CombinedOutput()
	if scanErr != nil && len(scanOutput) == 0 {
		return nvmeResult(ocp.StatusCannotRun, "", fmt.Sprintf("failed to scan for NVMe devices: %v", scanErr), nil)
	}

	devices, err := parseSmartctlScan(scanOutput)
	if err != nil {
		return nvmeResult(ocp.StatusCannotRun, "", fmt.Sprintf("failed to parse smartctl scan output: %v", err), map[string]string{
			"raw_output": strings.TrimSpace(string(scanOutput)),
		})
	}
	if len(devices) == 0 {
		return nvmeResult(ocp.StatusPass, "", "", map[string]any{
			"devices": []NVMeHealth{},
			"summary": "no NVMe devices detected",
		})
	}

	healths := make([]NVMeHealth, 0, len(devices))
	var failing []NVMeHealth
	for _, device := range devices {
		deviceOutput, deviceErr := exec.Command(smartctlPath, "-a", "-j", device).CombinedOutput()
		if deviceErr != nil && len(deviceOutput) == 0 {
			health := NVMeHealth{
				Device:         device,
				Degraded:       true,
				DegradedReason: fmt.Sprintf("failed to query smartctl: %v", deviceErr),
			}
			healths = append(healths, health)
			failing = append(failing, health)
			continue
		}

		health, err := parseSmartctlHealth(device, deviceOutput, threshold)
		if err != nil {
			health = NVMeHealth{
				Device:         device,
				Degraded:       true,
				DegradedReason: fmt.Sprintf("failed to parse smartctl output: %v", err),
			}
		}
		healths = append(healths, health)
		if health.Degraded {
			failing = append(failing, health)
		}
	}

	if len(failing) > 0 {
		return nvmeResult(
			ocp.StatusFail,
			fruForNVMeDevice(failing[0].Device),
			fmt.Sprintf("%d of %d NVMe device(s) reported degraded SMART health", len(failing), len(healths)),
			map[string]any{"devices": healths},
		)
	}

	return nvmeResult(ocp.StatusPass, "", "", map[string]any{
		"devices": healths,
		"summary": "all NVMe devices report healthy SMART telemetry",
	})
}

func parseSmartctlScan(output []byte) ([]string, error) {
	var scan smartctlScanOutput
	if err := json.Unmarshal(output, &scan); err != nil {
		return nil, err
	}
	var devices []string
	for _, device := range scan.Devices {
		if strings.EqualFold(device.Type, "nvme") {
			devices = append(devices, device.Name)
		}
	}
	return devices, nil
}

func parseSmartctlHealth(device string, output []byte, maxPercentageUsed int) (NVMeHealth, error) {
	var parsed smartctlDeviceOutput
	if err := json.Unmarshal(output, &parsed); err != nil {
		return NVMeHealth{}, err
	}
	if parsed.NVMeLog == nil {
		return NVMeHealth{}, fmt.Errorf("smartctl output for %s did not include an NVMe SMART health information log", device)
	}

	health := NVMeHealth{
		Device:          device,
		ModelName:       parsed.ModelName,
		SerialNumber:    parsed.SerialNumber,
		CriticalWarning: parsed.NVMeLog.CriticalWarning,
		PercentageUsed:  parsed.NVMeLog.PercentageUsed,
		MediaErrors:     parsed.NVMeLog.MediaErrors,
		AvailableSpare:  parsed.NVMeLog.AvailableSpare,
		SpareThreshold:  parsed.NVMeLog.AvailableSpareThreshold,
	}

	switch {
	case health.CriticalWarning != 0:
		health.Degraded = true
		health.DegradedReason = fmt.Sprintf("critical_warning bitmask is 0x%x", health.CriticalWarning)
	case health.MediaErrors > 0:
		health.Degraded = true
		health.DegradedReason = fmt.Sprintf("%d media error(s) recorded", health.MediaErrors)
	case health.PercentageUsed >= maxPercentageUsed:
		health.Degraded = true
		health.DegradedReason = fmt.Sprintf("percentage_used %d%% at or above threshold %d%%", health.PercentageUsed, maxPercentageUsed)
	case health.SpareThreshold > 0 && health.AvailableSpare < health.SpareThreshold:
		health.Degraded = true
		health.DegradedReason = fmt.Sprintf("available_spare %d%% below threshold %d%%", health.AvailableSpare, health.SpareThreshold)
	}

	return health, nil
}

func fruForNVMeDevice(device string) string {
	name := strings.TrimPrefix(device, "/dev/")
	name = strings.ReplaceAll(name, "/", "_")
	return "NVME_" + strings.ToUpper(name)
}

func nvmeResult(status ocp.Status, fru, reason string, details any) ocp.DiagnosticResult {
	return ocp.DiagnosticResult{
		TestName:      "NVMe_SMART_Health",
		Timestamp:     time.Now().UTC(),
		Status:        status,
		FRULocation:   fru,
		FailureReason: reason,
		Details:       details,
	}
}
