package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"

	"dce-diag/pkg/ocp"
)

func TestDashboardNavigationAndRendering(t *testing.T) {
	m := InitialModel([]ocp.DiagnosticResult{
		{TestName: "memory", Status: ocp.StatusPass},
		{TestName: "pcie", Status: ocp.StatusFail, FRULocation: "Riser1/Slot2", FailureReason: "link degraded"},
	})

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	m = updated.(model)
	if m.cursor != 1 {
		t.Fatalf("cursor = %d, want 1", m.cursor)
	}

	view := m.View().Content
	for _, expected := range []string{"> [FAIL]", "Riser1/Slot2", "link degraded"} {
		if !strings.Contains(view, expected) {
			t.Errorf("View() missing %q:\n%s", expected, view)
		}
	}
}

func TestDashboardEmptyResults(t *testing.T) {
	view := InitialModel(nil).View().Content
	if !strings.Contains(view, "No diagnostic results") {
		t.Fatalf("View() = %q", view)
	}
}
