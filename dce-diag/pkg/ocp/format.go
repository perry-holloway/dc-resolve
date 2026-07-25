package ocp

import (
	"encoding/json"
	"io"
	"time"
)

type Status string

const (
	StatusPass      Status = "PASS"
	StatusFail      Status = "FAIL"
	StatusCannotRun Status = "CANNOT_RUN"
)

type DiagnosticResult struct {
	TestName      string    `json:"test_name"`
	Timestamp     time.Time `json:"timestamp"`
	Status        Status    `json:"status"`
	FRULocation   string    `json:"fru_location,omitempty"`
	FailureReason string    `json:"failure_reason,omitempty"`
	Details       any       `json:"details,omitempty"`
}

func WriteResult(w io.Writer, result DiagnosticResult) error {
	if result.Timestamp.IsZero() {
		result.Timestamp = time.Now().UTC()
	}
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}
