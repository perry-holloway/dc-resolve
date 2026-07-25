package probes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSetLocateLED(t *testing.T) {
	var received map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			t.Errorf("method = %s, want PATCH", r.Method)
		}
		if r.URL.Path != "/redfish/v1/Systems/server-1" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := NewBMCClient(server.URL, "", "", "server-1")
	if err := client.SetLocateLED(true); err != nil {
		t.Fatalf("SetLocateLED() error = %v", err)
	}
	if received["IndicatorLED"] != "Blinking" {
		t.Errorf("IndicatorLED = %q, want Blinking", received["IndicatorLED"])
	}
}

func TestSetLocateLEDReturnsBMCError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unsupported", http.StatusBadRequest)
	}))
	defer server.Close()

	client := NewBMCClient(server.URL, "", "", "")
	if err := client.SetLocateLED(false); err == nil {
		t.Fatal("SetLocateLED() error = nil, want BMC error")
	}
}
