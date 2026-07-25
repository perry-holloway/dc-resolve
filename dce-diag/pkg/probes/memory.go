package probes

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"dce-diag/pkg/ocp"
)

type MemoryTestOpts struct {
	MemoryMB      int
	Duration      time.Duration
	TargetChannel string
}

var dimmPattern = regexp.MustCompile(`(?i)\b(DIMM_[A-Z0-9]+|CPU\d+_DIMM\d+)\b`)

func RunSatStress(ctx context.Context, opts MemoryTestOpts) ocp.DiagnosticResult {
	if opts.MemoryMB <= 0 || opts.Duration <= 0 {
		return result(ocp.StatusCannotRun, "", "memory and duration must be greater than zero", nil)
	}

	satPath, err := exec.LookPath("sat")
	if err != nil {
		return runPortableMemoryTest(ctx, opts)
	}

	args := []string{"-M", strconv.Itoa(opts.MemoryMB), "-s", strconv.Itoa(int(opts.Duration.Seconds()))}
	if opts.TargetChannel != "" {
		args = append(args, "--target_channel", opts.TargetChannel)
	}

	cmd := exec.CommandContext(ctx, satPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	output := strings.TrimSpace(stdout.String() + "\n" + stderr.String())
	if ctx.Err() != nil {
		return result(ocp.StatusCannotRun, "", "SAT test timed out before completion", map[string]any{
			"tested_mb": opts.MemoryMB,
			"duration":  opts.Duration.String(),
		})
	}
	if err != nil {
		return result(ocp.StatusFail, parseSatDimmFailure(output), fmt.Sprintf("memory hardware error detected during stress test: %v", err), map[string]string{
			"raw_output": output,
		})
	}

	return result(ocp.StatusPass, "", "", map[string]any{
		"tested_mb": opts.MemoryMB,
		"duration":  opts.Duration.String(),
		"engine":    "sat",
	})
}

func runPortableMemoryTest(ctx context.Context, opts MemoryTestOpts) (res ocp.DiagnosticResult) {
	defer func() {
		if recovered := recover(); recovered != nil {
			res = result(ocp.StatusCannotRun, "", fmt.Sprintf("unable to allocate %d MB: %v", opts.MemoryMB, recovered), map[string]any{
				"engine":   "portable-pattern-verifier",
				"platform": runtime.GOOS + "/" + runtime.GOARCH,
			})
		}
	}()

	const mib = 1024 * 1024
	memory := make([]byte, opts.MemoryMB*mib)
	deadline := time.Now().Add(opts.Duration)
	var passes int

	for time.Now().Before(deadline) {
		pattern := byte(0xA5 ^ byte(passes))
		for index := range memory {
			memory[index] = pattern ^ byte(index)
		}
		for index, value := range memory {
			expected := pattern ^ byte(index)
			if value != expected {
				return result(ocp.StatusFail, opts.TargetChannel, fmt.Sprintf("memory verification mismatch at byte %d", index), map[string]any{
					"expected": expected,
					"actual":   value,
					"engine":   "portable-pattern-verifier",
				})
			}
			if index%(8*mib) == 0 {
				select {
				case <-ctx.Done():
					return result(ocp.StatusCannotRun, "", "memory test cancelled or timed out", map[string]any{
						"passes": passes,
						"engine": "portable-pattern-verifier",
					})
				default:
				}
			}
		}
		passes++
	}

	runtime.KeepAlive(memory)
	return result(ocp.StatusPass, "", "", map[string]any{
		"tested_mb": opts.MemoryMB,
		"duration":  opts.Duration.String(),
		"passes":    passes,
		"engine":    "portable-pattern-verifier",
		"platform":  runtime.GOOS + "/" + runtime.GOARCH,
		"note":      "portable mode verifies memory patterns but cannot map ECC telemetry to a physical DIMM",
	})
}

func parseSatDimmFailure(log string) string {
	match := dimmPattern.FindString(log)
	if match == "" {
		return "UNKNOWN_DIMM_SLOT"
	}
	return strings.ToUpper(match)
}

func result(status ocp.Status, fru, reason string, details any) ocp.DiagnosticResult {
	return ocp.DiagnosticResult{
		TestName:      "Memory_SAT_BurnIn",
		Timestamp:     time.Now().UTC(),
		Status:        status,
		FRULocation:   fru,
		FailureReason: reason,
		Details:       details,
	}
}
