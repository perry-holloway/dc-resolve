import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { diagnosticReports, machines, repairOrders } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { requireConsoleUser } from "../../../lib/api-auth";
import { activeRepairKey } from "../../../lib/report-validation.mjs";

const activeStatuses = ["open", "in_progress"] as const;
const orderStatuses = [...activeStatuses, "resolved"] as const;

export async function GET(request: Request) {
  const authFailure = await requireConsoleUser();
  if (authFailure) return authFailure;

  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");
    const limitParam = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.trunc(limitParam), 200)
        : 100;

    const db = getDb();
    const query = db
      .select()
      .from(repairOrders)
      .orderBy(desc(repairOrders.createdAt))
      .limit(limit);

    const rows = orderStatuses.includes(
      statusFilter as (typeof orderStatuses)[number],
    )
      ? await query.where(
          eq(
            repairOrders.status,
            statusFilter as (typeof orderStatuses)[number],
          ),
        )
      : await query;

    return Response.json({ repair_orders: rows });
  } catch (error) {
    console.error("repair-order listing failed", error);
    return Response.json({ error: "repair-order listing failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authFailure = await requireConsoleUser();
  if (authFailure) return authFailure;
  const user = await getChatGPTUser();

  let payload: {
    machine_id?: unknown;
    fru_location?: unknown;
    part?: unknown;
    reason?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const machineId = cleanBoundedString(payload.machine_id, 128);
  const fruLocation = cleanBoundedString(payload.fru_location, 256);
  const part = cleanBoundedString(payload.part, 256);
  const reason = cleanBoundedString(payload.reason, 2048);
  if (!machineId || !fruLocation) {
    return Response.json(
      { error: "machine_id and fru_location are required and must be valid" },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const [machine] = await db
      .select({ id: machines.id })
      .from(machines)
      .where(eq(machines.id, machineId))
      .limit(1);
    if (!machine) {
      return Response.json({ error: "machine not found" }, { status: 404 });
    }

    const [repairOrder] = await db
      .insert(repairOrders)
      .values({
        machineId,
        fruLocation,
        part,
        reason,
        activeKey: activeRepairKey(machineId, fruLocation),
        createdBy: user?.email ?? "console-user",
      })
      .onConflictDoNothing({ target: repairOrders.activeKey })
      .returning();
    if (!repairOrder) {
      return Response.json(
        { error: "an active repair order already exists for this FRU" },
        { status: 409 },
      );
    }

    await db
      .update(machines)
      .set({ status: "critical" })
      .where(eq(machines.id, machineId));

    return Response.json({ repair_order: repairOrder }, { status: 201 });
  } catch (error) {
    console.error("repair-order creation failed", error);
    return Response.json({ error: "repair-order creation failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const authFailure = await requireConsoleUser();
  if (authFailure) return authFailure;

  let payload: { id?: unknown; status?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }
  if (
    typeof payload.id !== "number" ||
    !Number.isSafeInteger(payload.id) ||
    !orderStatuses.includes(payload.status as (typeof orderStatuses)[number])
  ) {
    return Response.json(
      { error: "id and a valid repair-order status are required" },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(repairOrders)
      .where(eq(repairOrders.id, payload.id))
      .limit(1);
    if (!existing) {
      return Response.json({ error: "repair order not found" }, { status: 404 });
    }

    const status = payload.status as (typeof orderStatuses)[number];
    const [repairOrder] = await db
      .update(repairOrders)
      .set({
        status,
        activeKey:
          status === "resolved"
            ? null
            : activeRepairKey(existing.machineId, existing.fruLocation),
        resolvedAt: status === "resolved" ? new Date().toISOString() : null,
      })
      .where(eq(repairOrders.id, payload.id))
      .returning();

    await refreshMachineStatus(existing.machineId);
    return Response.json({ repair_order: repairOrder });
  } catch (error) {
    console.error("repair-order update failed", error);
    return Response.json({ error: "repair-order update failed" }, { status: 500 });
  }
}

async function refreshMachineStatus(machineId: string) {
  const db = getDb();
  const [activeOrder] = await db
    .select({ id: repairOrders.id })
    .from(repairOrders)
    .where(
      and(
        eq(repairOrders.machineId, machineId),
        inArray(repairOrders.status, activeStatuses),
      ),
    )
    .limit(1);

  let status: "critical" | "investigating" | "healthy" = activeOrder
    ? "critical"
    : "healthy";
  if (!activeOrder) {
    const [latest] = await db
      .select({ status: diagnosticReports.status })
      .from(diagnosticReports)
      .where(eq(diagnosticReports.machineId, machineId))
      .orderBy(
        desc(diagnosticReports.resultTimestamp),
        desc(diagnosticReports.id),
      )
      .limit(1);
    if (latest?.status === "CANNOT_RUN") status = "investigating";
  }
  await db.update(machines).set({ status }).where(eq(machines.id, machineId));
}

function cleanBoundedString(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  return cleaned.length <= maxLength ? cleaned : "";
}
