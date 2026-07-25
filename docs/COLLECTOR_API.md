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
```

using the identical `{ server_serial, tray_id, results }` shape documented
above. It upserts a `machines` row, inserts one `diagnostic_reports` row per
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
        resp, err := http.Post("https://<your-deployment>/api/reports", "application/json", bytes.NewReader(body))
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

The prototype does not yet provide:

- TLS termination;
- agent authentication or machine attestation;
- replay protection;
- authorization policy;
- rate limiting;
- metrics and tracing;
- protobuf/gRPC transport.

`/api/reports` gives the console durable report storage in D1, but it still
sits behind no authentication — place it behind an authenticated service
boundary before accepting reports from real machines.

