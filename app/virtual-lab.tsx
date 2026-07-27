"use client";

import { useEffect, useState } from "react";

type Scenario = {
  id: string;
  name: string;
  category: string;
  severity: "PASS" | "FAIL" | "CANNOT_RUN";
  description: string;
  duration: string;
};

type SimulationRun = {
  run_id: string;
  scenario: Scenario;
  report: {
    server_serial: string;
    tray_id: string;
    report_id: string;
    results: Array<{
      test_name: string;
      status: Scenario["severity"];
      fru_location: string;
      failure_reason: string;
      details: Record<string, unknown>;
    }>;
  };
  ingestion: {
    machine_id: string;
    status: "critical" | "investigating" | "healthy";
    reports_processed: number;
    repair_orders_requested: number;
  };
};

export default function VirtualLab({ onOpenQueue }: { onOpenQueue: () => void }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<SimulationRun | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/simulations")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load scenarios");
        return (await response.json()) as { scenarios: Scenario[] };
      })
      .then(({ scenarios: loaded }) => {
        if (cancelled) return;
        setScenarios(loaded);
        setSelectedId(loaded[0]?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) setError("The virtual lab is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = scenarios.find((scenario) => scenario.id === selectedId);

  async function runScenario() {
    if (!selectedId) return;
    setRunning(true);
    setRun(null);
    setError("");
    try {
      const response = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario_id: selectedId }),
      });
      const payload = (await response.json()) as SimulationRun & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Simulation failed");
      setRun(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Simulation failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="lab-workspace">
      <header className="lab-hero">
        <div>
          <p className="eyebrow">OPERATIONS / VIRTUAL HARDWARE LAB</p>
          <h1>Prove the repair pipeline without a physical server</h1>
          <p>
            Select a deterministic hardware condition. DC Resolve generates
            realistic probe evidence and sends it through the real validation,
            persistence, health-rollup, and repair-order workflow.
          </p>
        </div>
        <div className="lab-boundary">
          <span>SIMULATED</span><strong>Hardware interfaces</strong><i />
          <span>REAL</span><strong>Control-plane pipeline</strong>
        </div>
      </header>

      <div className="lab-grid">
        <section className="scenario-panel">
          <div className="panel-heading">
            <div><h2>Failure scenario library</h2><p>Repeatable fixtures for demos, development, and regression tests</p></div>
            <span className="scenario-count">{scenarios.length} scenarios</span>
          </div>
          <div className="scenario-grid">
            {scenarios.map((scenario) => (
              <button
                type="button"
                key={scenario.id}
                className={`scenario-card ${selectedId === scenario.id ? "selected" : ""}`}
                onClick={() => {
                  setSelectedId(scenario.id);
                  setRun(null);
                  setError("");
                }}
              >
                <span className={`scenario-severity ${scenario.severity.toLowerCase()}`}>{scenario.severity}</span>
                <small>{scenario.category}</small>
                <strong>{scenario.name}</strong>
                <p>{scenario.description}</p>
                <footer><span>Expected runtime</span><b>{scenario.duration}</b></footer>
              </button>
            ))}
          </div>
        </section>

        <aside className="lab-runner">
          <div className="runner-heading">
            <div>
              <span className="lab-flask">LAB</span>
              <div><small>SELECTED SCENARIO</small><h2>{selected?.name ?? "Loading scenarios"}</h2></div>
            </div>
            {selected && <span className={`scenario-severity ${selected.severity.toLowerCase()}`}>{selected.severity}</span>}
          </div>

          <div className="pipeline">
            {["Fixture", "Go-style report", "Validation", "D1 transaction", "Repair action"].map((step, index) => (
              <div key={step} className={run ? "complete" : running && index < 3 ? "active" : ""}>
                <span>{run ? "✓" : index + 1}</span><strong>{step}</strong>
              </div>
            ))}
          </div>

          <button className="run-scenario" type="button" disabled={!selected || running} onClick={runScenario}>
            {running ? <><i className="spinner light" /> Running virtual diagnostics...</> : "Run selected scenario"}
          </button>

          {error && <div className="lab-error" role="alert">{error}</div>}
          {!run && !error && (
            <div className="runner-placeholder">
              <span>01</span><h3>Ready to simulate</h3>
              <p>A unique SIM server will be created. Failed FRUs generate repair work; unavailable diagnostics produce an investigation state.</p>
            </div>
          )}

          {run && (
            <div className="run-result" aria-live="polite">
              <div className="result-verdict">
                <span className={run.ingestion.status}>{run.ingestion.status === "critical" ? "!" : "✓"}</span>
                <div><small>PIPELINE COMPLETE</small><h3>{run.report.server_serial}</h3><p>{run.report.tray_id} · {run.ingestion.reports_processed} results persisted</p></div>
                <b>{run.ingestion.status.toUpperCase()}</b>
              </div>
              <div className="result-metrics">
                <div><small>Evidence rows</small><strong>{run.ingestion.reports_processed}</strong></div>
                <div><small>Repair orders</small><strong>{run.ingestion.repair_orders_requested}</strong></div>
                <div><small>Run ID</small><strong>{run.run_id.slice(0, 8)}</strong></div>
              </div>
              <div className="result-evidence">
                {run.report.results.map((result) => (
                  <article key={result.test_name}>
                    <span className={`scenario-severity ${result.status.toLowerCase()}`}>{result.status}</span>
                    <div><strong>{result.test_name}</strong><p>{result.failure_reason || "All policy checks passed"}</p></div>
                    <code>{result.fru_location || "SYSTEM"}</code>
                  </article>
                ))}
              </div>
              <details><summary>Inspect generated diagnostic JSON</summary><pre>{JSON.stringify(run.report, null, 2)}</pre></details>
              <button className="open-queue" type="button" onClick={onOpenQueue}>Open repair queue <span>→</span></button>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
