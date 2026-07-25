# Diagnostic agent guide

## Build

From `dce-diag/`:

```bash
go test ./...
go build -trimpath -o dce-diag ./cmd/dce-diag
```

No third-party Go modules are required.

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

### Combined run

```bash
./dce-diag --test-memory --mem-mb=4096 --mem-sec=300 --test-pcie
```

Results are emitted sequentially as formatted JSON objects.

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
- expected-device detection.

Hardware command execution should also be tested on representative Linux and
Mac systems before production use.

