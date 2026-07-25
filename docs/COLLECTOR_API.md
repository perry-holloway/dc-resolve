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

## Production requirements

The prototype does not yet provide:

- TLS termination;
- agent authentication or machine attestation;
- replay protection;
- authorization policy;
- durable report storage;
- rate limiting;
- metrics and tracing;
- protobuf/gRPC transport.

Place it behind an authenticated service boundary before accepting reports from
real machines.

