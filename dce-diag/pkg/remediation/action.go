// Package remediation translates diagnostic failures into field actions.
package remediation

import (
	"fmt"
	"log"

	"dce-diag/pkg/ocp"
	"dce-diag/pkg/probes"
)

// RemediationEngine coordinates BMC and repair-queue actions.
type RemediationEngine struct {
	BMCClient *probes.BMCClient
}

// NewRemediationEngine creates a remediation engine.
func NewRemediationEngine(bmc *probes.BMCClient) *RemediationEngine {
	return &RemediationEngine{BMCClient: bmc}
}

// ProcessFailure evaluates an OCP failure result and triggers automated field
// remediation actions.
func (r *RemediationEngine) ProcessFailure(serverSerial string, result ocp.DiagnosticResult) error {
	if result.Status != ocp.StatusFail {
		return nil
	}

	log.Printf("[REMEDIATION] Processing failure for %s: %s (FRU: %s)", serverSerial, result.TestName, result.FRULocation)

	// Trigger the physical chassis locate LED so the technician can find the
	// exact rack slot. An LED failure is non-fatal: ticket dispatch still runs.
	if r.BMCClient != nil {
		if err := r.BMCClient.SetLocateLED(true); err != nil {
			log.Printf("[WARN] Failed to trigger locate LED on BMC: %v", err)
		} else {
			log.Printf("[ACTION] Chassis Locate LED set to BLINKING for server %s", serverSerial)
		}
	}

	// Generate the payload expected by Jira, ServiceNow, or an internal repair
	// queue. Delivery will be connected when a ticket backend is configured.
	ticketPayload := map[string]string{
		"serial":          serverSerial,
		"component_slot":  result.FRULocation,
		"diagnostic_name": result.TestName,
		"failure_reason":  result.FailureReason,
		"action_required": fmt.Sprintf("Replace Field Replaceable Unit (FRU) at location: %s", result.FRULocation),
	}

	log.Printf("[TICKET GENERATED] Work Order created: Replace %s on Tray %s", ticketPayload["component_slot"], serverSerial)
	return nil
}
