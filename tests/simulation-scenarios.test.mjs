import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSimulationReport,
  listSimulationScenarios,
} from "../lib/simulation-scenarios.mjs";
import { validateReportPayload } from "../lib/report-validation.mjs";

test("ships a diverse, uniquely named scenario library", () => {
  const scenarios = listSimulationScenarios();
  assert.equal(scenarios.length, 6);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 6);
  assert.deepEqual(
    new Set(scenarios.map((scenario) => scenario.severity)),
    new Set(["PASS", "FAIL", "CANNOT_RUN"]),
  );
});

test("every built-in scenario produces a valid ingestion payload", () => {
  const timestamp = "2026-07-27T12:00:00.000Z";
  for (const scenario of listSimulationScenarios()) {
    const built = buildSimulationReport(scenario.id, `run-${scenario.id}`, timestamp);
    assert.ok(built);
    const validation = validateReportPayload(built.report, null);
    assert.equal(validation.ok, true, scenario.id);
    assert.match(built.report.server_serial, /^SIM-/);
    assert.equal(built.report.results[0].details.simulation, true);
  }
});

test("failure fixtures identify a FRU and cannot-run fixtures do not invent one", () => {
  const failed = buildSimulationReport(
    "memory-dimm-failure",
    "run-failed",
    "2026-07-27T12:00:00Z",
  );
  assert.equal(failed.report.results[0].status, "FAIL");
  assert.equal(failed.report.results[0].fru_location, "DIMM_B1");

  const unavailable = buildSimulationReport(
    "bmc-unreachable",
    "run-unavailable",
    "2026-07-27T12:00:00Z",
  );
  assert.equal(unavailable.report.results[0].status, "CANNOT_RUN");
  assert.equal(unavailable.report.results[0].fru_location, "");
});

test("unknown scenarios are rejected", () => {
  assert.equal(
    buildSimulationReport("not-a-scenario", "run-1", "2026-07-27T12:00:00Z"),
    null,
  );
});
