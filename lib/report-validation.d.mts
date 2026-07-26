export const REPORT_LIMITS: Readonly<{
  bodyBytes: number;
  results: number;
  identifier: number;
  testName: number;
  fruLocation: number;
  failureReason: number;
  detailsBytes: number;
  idempotencyKey: number;
}>;

export type NormalizedDiagnosticResult = {
  testName: string;
  status: "PASS" | "FAIL" | "CANNOT_RUN";
  fruLocation: string;
  failureReason: string;
  timestamp: string;
  details: string | null;
};

export type ReportValidation =
  | { ok: false; error: string }
  | {
      ok: true;
      value: {
        ingestKey: string;
        serverSerial: string;
        trayId: string;
        results: NormalizedDiagnosticResult[];
      };
    };

export function validateReportPayload(
  payload: unknown,
  idempotencyKey: string | null,
): ReportValidation;

export function activeRepairKey(
  machineId: string,
  fruLocation: string,
): string;
