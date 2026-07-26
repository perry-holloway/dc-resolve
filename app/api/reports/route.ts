import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { diagnosticReports, machines, repairOrders } from "../../../db/schema";

/**
 * Mirrors ocp.DiagnosticResult from the Go agent (pkg/ocp/format.go).
 */
type IncomingResult = {
  test_name?: string;
  timestamp?: string;
  status?: string;
  fru_location?: string;
  failure_reason?: string;
  details?: unknown;
};

/**
 * Mirrors collector.DiagnosticReport from the Go collector
 * (dce-diag/pkg/collector/service.go), so the same JSON payload the agent
 * POSTs to a standalone collector can be POSTed here instead (or forwarded
 * here from a collector's OnReport hook).
 */
type IncomingReport = {
  server_serial?: string;
  tray_id?: string;
  results?: IncomingResult[];
};

function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table")) {
    return "The reports tables are unavailable. Generate the migration locally with `npm run db:generate`, then deploy so the platform can apply the generated SQL to the real D1 database.";
  }

  return message;
}

function splitTrayId(trayId: string): { rack: string; tray: string } {
  const dashIndex = trayId.indexOf("-");
  if (dashIndex === -1) {
    return { rack: "", tray: trayId };
  }
  return { rack: trayId.slice(0, dashIndex), tray: trayId.slice(dashIndex + 1) };
}

/**
 * Rolls a set of results up into a single machine status. This is a
 * deliberately simple starting point: any FAIL wins as "critical", any
 * CANNOT_RUN (with no FAIL present) becomes "investigating", otherwise the
 * machine is "healthy". There is no automatic "degraded" bucket yet — that
 * requires a severity policy (e.g. which test/failure combinations count as
 * degraded vs. critical) that should be layered on top of this.
 */
function rollupStatus(
  results: IncomingResult[],
): "critical" | "investigating" | "healthy" {
  if (results.some((result) => result.status === "FAIL")) return "critical";
  if (results.some((result) => result.status === "CANNOT_RUN")) return "investigating";
  return "healthy";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as IncomingReport;
    const serverSerial = payload.server_serial?.trim() ?? "";
    const trayId = payload.tray_id?.trim() ?? "";
    const results = payload.results ?? [];

    if (!serverSerial || !trayId || results.length === 0) {
      return Response.json(
        { error: "server_serial, tray_id, and a non-empty results array are required" },
        { status: 400 },
      );
    }

    for (const result of results) {
      if (!result.test_name || !result.status) {
        return Response.json(
          { error: "each result requires test_name and status" },
          { status: 400 },
        );
      }
    }

    const db = getDb();
    const { rack, tray } = splitTrayId(trayId);
    const status = rollupStatus(results);
    const now = new Date().toISOString();

    await db
      .insert(machines)
      .values({ id: serverSerial, rack, tray, status, lastReportAt: now })
      .onConflictDoUpdate({
        target: machines.id,
        set: { rack, tray, status, lastReportAt: now },
      });

    const insertedReports = await db
      .insert(diagnosticReports)
      .values(
        results.map((result) => ({
          machineId: serverSerial,
          testName: result.test_name!,
          status: result.status as "PASS" | "FAIL" | "CANNOT_RUN",
          fruLocation: result.fru_location ?? "",
          failureReason: result.failure_reason ?? "",
          details: result.details === undefined ? null : JSON.stringify(result.details),
          resultTimestamp: result.timestamp ?? now,
        })),
      )
      .returning();

    let repairOrdersOpened = 0;
    for (const result of results) {
      if (result.status !== "FAIL") continue;
      const fruLocation = result.fru_location ?? "";

      const [existingOpenOrder] = await db
        .select({ id: repairOrders.id })
        .from(repairOrders)
        .where(
          and(
            eq(repairOrders.machineId, serverSerial),
            eq(repairOrders.fruLocation, fruLocation),
            eq(repairOrders.status, "open"),
          ),
        )
        .limit(1);

      if (existingOpenOrder) continue;

      await db.insert(repairOrders).values({
        machineId: serverSerial,
        fruLocation,
        reason: result.failure_reason ?? result.test_name!,
      });
      repairOrdersOpened += 1;
    }

    return Response.json(
      {
        machine_id: serverSerial,
        status,
        reports_inserted: insertedReports.length,
        repair_orders_opened: repairOrdersOpened,
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

    const db = getDb();
    const rows = await db
      .select()
      .from(diagnosticReports)
      .orderBy(desc(diagnosticReports.receivedAt), desc(diagnosticReports.id))
      .limit(limit);

    return Response.json({ reports: rows });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
