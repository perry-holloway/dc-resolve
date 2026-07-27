export type SimulationSeverity = "PASS" | "FAIL" | "CANNOT_RUN";

export type SimulationScenario = {
  id: string;
  name: string;
  category: string;
  severity: SimulationSeverity;
  description: string;
  duration: string;
};

export function listSimulationScenarios(): SimulationScenario[];

export function buildSimulationReport(
  scenarioId: string,
  runId: string,
  timestamp: string,
): {
  scenario: SimulationScenario;
  report: {
    server_serial: string;
    tray_id: string;
    report_id: string;
    results: Array<{
      test_name: string;
      timestamp: string;
      status: SimulationSeverity;
      fru_location: string;
      failure_reason: string;
      details: Record<string, unknown>;
    }>;
  };
} | null;
