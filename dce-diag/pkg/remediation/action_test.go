package remediation

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"dce-diag/pkg/ocp"
	"dce-diag/pkg/probes"
)

func TestProcessFailureTriggersLocateLED(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	engine := NewRemediationEngine(probes.NewBMCClient(server.URL, "", "", "server-1"))
	err := engine.ProcessFailure("SN-123", ocp.DiagnosticResult{
		TestName:      "pcie_audit",
		Status:        ocp.StatusFail,
		FRULocation:   "Riser1/Slot2",
		FailureReason: "link width degraded",
	})
	if err != nil {
		t.Fatalf("ProcessFailure() error = %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("BMC calls = %d, want 1", calls.Load())
	}
}

func TestProcessFailureIgnoresPassingResult(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	engine := NewRemediationEngine(probes.NewBMCClient(server.URL, "", "", "server-1"))
	if err := engine.ProcessFailure("SN-123", ocp.DiagnosticResult{Status: ocp.StatusPass}); err != nil {
		t.Fatalf("ProcessFailure() error = %v", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("BMC calls = %d, want 0", calls.Load())
	}
}

func TestProcessFailureContinuesWhenBMCFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "BMC unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	engine := NewRemediationEngine(probes.NewBMCClient(server.URL, "", "", "server-1"))
	if err := engine.ProcessFailure("SN-123", ocp.DiagnosticResult{Status: ocp.StatusFail}); err != nil {
		t.Fatalf("ProcessFailure() error = %v, want non-fatal BMC failure", err)
	}
}
