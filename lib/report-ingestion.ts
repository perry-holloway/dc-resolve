import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { diagnosticReports, machines, repairOrders } from "../db/schema";
import { activeRepairKey } from "./report-validation.mjs";
import type { NormalizedDiagnosticResult } from "./report-validation.mjs";

type MachineStatus = "critical" | "investigating" | "healthy";

export type ValidatedReport = {
  ingestKey: string;
  serverSerial: string;
  trayId: string;
  results: NormalizedDiagnosticResult[];
};

export async function ingestDiagnosticReport(
  report: ValidatedReport,
  source = "diagnostic-agent",
) {
  const db = getDb();
  const [duplicate] = await db
    .select({ id: diagnosticReports.id })
    .from(diagnosticReports)
    .where(eq(diagnosticReports.ingestKey, report.ingestKey))
    .limit(1);
  if (duplicate) {
    return {
      duplicate: true,
      report_id: report.ingestKey,
      statusCode: 200,
    } as const;
  }

  const { rack, tray } = splitTrayId(report.trayId);
  const now = new Date().toISOString();
  const [existingMachine] = await db
    .select({ status: machines.status })
    .from(machines)
    .where(eq(machines.id, report.serverSerial))
    .limit(1);
  const incomingStatus = rollupStatus(report.results);
  const status =
    existingMachine?.status === "critical" && incomingStatus !== "critical"
      ? "critical"
      : incomingStatus;

  const failedResults = report.results.filter((result) => result.status === "FAIL");
  const operations = [
    db
      .insert(machines)
      .values({
        id: report.serverSerial,
        rack,
        tray,
        status,
        lastReportAt: now,
      })
      .onConflictDoUpdate({
        target: machines.id,
        set: { rack, tray, status, lastReportAt: now },
      }),
    db
      .insert(diagnosticReports)
      .values(
        report.results.map((result, resultIndex) => ({
          machineId: report.serverSerial,
          ingestKey: report.ingestKey,
          resultIndex,
          testName: result.testName,
          status: result.status,
          fruLocation: result.fruLocation,
          failureReason: result.failureReason,
          details: result.details,
          resultTimestamp: result.timestamp || now,
        })),
      )
      .onConflictDoNothing(),
    ...failedResults.map((result) =>
      db
        .insert(repairOrders)
        .values({
          machineId: report.serverSerial,
          fruLocation: result.fruLocation,
          reason: result.failureReason || result.testName,
          activeKey: activeRepairKey(report.serverSerial, result.fruLocation),
          createdBy: source,
        })
        .onConflictDoNothing({ target: repairOrders.activeKey }),
    ),
  ] as const;

  await db.batch(operations);

  return {
    duplicate: false,
    report_id: report.ingestKey,
    machine_id: report.serverSerial,
    status,
    reports_processed: report.results.length,
    repair_orders_requested: failedResults.length,
    statusCode: 201,
  } as const;
}

function splitTrayId(trayId: string): { rack: string; tray: string } {
  const dashIndex = trayId.indexOf("-");
  if (dashIndex === -1) return { rack: "", tray: trayId };
  return { rack: trayId.slice(0, dashIndex), tray: trayId.slice(dashIndex + 1) };
}

function rollupStatus(
  results: Array<{ status: "PASS" | "FAIL" | "CANNOT_RUN" }>,
): MachineStatus {
  if (results.some((result) => result.status === "FAIL")) return "critical";
  if (results.some((result) => result.status === "CANNOT_RUN")) {
    return "investigating";
  }
  return "healthy";
}
