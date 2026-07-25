package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"dce-diag/pkg/ocp"
	"dce-diag/pkg/probes"
)

func main() {
	runMemory := flag.Bool("test-memory", false, "run SAT or portable memory stress test")
	runPCIe := flag.Bool("test-pcie", false, "audit PCIe topology and link degradation")
	memoryMB := flag.Int("mem-mb", 1024, "RAM size in MB to stress test")
	memorySeconds := flag.Int("mem-sec", 30, "duration in seconds for memory test")
	targetChannel := flag.String("target-channel", "", "optional DIMM channel or board label")
	flag.Parse()

	if !*runMemory && !*runPCIe {
		fmt.Fprintln(os.Stderr, "no diagnostic selected; use --test-memory and/or --test-pcie")
		os.Exit(2)
	}

	exitCode := 0
	if *runMemory {
		timeout := time.Duration(*memorySeconds+10) * time.Second
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()

		result := probes.RunSatStress(ctx, probes.MemoryTestOpts{
			MemoryMB:      *memoryMB,
			Duration:      time.Duration(*memorySeconds) * time.Second,
			TargetChannel: *targetChannel,
		})
		exitCode = writeResult(result, exitCode)
	}

	if *runPCIe {
		exitCode = writeResult(probes.AuditPCIeBus(nil), exitCode)
	}

	os.Exit(exitCode)
}

func writeResult(result ocp.DiagnosticResult, exitCode int) int {
	if err := ocp.WriteResult(os.Stdout, result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if result.Status == ocp.StatusCannotRun {
		return 2
	}
	if result.Status == ocp.StatusFail && exitCode == 0 {
		return 1
	}
	return exitCode
}
