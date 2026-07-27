import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { diagnosticReports } from "../../../db/schema";
import {
  requireConsoleUser,
  requireReportIngestToken,
} from "../../../lib/api-auth";
import { REPORT_LIMITS, validateReportPayload } from "../../../lib/report-validation.mjs";
import { ingestDiagnosticReport } from "../../../lib/report-ingestion";

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
    const ingestion = await ingestDiagnosticReport(validation.value);
    return Response.json(ingestion, { status: ingestion.statusCode });
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
