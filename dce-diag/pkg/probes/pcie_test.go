package probes

import "testing"

func TestParsePCIeOutput(t *testing.T) {
	output := `0000:3b:00.0 Ethernet controller: Example NIC
	LnkCap: Port #0, Speed 32GT/s, Width x16
	LnkSta: Speed 16GT/s (downgraded), Width x8 (downgraded)

0000:5d:00.0 Non-Volatile memory controller: Example NVMe
	LnkCap: Port #0, Speed 16GT/s, Width x4
	LnkSta: Speed 16GT/s, Width x4`

	devices, missing := parsePCIeOutput(output, []string{"Example NIC", "GPU"})
	if len(devices) != 2 || !devices[0].Degraded {
		t.Fatalf("unexpected devices: %#v", devices)
	}
	if len(missing) != 1 || missing[0] != "GPU" {
		t.Fatalf("unexpected missing devices: %#v", missing)
	}
}
