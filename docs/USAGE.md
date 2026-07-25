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

### Combined run

```bash
./dce-diag \
  --test-memory --mem-mb=1024 --mem-sec=15 \
  --test-pcie
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

