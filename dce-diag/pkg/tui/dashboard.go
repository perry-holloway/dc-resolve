// Package tui provides the local crash-cart diagnostic dashboard.
package tui

import (
	"fmt"
	"io"
	"strings"

	tea "charm.land/bubbletea/v2"

	"dce-diag/pkg/ocp"
)

type model struct {
	results []ocp.DiagnosticResult
	cursor  int
}

// InitialModel creates a dashboard model from completed diagnostic results.
func InitialModel(results []ocp.DiagnosticResult) model {
	return model{results: append([]ocp.DiagnosticResult(nil), results...)}
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.results)-1 {
				m.cursor++
			}
		}
	}
	return m, nil
}

func (m model) View() tea.View {
	var s strings.Builder
	s.WriteString("=== DCE Local Hardware Diagnostic Dashboard ===\n\n")

	if len(m.results) == 0 {
		s.WriteString("No diagnostic results are available.\n")
	}
	for i, result := range m.results {
		cursor := " "
		if m.cursor == i {
			cursor = ">"
		}
		fmt.Fprintf(&s, "%s %-12s %s (FRU: %s)\n", cursor, statusLabel(result.Status), result.TestName, fruLabel(result.FRULocation))
	}

	if len(m.results) > 0 {
		selected := m.results[m.cursor]
		s.WriteString("\nSelected result\n")
		fmt.Fprintf(&s, "  Status:  %s\n", selected.Status)
		fmt.Fprintf(&s, "  Reason:  %s\n", valueOr(selected.FailureReason, "none"))
		if selected.Details != nil {
			fmt.Fprintf(&s, "  Details: %v\n", selected.Details)
		}
	}
	s.WriteString("\nUse ↑/↓ or j/k to navigate. Press q to quit.\n")

	view := tea.NewView(s.String())
	view.AltScreen = true
	view.WindowTitle = "DCE Hardware Diagnostics"
	return view
}

// Run starts the interactive dashboard using the provided terminal streams.
func Run(results []ocp.DiagnosticResult, input io.Reader, output io.Writer) error {
	_, err := tea.NewProgram(
		InitialModel(results),
		tea.WithInput(input),
		tea.WithOutput(output),
	).Run()
	return err
}

func statusLabel(status ocp.Status) string {
	switch status {
	case ocp.StatusPass:
		return "[PASS]"
	case ocp.StatusFail:
		return "[FAIL]"
	case ocp.StatusCannotRun:
		return "[CANNOT_RUN]"
	default:
		return "[UNKNOWN]"
	}
}

func fruLabel(fru string) string {
	return valueOr(fru, "n/a")
}

func valueOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
