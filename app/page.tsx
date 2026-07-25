"use client";

import { useMemo, useState } from "react";

type Machine = {
  id: string;
  rack: string;
  tray: string;
  issue: string;
  status: "Critical" | "Degraded" | "Investigating" | "Healthy";
  component: string;
  fru: string;
  part: string;
  confidence: number;
  signal: string;
  age: string;
};

const machines: Machine[] = [
  {
    id: "gdc-us-central1-0421",
    rack: "R42",
    tray: "T03",
    issue: "Uncorrectable memory error",
    status: "Critical",
    component: "DIMM",
    fru: "DIMM_B1",
    part: "PN 815100-32G-ECC",
    confidence: 98,
    signal: "12 UE events · Channel B",
    age: "4m",
  },
  {
    id: "gdc-us-central1-0388",
    rack: "R38",
    tray: "T11",
    issue: "NVMe media errors increasing",
    status: "Degraded",
    component: "NVMe",
    fru: "NVME_SLOT_0",
    part: "PN NV3-7T68-U2",
    confidence: 94,
    signal: "32 media errors · 91% used",
    age: "12m",
  },
  {
    id: "gdc-us-central1-0512",
    rack: "R51",
    tray: "T07",
    issue: "Fan RPM below policy",
    status: "Investigating",
    component: "Fan tray",
    fru: "FAN_TRAY_2",
    part: "PN FT-80X38-HS",
    confidence: 76,
    signal: "2,180 RPM · threshold 4,000",
    age: "19m",
  },
  {
    id: "gdc-us-central1-0274",
    rack: "R27",
    tray: "T02",
    issue: "PCIe AER replay timeout",
    status: "Investigating",
    component: "Riser",
    fru: "RISER_A",
    part: "PN PCIE-R5-A2",
    confidence: 68,
    signal: "8 replay timer timeouts",
    age: "31m",
  },
];

const statusClass: Record<Machine["status"], string> = {
  Critical: "critical",
  Degraded: "degraded",
  Investigating: "investigating",
  Healthy: "healthy",
};

