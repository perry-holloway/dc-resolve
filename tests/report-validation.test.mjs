import assert from "node:assert/strict";
import test from "node:test";

import {
  activeRepairKey,
  REPORT_LIMITS,
  validateReportPayload,
} from "../lib/report-validation.mjs";

function report(overrides = {}) {
  return {
    server_serial: "SN-0421",
    tray_id: "R42-T03",
    report_id: "report-0421-1",
    results: [{
      test_name: "Memory_SAT_BurnIn",
      timestamp: "2026-07-25T15:00:00Z",
      status: "FAIL",
      fru_location: "DIMM_B1",
      failure_reason: "memory error",
    }],
    ...overrides,
  };
}

test("normalizes a valid diagnostic report", () => {
  const result = validateReportPayload(report(), null);
  assert.equal(result.ok, true);
  assert.equal(result.value.ingestKey, "report-0421-1");
  assert.equal(result.value.results[0].status, "FAIL");
});

test("accepts an Idempotency-Key when report_id is absent", () => {
  const payload = report();
  delete payload.report_id;
  const result = validateReportPayload(payload, "request-123");
  assert.equal(result.ok, true);
  assert.equal(result.value.ingestKey, "request-123");
});

test("rejects missing replay protection and unknown statuses", () => {
  const noKey = report();
  delete noKey.report_id;
  assert.equal(validateReportPayload(noKey, null).ok, false);

  const badStatus = report();
  badStatus.results[0].status = "BROKEN";
  assert.match(validateReportPayload(badStatus, null).error, /status/);
});

test("rejects invalid timestamps and oversized batches", () => {
  const badTimestamp = report();
  badTimestamp.results[0].timestamp = "yesterday";
  assert.match(validateReportPayload(badTimestamp, null).error, /ISO-8601/);

  const tooMany = report({
    results: Array.from({ length: REPORT_LIMITS.results + 1 }, () => ({
      test_name: "test",
      status: "PASS",
    })),
  });
  assert.match(validateReportPayload(tooMany, null).error, /between 1 and 128/);
});

test("rejects control characters in identity and repair fields", () => {
  assert.match(
    validateReportPayload(report({ server_serial: "SN\u001fOTHER" }), null).error,
    /server_serial/,
  );
  const badFru = report();
  badFru.results[0].fru_location = "DIMM\u001fA1";
  assert.match(validateReportPayload(badFru, null).error, /control characters/);
});

test("creates stable active repair keys", () => {
  assert.equal(activeRepairKey("SN-1", "DIMM_A1"), "SN-1\u001fDIMM_A1");
  assert.notEqual(
    activeRepairKey("SN-12", "DIMM_A1"),
    activeRepairKey("SN-1", "2DIMM_A1"),
  );
});
