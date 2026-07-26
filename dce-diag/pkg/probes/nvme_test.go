package probes

import "testing"

func TestParseSmartctlScan(t *testing.T) {
	output := []byte(`{
		"devices": [
			{"name": "/dev/nvme0", "type": "nvme"},
			{"name": "/dev/sda", "type": "sat"}
		]
	}`)

	devices, err := parseSmartctlScan(output)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 1 || devices[0] != "/dev/nvme0" {
		t.Fatalf("unexpected devices: %#v", devices)
	}
}

func TestParseSmartctlScanNoDevices(t *testing.T) {
	devices, err := parseSmartctlScan([]byte(`{"devices": []}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 0 {
		t.Fatalf("expected no devices, got: %#v", devices)
	}
}

func TestParseSmartctlHealthHealthy(t *testing.T) {
	output := []byte(`{
		"model_name": "Example NVMe SSD",
		"serial_number": "SN123",
		"nvme_smart_health_information_log": {
			"critical_warning": 0,
			"available_spare": 100,
			"available_spare_threshold": 10,
			"percentage_used": 12,
			"media_errors": 0
		}
	}`)

	health, err := parseSmartctlHealth("/dev/nvme0", output, 90)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if health.Degraded {
		t.Fatalf("expected healthy device, got degraded: %#v", health)
	}
	if health.ModelName != "Example NVMe SSD" || health.SerialNumber != "SN123" {
		t.Fatalf("unexpected identity fields: %#v", health)
	}
}

func TestParseSmartctlHealthMediaErrors(t *testing.T) {
	output := []byte(`{
		"nvme_smart_health_information_log": {
			"critical_warning": 0,
			"available_spare": 100,
			"available_spare_threshold": 10,
			"percentage_used": 40,
			"media_errors": 32
		}
	}`)

	health, err := parseSmartctlHealth("/dev/nvme0", output, 90)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !health.Degraded {
		t.Fatalf("expected degraded device: %#v", health)
	}
}

func TestParseSmartctlHealthCriticalWarning(t *testing.T) {
	output := []byte(`{
		"nvme_smart_health_information_log": {
			"critical_warning": 4,
			"available_spare": 100,
			"available_spare_threshold": 10,
			"percentage_used": 20,
			"media_errors": 0
		}
	}`)

	health, err := parseSmartctlHealth("/dev/nvme0", output, 90)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !health.Degraded {
		t.Fatalf("expected degraded device: %#v", health)
	}
}

func TestParseSmartctlHealthWornOut(t *testing.T) {
	output := []byte(`{
		"nvme_smart_health_information_log": {
			"critical_warning": 0,
			"available_spare": 100,
			"available_spare_threshold": 10,
			"percentage_used": 95,
			"media_errors": 0
		}
	}`)

	health, err := parseSmartctlHealth("/dev/nvme0", output, 90)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !health.Degraded {
		t.Fatalf("expected degraded device: %#v", health)
	}
}

func TestParseSmartctlHealthLowSpare(t *testing.T) {
	output := []byte(`{
		"nvme_smart_health_information_log": {
			"critical_warning": 0,
			"available_spare": 5,
			"available_spare_threshold": 10,
			"percentage_used": 20,
			"media_errors": 0
		}
	}`)

	health, err := parseSmartctlHealth("/dev/nvme0", output, 90)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !health.Degraded {
		t.Fatalf("expected degraded device: %#v", health)
	}
}

func TestParseSmartctlHealthMissingLog(t *testing.T) {
	if _, err := parseSmartctlHealth("/dev/nvme0", []byte(`{}`), 90); err == nil {
		t.Fatal("expected error for missing NVMe SMART health information log")
	}
}

func TestFruForNVMeDevice(t *testing.T) {
	if got := fruForNVMeDevice("/dev/nvme0"); got != "NVME_NVME0" {
		t.Fatalf("unexpected FRU label: %s", got)
	}
	if got := fruForNVMeDevice("/dev/nvme0n1"); got != "NVME_NVME0N1" {
		t.Fatalf("unexpected FRU label: %s", got)
	}
}
