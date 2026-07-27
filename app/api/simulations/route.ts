import { requireConsoleUser } from "../../../lib/api-auth";
import { ingestDiagnosticReport } from "../../../lib/report-ingestion";
import {
  buildSimulationReport,
  listSimulationScenarios,
} from "../../../lib/simulation-scenarios.mjs";
import { validateReportPayload } from "../../../lib/report-validation.mjs";

export async function GET() {
  const authFailure = await requireConsoleUser();
  if (authFailure) return authFailure;
  return Response.json({ scenarios: listSimulationScenarios() });
}

export async function POST(request: Request) {
  const authFailure = await requireConsoleUser();
  if (authFailure) return authFailure;

  let body: { scenario_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }
  if (typeof body.scenario_id !== "string" || body.scenario_id.length > 64) {
    return Response.json({ error: "a valid scenario_id is required" }, { status: 400 });
  }

  const runId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const simulation = buildSimulationReport(body.scenario_id, runId, timestamp);
  if (!simulation) {
    return Response.json({ error: "simulation scenario not found" }, { status: 404 });
  }
  const validation = validateReportPayload(simulation.report, null);
  if (!validation.ok) {
    console.error("built-in simulation fixture failed validation", validation.error);
    return Response.json({ error: "simulation fixture is invalid" }, { status: 500 });
  }

  try {
    const ingestion = await ingestDiagnosticReport(
      validation.value,
      "virtual-lab",
    );
    return Response.json(
      {
        run_id: runId,
        scenario: simulation.scenario,
        report: simulation.report,
        ingestion,
      },
      { status: ingestion.statusCode },
    );
  } catch (error) {
    console.error("virtual lab run failed", error);
    return Response.json({ error: "virtual lab run failed" }, { status: 500 });
  }
}
