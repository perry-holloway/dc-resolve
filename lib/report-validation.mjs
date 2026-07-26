const statuses = new Set(["PASS", "FAIL", "CANNOT_RUN"]);

export const REPORT_LIMITS = Object.freeze({
  bodyBytes: 1024 * 1024,
  results: 128,
  identifier: 128,
  testName: 128,
  fruLocation: 256,
  failureReason: 2048,
  detailsBytes: 256 * 1024,
  idempotencyKey: 128,
});

export function validateReportPayload(payload, idempotencyKey) {
  if (!isRecord(payload)) return failure("request body must be a JSON object");

  const serverSerial = cleanString(payload.server_serial);
  const trayId = cleanString(payload.tray_id);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const ingestKey = cleanString(payload.report_id) || cleanString(idempotencyKey);

  if (!ingestKey || ingestKey.length > REPORT_LIMITS.idempotencyKey) {
    return failure(
      "report_id or Idempotency-Key is required and must be at most 128 characters",
    );
  }
  if (
    !serverSerial ||
    !trayId ||
    hasControlCharacters(serverSerial) ||
    hasControlCharacters(trayId) ||
    serverSerial.length > REPORT_LIMITS.identifier ||
    trayId.length > REPORT_LIMITS.identifier
  ) {
    return failure(
      "server_serial and tray_id are required and must be at most 128 characters",
    );
  }
  if (results.length === 0 || results.length > REPORT_LIMITS.results) {
    return failure("results must contain between 1 and 128 entries");
  }

  const normalized = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!isRecord(result)) return failure(`results[${index}] must be an object`);

    const testName = cleanString(result.test_name);
    const status = cleanString(result.status);
    const fruLocation = cleanString(result.fru_location);
    const failureReason = cleanString(result.failure_reason);
    const timestamp = cleanString(result.timestamp);

    if (!testName || testName.length > REPORT_LIMITS.testName) {
      return failure(`results[${index}].test_name is invalid`);
    }
    if (
      [testName, fruLocation, failureReason].some(hasControlCharacters)
    ) {
      return failure(`results[${index}] contains control characters`);
    }
    if (!statuses.has(status)) {
      return failure(
        `results[${index}].status must be PASS, FAIL, or CANNOT_RUN`,
      );
    }
    if (fruLocation.length > REPORT_LIMITS.fruLocation) {
      return failure(`results[${index}].fru_location is too long`);
    }
    if (failureReason.length > REPORT_LIMITS.failureReason) {
      return failure(`results[${index}].failure_reason is too long`);
    }
    if (timestamp && Number.isNaN(Date.parse(timestamp))) {
      return failure(`results[${index}].timestamp must be ISO-8601`);
    }

    const details =
      result.details === undefined ? null : JSON.stringify(result.details);
    if (details !== null && details.length > REPORT_LIMITS.detailsBytes) {
      return failure(`results[${index}].details is too large`);
    }

    normalized.push({
      testName,
      status,
      fruLocation,
      failureReason,
      timestamp,
      details,
    });
  }

  return {
    ok: true,
    value: { ingestKey, serverSerial, trayId, results: normalized },
  };
}

export function activeRepairKey(machineId, fruLocation) {
  return `${machineId}\u001f${fruLocation || "UNSPECIFIED"}`;
}

function failure(error) {
  return { ok: false, error };
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
