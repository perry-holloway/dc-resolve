package collector

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"dce-diag/pkg/ocp"
)

type DiagnosticReport struct {
	ServerSerial string                 `json:"server_serial"`
	TrayID       string                 `json:"tray_id"`
	Results      []ocp.DiagnosticResult `json:"results"`
}

type Receipt struct {
	AcceptedAt time.Time `json:"accepted_at"`
	Status     string    `json:"status"`
	Failures   int       `json:"failures"`
}

type CollectorServer struct {
	OnReport func(DiagnosticReport, Receipt) error
}

func (s *CollectorServer) ReceiveReport(report DiagnosticReport) (Receipt, error) {
	if report.ServerSerial == "" || report.TrayID == "" || len(report.Results) == 0 {
		return Receipt{}, errors.New("server_serial, tray_id, and results are required")
	}

	receipt := Receipt{AcceptedAt: time.Now().UTC(), Status: "PASS"}
	for _, result := range report.Results {
		if result.Status == ocp.StatusFail {
			receipt.Failures++
			receipt.Status = "FAIL"
			log.Printf("[FAULT] test=%s server=%s tray=%s fru=%s reason=%s",
				result.TestName, report.ServerSerial, report.TrayID, result.FRULocation, result.FailureReason)
		}
	}
	if s.OnReport != nil {
		if err := s.OnReport(report, receipt); err != nil {
			return Receipt{}, err
		}
	}
	return receipt, nil
}

func (s *CollectorServer) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/reports", func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var report DiagnosticReport
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&report); err != nil {
			http.Error(w, "invalid diagnostic report", http.StatusBadRequest)
			return
		}
		receipt, err := s.ReceiveReport(report)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(receipt)
	})
	return mux
}

func StartHTTPCollector(port int, server *CollectorServer) error {
	if server == nil {
		server = &CollectorServer{}
	}
	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", port),
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("central diagnostic collector listening on %s", httpServer.Addr)
	return httpServer.ListenAndServe()
}
