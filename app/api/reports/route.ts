import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { diagnosticReports, machines, repairOrders } from "../../../db/schema";
import {
  requireConsoleUser,
  requireReportIngestToken,
} from "../../../lib/api-auth";
import {
  activeRepairKey,
  REPORT_LIMITS,
  validateReportPayload,
} from "../../../lib/report-validation.mjs";

type MachineStatus = "critical" | "investigating" | "healthy";

export async function POST(request: Request) {
  const authFailure = await requireReportIngestToken(request);
  if (authFailure) return authFailure;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > REPORT_LIMITS.bodyBytes) {
    return Response.json({ error: "request body is too large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > REPORT_LIMITS.bodyBytes) {
      return Response.json({ error: "request body is too large" }, { status: 413 });
    }
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const validation = validateReportPayload(
    payload,
    request.headers.get("idempotency-key"),
  );
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const db = getDb();
    const report = validation.value;
    const [duplicate] = await db
      .select({ id: diagnosticReports.id })
      .from(diagnosticReports)
      .where(eq(diagnosticReports.ingestKey, report.ingestKey))
      .limit(1);
    if (duplicate) {
      return Response.json(
        { duplicate: true, report_id: report.ingestKey },
        { status: 200 },
      );
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
            createdBy: "diagnostic-agent",
          })
          .onConflictDoNothing({ target: repairOrders.activeKey }),
      ),
    ] as const;

    // D1 executes batch statements as one transaction. A failed statement
    // rolls the complete ingestion operation back.
    await db.batch(operations);

    return Response.json(
      {
        duplicate: false,
        report_id: report.ingestKey,
        machine_id: report.serverSerial,
        status,
        reports_processed: report.results.length,
        repair_orders_requested: failedResults.length,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("report ingestion failed", error);
    return Response.json({ error: "report ingestion failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const authFailure = await requireConsoleUser();
  if (authFailure) return authFailure;

  try {
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.trunc(limitParam), 200)
        : 50;

    const db = getDb();
    const rows = await db
      .select()
      .from(diagnosticReports)
      .orderBy(desc(diagnosticReports.receivedAt), desc(diagnosticReports.id))
      .limit(limit);

    return Response.json({ reports: rows });
  } catch (error) {
    console.error("report listing failed", error);
    return Response.json({ error: "report listing failed" }, { status: 500 });
  }
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
