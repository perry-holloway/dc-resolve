const scenarios = [
  {
    id: "healthy-baseline",
    name: "Healthy server baseline",
    category: "Baseline",
    severity: "PASS",
    description: "All memory, PCIe, NVMe, thermal, fan, and power checks pass.",
    duration: "18 sec",
    results: [
      result("Memory_SAT_BurnIn", "PASS", "", "", {
        allocated_mb: 4096,
        duration_seconds: 15,
        errors: 0,
      }),
      result("PCIe_Topology_Check", "PASS", "", "", {
        expected_width: "x16",
        negotiated_width: "x16",
        generation: "Gen5",
      }),
      result("NVMe_SMART_Health", "PASS", "NVME_SLOT_0", "", {
        percentage_used: 12,
        media_errors: 0,
        available_spare: 100,
      }),
      result("Thermal_Sensors_Check", "PASS", "", "", {
        cpu_celsius: 54,
        fan_rpm: 6200,
        psu_health: "OK",
      }),
    ],
  },
  {
    id: "memory-dimm-failure",
    name: "Failed memory DIMM",
    category: "Memory",
    severity: "FAIL",
    description: "SAT and ECC evidence isolate an uncorrectable error to DIMM_B1.",
    duration: "32 sec",
    results: [
      result(
        "Memory_SAT_BurnIn",
        "FAIL",
        "DIMM_B1",
        "uncorrectable ECC errors exceeded policy during memory stress",
        {
          correctable_ecc: 47,
          uncorrectable_ecc: 3,
          channel: "B",
          slot: "1",
        },
      ),
      result("PCIe_Topology_Check", "PASS", "", "", {
        devices_checked: 9,
      }),
    ],
  },
  {
    id: "nvme-media-errors",
    name: "NVMe media degradation",
    category: "Storage",
    severity: "FAIL",
    description: "SMART telemetry reports media errors and 94% device wear.",
    duration: "9 sec",
    results: [
      result(
        "NVMe_SMART_Health",
        "FAIL",
        "NVME_SLOT_2",
        "media errors detected and percentage_used exceeded replacement threshold",
        {
          device: "/dev/nvme2",
          model: "DC-NVME-7T68",
          percentage_used: 94,
          media_errors: 18,
          available_spare: 93,
        },
      ),
    ],
  },
  {
    id: "pcie-link-degraded",
    name: "PCIe link-width downgrade",
    category: "PCIe",
    severity: "FAIL",
    description: "A Gen5 x16 NIC negotiates at Gen4 x8 through RISER_A.",
    duration: "7 sec",
    results: [
      result(
        "PCIe_Topology_Check",
        "FAIL",
        "RISER_A",
        "negotiated PCIe link is below the expected generation and lane width",
        {
          address: "0000:3b:00.0",
          device: "200G NIC",
          expected: "32 GT/s x16",
          negotiated: "16 GT/s x8",
          replay_timeouts: 8,
        },
      ),
    ],
  },
  {
    id: "fan-thermal-risk",
    name: "Fan and thermal risk",
    category: "Thermal",
    severity: "FAIL",
    description: "Fan tray 2 is below policy while CPU temperature rises.",
    duration: "5 sec",
    results: [
      result(
        "Thermal_Sensors_Check",
        "FAIL",
        "FAN_TRAY_2",
        "fan speed below minimum policy and CPU temperature above warning threshold",
        {
          fan_rpm: 2180,
          minimum_fan_rpm: 4000,
          cpu_celsius: 91,
          cpu_warning_celsius: 85,
        },
      ),
    ],
  },
  {
    id: "bmc-unreachable",
    name: "BMC communication failure",
    category: "Management",
    severity: "CANNOT_RUN",
    description: "The Redfish endpoint times out, producing an investigation state.",
    duration: "20 sec",
    results: [
      result(
        "Thermal_Sensors_Check",
        "CANNOT_RUN",
        "",
        "Redfish thermal endpoint did not respond before the command timeout",
        {
          endpoint: "/redfish/v1/Chassis/chassis/Thermal",
          timeout_seconds: 20,
        },
      ),
    ],
  },
];

export function listSimulationScenarios() {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    category: scenario.category,
    severity: scenario.severity,
    description: scenario.description,
    duration: scenario.duration,
  }));
}

export function buildSimulationReport(scenarioId, runId, timestamp) {
  const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) return null;

  const suffix = runId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  const rackNumber = String((hash(scenarioId) % 40) + 10).padStart(2, "0");
  const trayNumber = String((hash(runId) % 12) + 1).padStart(2, "0");
  return {
    scenario: {
      id: scenario.id,
      name: scenario.name,
      category: scenario.category,
      severity: scenario.severity,
      description: scenario.description,
      duration: scenario.duration,
    },
    report: {
      server_serial: `SIM-${scenario.category.toUpperCase()}-${suffix}`,
      tray_id: `R${rackNumber}-T${trayNumber}`,
      report_id: `virtual-lab-${scenario.id}-${runId}`,
      results: scenario.results.map((entry) => ({
        ...entry,
        timestamp,
        details: {
          ...entry.details,
          simulation: true,
          scenario_id: scenario.id,
          run_id: runId,
        },
      })),
    },
  };
}

function result(test_name, status, fru_location, failure_reason, details) {
  return { test_name, status, fru_location, failure_reason, details };
}

function hash(value) {
  let output = 0;
  for (const character of value) {
    output = (output * 31 + character.charCodeAt(0)) >>> 0;
  }
  return output;
}
