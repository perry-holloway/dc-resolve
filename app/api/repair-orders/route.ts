import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { repairOrders } from "../../../db/schema";

function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table")) {
    return "The repair_orders table is unavailable. Generate the migration locally with `npm run db:generate`, then deploy so the platform can apply the generated SQL to the real D1 database.";
  }

  return message;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");

    const db = getDb();
    const query = db.select().from(repairOrders).orderBy(desc(repairOrders.createdAt));

    const rows =
      statusFilter === "open" || statusFilter === "in_progress" || statusFilter === "resolved"
        ? await query.where(eq(repairOrders.status, statusFilter))
        : await query;

    return Response.json({ repair_orders: rows });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      machine_id?: string;
      fru_location?: string;
      part?: string;
      reason?: string;
    };
    const machineId = payload.machine_id?.trim() ?? "";
    const fruLocation = payload.fru_location?.trim() ?? "";

    if (!machineId || !fruLocation) {
      return Response.json(
        { error: "machine_id and fru_location are required" },
        { status: 400 },
      );
    }

    const db = getDb();
    const [repairOrder] = await db
      .insert(repairOrders)
      .values({
        machineId,
        fruLocation,
        part: payload.part?.trim() ?? "",
        reason: payload.reason?.trim() ?? "",
      })
      .returning();

    return Response.json({ repair_order: repairOrder }, { status: 201 });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as { id?: number; status?: string };
    if (
      typeof payload.id !== "number" ||
      (payload.status !== "open" && payload.status !== "in_progress" && payload.status !== "resolved")
    ) {
      return Response.json(
        { error: "id (number) and status ('open' | 'in_progress' | 'resolved') are required" },
        { status: 400 },
      );
    }

    const db = getDb();
    const [repairOrder] = await db
      .update(repairOrders)
      .set({
        status: payload.status,
        resolvedAt: payload.status === "resolved" ? new Date().toISOString() : null,
      })
      .where(eq(repairOrders.id, payload.id))
      .returning();

    if (!repairOrder) {
      return Response.json({ error: "repair order not found" }, { status: 404 });
    }

    return Response.json({ repair_order: repairOrder });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
