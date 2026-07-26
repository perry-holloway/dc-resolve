# Using DC Resolve

DC Resolve has three operator surfaces:

1. the web operations console for visualizing repair work;
2. the Go diagnostic agent for executing hardware checks;
3. the local terminal dashboard for crash-cart and serial-console technicians.

## Get the project

```bash
git clone https://github.com/perry-holloway/dc-resolve.git
cd dc-resolve
```

## Web operations console

Requirements:

- Node.js 22.13 or newer;
- pnpm 11 or newer.

Install the dependencies and start the development server:

```bash
pnpm install
pnpm run dev
```

Open the local address printed by the server, normally
`http://localhost:3000`.

The web console currently uses representative fleet data. Its controls do not
yet launch physical diagnostics or BMC actions directly.

### Windows development

The package scripts use POSIX environment-variable syntax. In PowerShell, run
vinext directly:

```powershell
$env:WRANGLER_LOG_PATH = ".wrangler/wrangler.log"
.\node_modules\.bin\vinext.CMD dev
```

For a production build:

```powershell
$env:WRANGLER_LOG_PATH = ".wrangler/wrangler.log"
.\node_modules\.bin\vinext.CMD build
```

## Build the diagnostic agent

Requirements:

- Go 1.25 or newer.

From the repository root:

```bash
cd dce-diag
go mod download
go test ./...
go build -trimpath -o dce-diag ./cmd/dce-diag
```

On Windows:

```powershell
go build -trimpath -o dce-diag.exe ./cmd/dce-diag
```

## Run local diagnostics

### Memory

Run a short memory check:

```bash
./dce-diag --test-memory --mem-mb=1024 --mem-sec=15
```

The agent runs SAT when it is installed and otherwise uses the portable memory
pattern verifier.

### PCIe

```bash
./dce-diag --test-pcie
```

Linux uses `lspci -vvv`; macOS uses
`system_profiler SPPCIDataType -json`.

### NVMe SMART health

```bash
./dce-diag --test-nvme
```

Requires `smartctl` (smartmontools) on `PATH`. The probe scans for attached
NVMe devices, then reads each device's SMART health log and fails when a
device reports a non-zero critical-warning bitmask, one or more recorded media
errors, available spare below its threshold, or `percentage_used` at or above
the configured limit:

```bash
./dce-diag --test-nvme --nvme-max-percentage-used=80
```

`--nvme-max-percentage-used` defaults to `90`. When `smartctl` is missing or a
scan fails outright, the probe returns `CANNOT_RUN` rather than a false pass.

### Combined run

```bash
./dce-diag \
  --test-memory --mem-mb=1024 --mem-sec=15 \
  --test-pcie \
  --test-nvme
```

Without `--tui`, completed results are written as OCP-style JSON objects.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Every requested diagnostic passed |
| `1` | At least one diagnostic failed |
| `2` | The invocation was invalid or a diagnostic could not run |

## Local technician dashboard

Add `--tui` to display completed results interactively:

```bash
./dce-diag \
  --test-memory --mem-mb=1024 --mem-sec=15 \
  --test-pcie \
  --tui
```

Controls:

| Key | Action |
| --- | --- |
| `Up` or `k` | Select the previous result |
| `Down` or `j` | Select the next result |
| `q` or `Ctrl+C` | Exit |

The selected result displays its status, failure reason, FRU location, and
probe details.

## Redfish thermal and power diagnostics

Supply the BMC password through the environment instead of placing it in shell
history:

```bash
export BMC_PASSWORD='from-your-secret-manager'
```

PowerShell:

```powershell
$env:BMC_PASSWORD = "from-your-secret-manager"
```

Run the audit:

```bash
./dce-diag \
  --test-thermal \
  --tui \
  --bmc-url=https://192.0.2.10 \
  --bmc-user=diagnostics \
  --bmc-system-id=system \
  --bmc-chassis-id=chassis
```

The audit evaluates:

- CPU and chassis temperatures;
- fan speed and health;
- power-supply health;
- voltage rails;
- Redfish health states;
- critical upper and lower thresholds.

