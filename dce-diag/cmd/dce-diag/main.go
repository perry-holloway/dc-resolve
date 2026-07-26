package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"dce-diag/pkg/ocp"
	"dce-diag/pkg/probes"
	"dce-diag/pkg/tui"
)

func main() {
	runMemory := flag.Bool("test-memory", false, "run SAT or portable memory stress test")
	runPCIe := flag.Bool("test-pcie", false, "audit PCIe topology and link degradation")
	runThermal := flag.Bool("test-thermal", false, "audit Redfish temperatures, fans, power supplies, and voltage rails")
	runNVMe := flag.Bool("test-nvme", false, "audit NVMe SMART health via smartctl")
	showTUI := flag.Bool("tui", false, "show completed results in the interactive field dashboard")
	memoryMB := flag.Int("mem-mb", 1024, "RAM size in MB to stress test")
	memorySeconds := flag.Int("mem-sec", 30, "duration in seconds for memory test")
	targetChannel := flag.String("target-channel", "", "optional DIMM channel or board label")
	bmcURL := flag.String("bmc-url", "", "Redfish BMC base URL, for example https://192.0.2.10")
	bmcUser := flag.String("bmc-user", "", "Redfish BMC username")
	bmcSystemID := flag.String("bmc-system-id", "system", "Redfish Systems resource ID")
	bmcChassisID := flag.String("bmc-chassis-id", "chassis", "Redfish Chassis resource ID")
	nvmeMaxPercentageUsed := flag.Int("nvme-max-percentage-used", 90, "mark an NVMe device degraded once percentage_used reaches this value")
	nvmeCommandTimeout := flag.Int("nvme-command-timeout-sec", 20, "timeout for each smartctl command")
	nvmeAllowNoDevices := flag.Bool("nvme-allow-no-devices", false, "treat an empty NVMe inventory as PASS")
	flag.Parse()

	if !*runMemory && !*runPCIe && !*runThermal && !*runNVMe {
		fmt.Fprintln(os.Stderr, "no diagnostic selected; use --test-memory, --test-pcie, --test-thermal, and/or --test-nvme")
		os.Exit(2)
	}

	exitCode := 0
	var results []ocp.DiagnosticResult
	if *runMemory {
		timeout := time.Duration(*memorySeconds+10) * time.Second
		ctx, cancel := context.WithTimeout(context.Background(), timeout)

		result := probes.RunSatStress(ctx, probes.MemoryTestOpts{
			MemoryMB:      *memoryMB,
			Duration:      time.Duration(*memorySeconds) * time.Second,
			TargetChannel: *targetChannel,
		})
		cancel()
		results = append(results, result)
		exitCode = exitCodeForResult(result, exitCode)
	}

	if *runPCIe {
		result := probes.AuditPCIeBus(nil)
		results = append(results, result)
		exitCode = exitCodeForResult(result, exitCode)
	}

	if *runThermal {
		var result ocp.DiagnosticResult
		if *bmcURL == "" {
			result = ocp.DiagnosticResult{
				TestName:      "Thermal_Sensors_Check",
				Timestamp:     time.Now().UTC(),
				Status:        ocp.StatusCannotRun,
				FailureReason: "--bmc-url is required for --test-thermal",
			}
		} else {
			bmc := probes.NewBMCClient(*bmcURL, *bmcUser, os.Getenv("BMC_PASSWORD"), *bmcSystemID)
			bmc.ChassisID = *bmcChassisID
			result = bmc.AuditThermalSensors()
		}
		results = append(results, result)
		exitCode = exitCodeForResult(result, exitCode)
	}

	if *runNVMe {
		result := probes.AuditNVMeHealth(probes.NVMeAuditOpts{
			MaxPercentageUsed: *nvmeMaxPercentageUsed,
			CommandTimeout:    time.Duration(*nvmeCommandTimeout) * time.Second,
			AllowNoDevices:    *nvmeAllowNoDevices,
		})
		results = append(results, result)
		exitCode = exitCodeForResult(result, exitCode)
	}

	if *showTUI {
		if err := tui.Run(results, os.Stdin, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
	} else {
		for _, result := range results {
			if err := ocp.WriteResult(os.Stdout, result); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(2)
			}
		}
	}

	os.Exit(exitCode)
}

func exitCodeForResult(result ocp.DiagnosticResult, exitCode int) int {
	if result.Status == ocp.StatusCannotRun {
		return 2
	}
	if result.Status == ocp.StatusFail && exitCode == 0 {
		return 1
	}
	return exitCode
}
