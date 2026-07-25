# Diagnostic agent guide

## Build

From `dce-diag/`:

```bash
go test ./...
go build -trimpath -o dce-diag ./cmd/dce-diag
```

The dashboard uses Bubble Tea v2. Run `go mod download` before building in an
offline or image-build environment.

## Command-line reference

```text
-test-memory
    Run SAT or the portable memory verifier.

-mem-mb int
    Memory allocation in MiB. Default: 1024.

-mem-sec int
    Test duration in seconds. Default: 30.

-target-channel string
    Optional physical channel or board label.

-test-pcie
    Audit PCIe inventory and negotiated links.

-test-thermal
    Audit Redfish temperatures, fans, power supplies, and voltage rails.

-test-nvme
    Audit NVMe SMART health using smartctl.

-nvme-max-percentage-used int
    Degrade an NVMe device once percentage_used reaches this value. Default: 90.

-tui
    Show results in the interactive local field dashboard instead of JSON.

-bmc-url string
    Redfish BMC base URL. Required by -test-thermal.

-bmc-user string
    Redfish username. Read the password from BMC_PASSWORD.

-bmc-system-id string
    Redfish Systems resource ID. Default: system.

-bmc-chassis-id string
    Redfish Chassis resource ID. Default: chassis.
```

At least one test flag is required.

## Examples

### Fast development check

```bash
./dce-diag --test-memory --mem-mb=64 --mem-sec=2
```

### Production-style memory burn-in

```bash
./dce-diag --test-memory --mem-mb=8192 --mem-sec=900
```

Choose a memory allocation that leaves enough RAM for the operating system and
other processes. Excessive allocations can trigger swapping or allocation
failure.

### PCIe audit

```bash
sudo ./dce-diag --test-pcie
```

Some Linux systems require elevated privileges for complete `lspci -vvv`
details.

### NVMe SMART audit

```bash
./dce-diag --test-nvme --nvme-max-percentage-used=80
```

Requires `smartctl` (smartmontools). Reading raw NVMe SMART logs on Linux
typically requires elevated privileges:

```bash
sudo ./dce-diag --test-nvme
```

### Combined run

```bash
./dce-diag --test-memory --mem-mb=4096 --mem-sec=300 --test-pcie --test-nvme
```

Results are emitted sequentially as formatted JSON objects.

### Crash-cart dashboard with thermal telemetry

```bash
export BMC_PASSWORD='from-your-secret-manager'
./dce-diag \
  --test-memory --mem-mb=4096 --mem-sec=300 \
  --test-pcie --test-thermal --tui \
  --bmc-url=https://192.0.2.10 \
  --bmc-user=diagnostics \
  --bmc-chassis-id=chassis
```

Use the arrow keys or `j`/`k` to select a result and `q` to exit. The thermal
probe fails readings whose Redfish health is not `OK` or whose value reaches a
critical minimum/maximum threshold.

## Cross-compilation

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

## macOS installation

Select the binary matching the machine:

- `darwin-arm64` for Apple Silicon;
- `darwin-amd64` for Intel.

Then:

```bash
mv dce-diag-darwin-arm64 dce-diag
chmod +x dce-diag
./dce-diag --test-memory --mem-mb=1024 --mem-sec=15 --test-pcie
```

The binaries are not code-signed. If macOS blocks a transferred binary, prefer
building it locally from source. Do not bypass organizational endpoint-security
policy.

## Testing

```bash
go test ./...
go test -race ./...
go vet ./...
```

The existing tests cover:

- DIMM-label extraction;
- portable memory verification;
- Linux PCIe topology parsing;
- expected-device detection;
- Redfish temperature, fan, PSU, and voltage handling;
- terminal-dashboard navigation and rendering.

Hardware command execution should also be tested on representative Linux and
Mac systems before production use.

## Field remediation

Create a BMC client and pass it to the remediation engine:

```go
bmc := probes.NewBMCClient(
    "https://bmc.example.internal",
    os.Getenv("BMC_USERNAME"),
    os.Getenv("BMC_PASSWORD"),
    "system",
)
engine := remediation.NewRemediationEngine(bmc)

if result.Status == ocp.StatusFail {
    _ = engine.ProcessFailure(serverSerial, result)
}
```

`ProcessFailure` requests a blinking Redfish `IndicatorLED`, then generates a
FRU replacement work-order payload. Locate-LED errors are non-fatal so a BMC
connectivity problem does not suppress ticket creation. Keep BMC credentials in
a secret manager and use a trusted TLS configuration in production.

## Netboot deployment

1. Build a static Linux binary:

   ```bash
   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
     go build -trimpath -o dce-diag-linux-amd64 ./cmd/dce-diag
   ```

2. Copy the binary and its trusted CA bundle into a minimal Alpine/LinuxKit
   initramfs.
3. Publish the kernel and initramfs on the management-network HTTP boot server.
4. Customize `boot.ipxe` with the internal artifact URL.
5. Boot a lab tray and verify serial-console input, BMC reachability, report
   delivery, and safe reprovisioning before fleet rollout.

Never embed BMC credentials in `boot.ipxe` or the initramfs. Issue short-lived
credentials after the diagnostic environment establishes machine identity.