The Redfish resource IDs vary by vendor and platform. Query
`/redfish/v1/Systems` and `/redfish/v1/Chassis` on the target BMC to find the
correct IDs.

Use a trusted internal CA and a least-privilege BMC account. Do not disable TLS
verification in production.

## Persist diagnostic reports (D1)

The console reads and writes machine, report, and repair-order state through
a D1 database (`db/schema.ts`), not just simulated data. To turn that on for
a deployment:

1. Set `"d1": "DB"` in `.openai/hosting.json` so the platform provisions a D1
   database and binds it to `DB` (matching what `db/index.ts` expects).
2. Generate the migration SQL from the schema:

   ```bash
   npm run db:generate
   ```

3. Deploy the app so the platform applies the generated SQL in `drizzle/` to
   the real D1 database.
4. Configure a secret named `REPORT_INGEST_TOKEN` in the deployment. Generate
   at least 32 random bytes and store the same value in the diagnostic
   collector's secret manager. Never commit it to Git.

Once deployed, submit a report the same way you would to the Go collector:

```bash
curl -X POST https://<your-deployment>/api/reports \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${REPORT_INGEST_TOKEN}" \
  -H "Idempotency-Key: SN-0421-20260725T150000Z" \
  -d '{
    "server_serial": "SN-0421",
    "tray_id": "R42-T03",
    "results": [
      {
        "test_name": "Memory_SAT_BurnIn",
        "timestamp": "2026-07-25T15:00:00Z",
        "status": "FAIL",
        "fru_location": "DIMM_B1",
        "failure_reason": "memory hardware error detected during stress test"
      }
    ]
  }'
```

Every submission must include either an `Idempotency-Key` header or a unique
`report_id` field. Reusing a key returns a duplicate response instead of
creating duplicate reports or work orders. Payloads are limited to 1 MiB and
128 results.

The console's read and repair-order APIs require an authenticated console
session. The repair queue will then reflect ingested data instead of the
simulated fallback. See "Persistence (D1)" in
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the schema and route details.

## Cross-compile

Apple Silicon:

```bash
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
  go build -trimpath -o dce-diag-darwin-arm64 ./cmd/dce-diag
```

Intel Mac:

```bash
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 \
  go build -trimpath -o dce-diag-darwin-amd64 ./cmd/dce-diag
```

Linux x86-64:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -o dce-diag-linux-amd64 ./cmd/dce-diag
```

Windows x86-64:

```powershell
$env:CGO_ENABLED = "0"
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -trimpath -o dce-diag-windows-amd64.exe ./cmd/dce-diag
```

## Auto-remediation integration

The remediation engine is a Go integration API:

```go
bmc := probes.NewBMCClient(
    "https://192.0.2.10",
    "diagnostics",
    os.Getenv("BMC_PASSWORD"),
    "system",
)

engine := remediation.NewRemediationEngine(bmc)
if result.Status == ocp.StatusFail {
    _ = engine.ProcessFailure(serverSerial, result)
}
```

For a failed result, the engine:

1. requests a blinking chassis locate LED through Redfish;
2. generates a FRU replacement work-order payload;
3. continues ticket generation if BMC LED control fails.

The payload is currently logged. A Jira, ServiceNow, or internal repair-queue
adapter must be configured before tickets can be delivered externally.

## Netboot deployment

1. Build `dce-diag-linux-amd64`.
2. Add the binary and trusted CA bundle to an Alpine/LinuxKit initramfs.
3. Publish the kernel and initramfs on an internal HTTP boot server.
4. Replace the sample URL in `dce-diag/boot.ipxe`.
5. Test on a lab tray before enabling fleet-wide PXE boot.

Do not store BMC credentials in `boot.ipxe` or the initramfs. Provision
short-lived credentials only after establishing machine identity.

## Current production boundaries

- The web console is not yet connected to the Go collector.
- Jira and ServiceNow delivery adapters are not implemented.
- The collector currently uses HTTP/JSON rather than gRPC.
- Durable persistence, agent authentication, authorization, and audit retention
  remain deployment responsibilities.
- Thermal and power collection currently targets the chassis Redfish
  `Thermal` and `Power` resources; platforms using only newer subsystem
  resources may need an adapter.