export default function Home() {
  const [selectedId, setSelectedId] = useState(machines[0].id);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [ledOn, setLedOn] = useState(false);
  const [running, setRunning] = useState(false);
  const [satState, setSatState] = useState<"idle" | "running" | "failed">("idle");
  const [pcieState, setPCIeState] = useState<"idle" | "running" | "failed">("idle");
  const [memoryMB, setMemoryMB] = useState(1024);
  const [durationSec, setDurationSec] = useState(15);
  const [toast, setToast] = useState("");

  const selected = machines.find((machine) => machine.id === selectedId) ?? machines[0];
  const filtered = useMemo(
    () =>
      machines.filter(
        (machine) =>
          (filter === "All" || machine.status === filter) &&
          `${machine.id} ${machine.rack} ${machine.tray} ${machine.issue}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [filter, query],
  );

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function runQuickAudit() {
    setRunning(true);
    window.setTimeout(() => {
      setRunning(false);
      notify("Quick audit complete · diagnosis unchanged");
    }, 1800);
  }

  function runSatTest() {
    setSatState("running");
    window.setTimeout(() => {
      setSatState("failed");
      notify(`SAT isolated the fault to ${selected.fru}`);
    }, 2400);
  }

  function runPCIeTest() {
    setPCIeState("running");
    window.setTimeout(() => {
      setPCIeState("failed");
      notify("PCIe audit streamed to the central collector");
    }, 2100);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">D</span>
          <div>
            <strong>DC Resolve</strong>
            <small>Hardware operations</small>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          <button className="nav-item active"><span>⌁</span> Repair queue <b>4</b></button>
          <button className="nav-item"><span>▦</span> Fleet health</button>
          <button className="nav-item"><span>⚙</span> Diagnostic runs</button>
          <button className="nav-item"><span>◫</span> Rule library</button>
          <button className="nav-item"><span>⌘</span> Assets</button>
        </nav>
        <div className="environment">
          <span className="pulse" />
          <div><strong>Lab environment</strong><small>Simulated telemetry</small></div>
        </div>
        <div className="profile">
          <div className="avatar">PH</div>
          <div><strong>Perry Holloway</strong><small>DCE technician</small></div>
          <span>•••</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">OPERATIONS / REPAIR QUEUE</p>
            <h1>Hardware triage</h1>
          </div>
          <div className="header-actions">
            <div className="search">
              <span>⌕</span>
              <input
                aria-label="Search machines"
                placeholder="Search machine, rack, tray…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd>⌘ K</kbd>
            </div>
            <button className="icon-button" aria-label="Notifications">♢<i /></button>
          </div>
        </header>

        <div className="summary-row">
          <article><span className="summary-icon red">!</span><div><b>1</b><small>Critical</small></div><em>Needs action</em></article>
          <article><span className="summary-icon amber">↗</span><div><b>1</b><small>Degraded</small></div><em>Monitor closely</em></article>
          <article><span className="summary-icon blue">≈</span><div><b>2</b><small>Investigating</small></div><em>Tests in progress</em></article>
          <article><span className="summary-icon green">✓</span><div><b>99.94%</b><small>Fleet available</small></div><em>12,842 machines</em></article>
        </div>

        <div className="content-grid">
          <section className="queue-panel">
            <div className="panel-heading">
              <div><h2>Machines requiring attention</h2><p>Prioritized by severity and diagnostic confidence</p></div>
              <div className="filters">
                {["All", "Critical", "Degraded", "Investigating"].map((item) => (
                  <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}</button>
                ))}
              </div>
            </div>
            <div className="table-head"><span>Machine / location</span><span>Finding</span><span>Confidence</span><span>Age</span></div>
            <div className="machine-list">
              {filtered.map((machine) => (
                <button
                  key={machine.id}
                  className={`machine-row ${machine.id === selectedId ? "active" : ""}`}
                  onClick={() => {
                    setSelectedId(machine.id);
                    setLedOn(false);
                    setSatState("idle");
                    setPCIeState("idle");
                  }}
                >
                  <span className="machine-cell">
                    <i className={`status-dot ${statusClass[machine.status]}`} />
                    <span><strong>{machine.id}</strong><small>{machine.rack} · {machine.tray}</small></span>
                  </span>
                  <span className="finding"><strong>{machine.issue}</strong><small>{machine.signal}</small></span>
                  <span className="confidence"><b>{machine.confidence}%</b><i><em style={{ width: `${machine.confidence}%` }} /></i></span>
                  <span className="age">{machine.age}<b>›</b></span>
                </button>
              ))}
              {!filtered.length && <div className="empty-state">No machines match this view.</div>}
            </div>
          </section>

          <aside className="diagnosis-panel">
            <div className="diagnosis-head">
              <div><span className={`status-dot ${statusClass[selected.status]}`} /><span><small>SELECTED MACHINE</small><strong>{selected.id}</strong></span></div>
              <button aria-label="More options">•••</button>
            </div>

            <div className="location-card">
              <div className="rack-visual" aria-label={`Rack ${selected.rack}, tray ${selected.tray}`}>
                {[1,2,3,4,5,6,7,8].map((n) => <i key={n} className={n === 3 ? "lit" : ""}>{n}</i>)}
              </div>
              <div><small>PHYSICAL LOCATION</small><h3>Rack {selected.rack.slice(1)} · Tray {selected.tray.slice(1)}</h3><p>Row C · Position 14</p></div>
              <button
                className={ledOn ? "led-button active" : "led-button"}
                onClick={() => { setLedOn(!ledOn); notify(`Locate LED ${!ledOn ? "blinking" : "turned off"}`); }}
              ><span>✦</span>{ledOn ? "Stop locate LED" : "Blink locate LED"}</button>
            </div>

            <div className="verdict">
              <div className="verdict-title"><span>!</span><div><small>RECOMMENDED ACTION</small><h2>Replace {selected.component}</h2></div><b>{selected.confidence}% confidence</b></div>
              <div className="fru-card">
                <div><small>BOARD SILKSCREEN</small><strong>{selected.fru}</strong></div>
                <div><small>REPLACEMENT PART</small><strong>{selected.part}</strong></div>
              </div>
              <p>The fault pattern is isolated to <strong>{selected.fru}</strong>. Power down the tray and follow ESD procedure before replacement.</p>
            </div>

            <div className="evidence">
              <div className="section-label"><h3>Diagnostic evidence</h3><span>OCP Diag</span></div>
              <ul>
                <li><span className="check">✓</span><div><strong>gBMC telemetry collected</strong><small>Redfish sensors and system event log</small></div><time>0.8s</time></li>
                <li><span className="check">✓</span><div><strong>FRU inventory matched</strong><small>Machine topology → {selected.fru}</small></div><time>0.2s</time></li>
                <li><span className="fail">!</span><div><strong>{selected.issue}</strong><small>{selected.signal}</small></div><time>FAIL</time></li>
              </ul>
            </div>

            <div className="sat-panel">
              <div className="sat-heading">
                <div>
                  <span className="sat-mark">M</span>
                  <div><h3>SAT memory burn-in</h3><p>Stress CPU, memory, and memory controller</p></div>
                </div>
                <span className="ocp-badge">OCP DIAG</span>
              </div>
              <div className="sat-controls">
                <label>
                  <span>Memory allocation</span>
                  <select
                    aria-label="Memory allocation"
                    value={memoryMB}
                    onChange={(event) => setMemoryMB(Number(event.target.value))}
                    disabled={satState === "running"}
                  >
                    <option value={512}>512 MB</option>
                    <option value={1024}>1,024 MB</option>
                    <option value={2048}>2,048 MB</option>
                    <option value={4096}>4,096 MB</option>
                  </select>
                </label>
                <label>
                  <span>Duration</span>
                  <select
                    aria-label="Test duration"
                    value={durationSec}
                    onChange={(event) => setDurationSec(Number(event.target.value))}
                    disabled={satState === "running"}
                  >
                    <option value={15}>15 seconds</option>
                    <option value={30}>30 seconds</option>
                    <option value={60}>60 seconds</option>
                    <option value={900}>15 minutes</option>
                  </select>
                </label>
                <button onClick={runSatTest} disabled={satState === "running"}>
                  {satState === "running" ? <><i className="spinner light" /> Running SAT…</> : satState === "failed" ? "Run again" : "Run memory test"}
                </button>
              </div>
              {satState !== "idle" && (
                <div className={`sat-result ${satState}`}>
                  <div className="sat-result-title">
                    <span>{satState === "running" ? <i className="spinner" /> : "!"}</span>
                    <div>
                      <strong>{satState === "running" ? "Memory_SAT_BurnIn running" : "Memory hardware error detected"}</strong>
                      <small>{satState === "running" ? `${memoryMB} MB allocated · ${durationSec}s target` : `Correctable ECC threshold exceeded · ${selected.fru}`}</small>
                    </div>
                    <b>{satState === "running" ? "RUNNING" : "FAIL"}</b>
                  </div>
                  {satState === "failed" && (
                    <div className="sat-json">
                      <code>{`{ "status": "FAIL", "fru_location": "${selected.fru}", "test_name": "Memory_SAT_BurnIn" }`}</code>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="pcie-panel">
              <div className="sat-heading">
                <div>
                  <span className="pcie-mark">P</span>
                  <div><h3>PCIe topology &amp; link audit</h3><p>Validate expected devices, generation, and lane width</p></div>
                </div>
                <span className="collector-live"><i /> COLLECTOR LIVE</span>
              </div>
              <div className="topology-row">
                <div className="pcie-device"><span>CPU0</span><b>ROOT</b></div>
                <i className="bus-line" />
                <div className="pcie-device riser"><span>RISER_A</span><b>GEN5 · x16</b></div>
                <i className="bus-line degraded" />
                <div className="pcie-device endpoint"><span>0000:3b:00.0</span><b>NIC · x8</b></div>
              </div>
              <div className="pcie-actions">
                <div><small>EXPECTED LINK</small><strong>32 GT/s · x16</strong></div>
                <div><small>NEGOTIATED LINK</small><strong className="warn">16 GT/s · x8</strong></div>
                <button onClick={runPCIeTest} disabled={pcieState === "running"}>
                  {pcieState === "running" ? <><i className="spinner light" /> Auditing…</> : pcieState === "failed" ? "Audit again" : "Run PCIe audit"}
                </button>
              </div>
              {pcieState !== "idle" && (
                <div className={`collector-result ${pcieState}`}>
                  <span>{pcieState === "running" ? <i className="spinner" /> : "!"}</span>
                  <div>
                    <strong>{pcieState === "running" ? "PCIe_Topology_Check running" : "Degraded PCIe link isolated"}</strong>
                    <small>{pcieState === "running" ? "Reading lspci topology and link capabilities" : "RISER_A · width downgraded from x16 to x8"}</small>
                  </div>
                  <b>{pcieState === "running" ? "RUNNING" : "FAIL"}</b>
                </div>
              )}
              <div className="collector-route">
                <span>TRAY {selected.tray}</span><i>→</i><span>OCP JSON</span><i>→</i><span>CENTRAL COLLECTOR</span>
              </div>
            </div>

            <div className="action-row">
              <button className="secondary" onClick={runQuickAudit} disabled={running}>{running ? <><i className="spinner" /> Running audit…</> : "Run quick audit"}</button>
              <button className="primary" onClick={() => notify("Repair work order created")}>Create repair order <span>→</span></button>
            </div>
          </aside>
        </div>
      </section>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
