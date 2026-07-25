package probes

import (
	"context"
	"testing"
	"time"
)

func TestParseSatDimmFailure(t *testing.T) {
	tests := map[string]string{
		"EDAC error on channel 1 (DIMM_B1)": "DIMM_B1",
		"hardware fault at cpu0_dimm3":      "CPU0_DIMM3",
		"no physical slot in this output":   "UNKNOWN_DIMM_SLOT",
	}
	for input, expected := range tests {
		if actual := parseSatDimmFailure(input); actual != expected {
			t.Fatalf("parseSatDimmFailure(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestPortableMemoryTest(t *testing.T) {
	result := runPortableMemoryTest(context.Background(), MemoryTestOpts{
		MemoryMB: 1,
		Duration: 5 * time.Millisecond,
	})
	if result.Status != "PASS" {
		t.Fatalf("portable memory test returned %s: %s", result.Status, result.FailureReason)
	}
}
