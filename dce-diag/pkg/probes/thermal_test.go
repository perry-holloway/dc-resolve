package probes

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"dce-diag/pkg/ocp"
)

func TestAuditThermalSensorsPassesHealthyReadings(t *testing.T) {
	server := redfishSensorServer(t, "OK", 42)
	defer server.Close()

	client := NewBMCClient(server.URL, "", "", "system")
	client.ChassisID = "chassis-1"
	result := client.AuditThermalSensors()
	if result.Status != ocp.StatusPass {
		t.Fatalf("status = %s, reason = %s", result.Status, result.FailureReason)
	}
}

func TestAuditThermalSensorsFailsCriticalTemperature(t *testing.T) {
	server := redfishSensorServer(t, "Critical", 98)
	defer server.Close()

	client := NewBMCClient(server.URL, "", "", "system")
	client.ChassisID = "chassis-1"
	result := client.AuditThermalSensors()
	if result.Status != ocp.StatusFail {
		t.Fatalf("status = %s, want FAIL", result.Status)
	}
	if result.FRULocation != "CPU0 Temp" {
		t.Fatalf("FRU = %q", result.FRULocation)
	}
}

func TestAuditThermalSensorsCannotRun(t *testing.T) {
	client := NewBMCClient("http://127.0.0.1:1", "", "", "system")
	result := client.AuditThermalSensors()
	if result.Status != ocp.StatusCannotRun {
		t.Fatalf("status = %s, want CANNOT_RUN", result.Status)
	}
}

func redfishSensorServer(t *testing.T, health string, temperature float64) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/redfish/v1/Chassis/chassis-1/Thermal":
			fmt.Fprintf(w, `{"Temperatures":[{"Name":"CPU0 Temp","ReadingCelsius":%.1f,"UpperThresholdCritical":95,"Status":{"Health":%q}}],"Fans":[{"Name":"Fan1","Reading":9000,"LowerThresholdCritical":2000,"Status":{"Health":"OK"}}]}`, temperature, health)
		case "/redfish/v1/Chassis/chassis-1/Power":
			fmt.Fprint(w, `{"PowerSupplies":[{"Name":"PSU1","Status":{"Health":"OK"}}],"Voltages":[{"Name":"12V Rail","Reading":12.1,"LowerThresholdCritical":11.4,"UpperThresholdCritical":12.6,"Status":{"Health":"OK"}}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
}
