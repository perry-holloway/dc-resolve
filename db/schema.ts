import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * One row per machine the fleet has ever reported on. `status` is a rollup
 * derived from that machine's most recent diagnostic results (see
 * app/api/reports/route.ts) — it is not itself a source of truth.
 */
export const machines = sqliteTable("machines", {
  // Server serial number. Matches DiagnosticReport.server_serial from the
  // Go agent/collector (dce-diag/pkg/collector).
  id: text("id").primaryKey(),
  rack: text("rack").notNull().default(""),
  tray: text("tray").notNull().default(""),
  status: text("status")
    .$type<"critical" | "degraded" | "investigating" | "healthy">()
    .notNull()
    .default("healthy"),
  lastReportAt: text("last_report_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * One row per ocp.DiagnosticResult received in a submitted
 * DiagnosticReport. This is the durable evidence trail behind a machine's
 * current status and behind any repair order raised from it.
 */
export const diagnosticReports = sqliteTable(
  "diagnostic_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    machineId: text("machine_id")
      .notNull()
      .references(() => machines.id),
    ingestKey: text("ingest_key").notNull(),
    resultIndex: integer("result_index").notNull(),
    testName: text("test_name").notNull(),
    status: text("status").$type<"PASS" | "FAIL" | "CANNOT_RUN">().notNull(),
    fruLocation: text("fru_location").notNull().default(""),
    failureReason: text("failure_reason").notNull().default(""),
    // Raw `details` payload from the probe, stored as JSON text. Shape varies
    // per test_name (see pkg/ocp.DiagnosticResult.Details in the Go agent).
    details: text("details"),
    // Timestamp the probe itself recorded, as an ISO-8601 string.
    resultTimestamp: text("result_timestamp").notNull(),
    receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("diagnostic_reports_ingest_result_uq").on(
      table.ingestKey,
      table.resultIndex,
    ),
    index("diagnostic_reports_machine_time_idx").on(
      table.machineId,
      table.resultTimestamp,
    ),
  ],
);

/**
 * A repair action against a machine's FRU. Opened automatically when an
 * ingested report contains a FAIL result (see app/api/reports/route.ts),
 * and can also be created directly from the console.
 */
export const repairOrders = sqliteTable(
  "repair_orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    machineId: text("machine_id")
      .notNull()
      .references(() => machines.id),
    fruLocation: text("fru_location").notNull(),
    part: text("part").notNull().default(""),
    reason: text("reason").notNull().default(""),
    status: text("status")
      .$type<"open" | "in_progress" | "resolved">()
      .notNull()
      .default("open"),
    // Unique while an order is active; set to null when it is resolved.
    activeKey: text("active_key"),
    createdBy: text("created_by").notNull().default("system"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    uniqueIndex("repair_orders_active_key_uq").on(table.activeKey),
    index("repair_orders_machine_status_idx").on(table.machineId, table.status),
  ],
);
