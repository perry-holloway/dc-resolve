# Collector API

The collector package provides a small HTTP/JSON ingestion service for
completed diagnostic reports.

## Start a server

Embed the package in a service entrypoint:

```go
package main

import (
	"log"

	"dce-diag/pkg/collector"
)

func main() {
	server := &collector.CollectorServer{
		OnReport: func(report collector.DiagnosticReport, receipt collector.Receipt) error {
			// Persist the report, emit telemetry, or create a repair order.
			return nil
		},
	}
	log.Fatal(collector.StartHTTPCollector(8080, server))
}
```

## Health check

```http
GET /healthz
```

Response:

```json
{
  "status": "ok"
}
```

## Submit a report

```http
POST /v1/reports
Content-Type: application/json
```

Example:

```json
{
  "server_serial": "SN-0421",
  "tray_id": "R42-T03",
  "results": [
    {
      "test_name": "PCIe_Topology_Check",
      "timestamp": "2026-07-25T15:00:00Z",
      "status": "FAIL",
      "fru_location": "RISER_CARD_OR_BUS",
      "failure_reason": "found 1 degraded and 0 missing PCIe device(s)"
    }
  ]
}
```

Accepted response:

```http
HTTP/1.1 202 Accepted
Content-Type: application/json
```

```json
{
  "accepted_at": "2026-07-25T15:00:01Z",
  "status": "FAIL",
  "failures": 1
}
```

## Validation

- Maximum request body: 2 MiB.
- Unknown fields: rejected.
- Required fields: `server_serial`, `tray_id`, and at least one result.
- Validation failure: `422 Unprocessable Entity`.
- Invalid JSON: `400 Bad Request`.

## Persisting reports to the operations console

This package's `OnReport` callback is the extension point for persistence —
it does not persist reports on its own. The operations console app
(`app/`) has a separate, D1-backed ingestion endpoint that accepts the exact
same JSON body:

```http
POST /api/reports
Content-Type: application/json
Authorization: Bearer <REPORT_INGEST_TOKEN>
Idempotency-Key: <globally unique report key>
```

using the same `{ server_serial, tray_id, results }` shape documented above.
The deployment must define `REPORT_INGEST_TOKEN`, and each request must include
either `Idempotency-Key` or a `report_id` body field. It upserts a `machines`
row, inserts one `diagnostic_reports` row per
result, and opens a `repair_orders` row for any `FAIL` result that doesn't
already have one open. See `db/schema.ts` and `app/api/reports/route.ts`.

To have this collector persist into that database, forward accepted reports
from `OnReport`:

```go
server := &collector.CollectorServer{
    OnReport: func(report collector.DiagnosticReport, receipt collector.Receipt) error {
        body, err := json.Marshal(report)
        if err != nil {
            return err
        }
        req, err := http.NewRequest(http.MethodPost, "https://<your-deployment>/api/reports", bytes.NewReader(body))
        if err != nil {
            return err
        }
        req.Header.Set("Content-Type", "application/json")
        req.Header.Set("Authorization", "Bearer "+os.Getenv("REPORT_INGEST_TOKEN"))
        req.Header.Set("Idempotency-Key",
            fmt.Sprintf("%s-%d", report.ServerSerial, receipt.AcceptedAt.UnixNano()))
        resp, err := http.DefaultClient.Do(req)
        if err != nil {
            return err
        }
        defer resp.Body.Close()
        return nil
    },
}
```

Alternatively, agents can skip this standalone collector entirely and submit
directly to `/api/reports`.

## Production requirements

The standalone Go collector does not yet provide:

- TLS termination;
- agent authentication or machine attestation;
- rate limiting;
- metrics and tracing;
- protobuf/gRPC transport.

The D1 endpoint enforces a bearer ingestion token, bounded payload validation,
and idempotent writes. For internet-facing production deployments, also place
it behind network-layer rate limiting and machine identity or attestation.

