import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { diagnosticReports, machines, repairOrders } from "../../../db/schema";
import { requireConsoleUser } from "../../../lib/api-auth";

/**
 * Maps a probe's test_name to the FRU-class label the console shows
 * ("component"). Extend this alongside any new probe added to dce-diag.
 */
function componentForTestName(testName: string): string {
  if (testName.startsWith("Memory")) return "DIMM";
  if (testName.startsWith("PCIe")) return "Riser";
  if (testName.startsWith("Thermal")) return "Fan tray";
  if (testName.startsWith("NVMe")) return "NVMe";
  return "Component";
}

/**
 * Confidence is not yet produced by any probe (see
 * pkg/ocp.DiagnosticResult) — this is a placeholder heuristic so the
 * console has a number to render, not a real scoring model.
 */
function confidenceForStatus(status: "PASS" | "FAIL" | "CANNOT_RUN"): number {
  if (status === "FAIL") return 95;
  if (status === "CANNOT_RUN") return 55;
  return 0;
}

function ageFromTimestamp(timestamp: string): string {
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export async function GET() {
  const authFailure = await requireConsoleUser();
  if (authFailure) return authFailure;

  try {
    const db = getDb();
    const machineRows = await db
      .select()
      .from(machines)
      .orderBy(desc(machines.lastReportAt));

    const queue = await Promise.all(
      machineRows.map(async (machine) => {
        const [latestActiveReport] = await db
          .select()
          .from(diagnosticReports)
          .where(
            and(
              eq(diagnosticReports.machineId, machine.id),
              ne(diagnosticReports.status, "PASS"),
            ),
          )
          .orderBy(desc(diagnosticReports.resultTimestamp), desc(diagnosticReports.id))
          .limit(1);

        const [openRepairOrder] = await db
          .select()
          .from(repairOrders)
          .where(and(eq(repairOrders.machineId, machine.id), eq(repairOrders.status, "open")))
          .orderBy(desc(repairOrders.createdAt))
          .limit(1);

        return {
          id: machine.id,
          rack: machine.rack,
          tray: machine.tray,
          status: machine.status,
          issue: latestActiveReport?.failureReason || latestActiveReport?.testName || "No active findings",
          component: latestActiveReport ? componentForTestName(latestActiveReport.testName) : "",
          fru: latestActiveReport?.fruLocation || openRepairOrder?.fruLocation || "",
          part: openRepairOrder?.part || "",
          confidence: latestActiveReport ? confidenceForStatus(latestActiveReport.status) : 0,
          signal: latestActiveReport?.failureReason || "",
          age: latestActiveReport ? ageFromTimestamp(latestActiveReport.resultTimestamp) : "",
        };
      }),
    );

    return Response.json({ machines: queue });
  } catch (error) {
    console.error("machine listing failed", error);
    return Response.json({ error: "machine listing failed" }, { status: 500 });
  }
}
