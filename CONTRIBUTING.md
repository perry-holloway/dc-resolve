# Contributing

## Development setup

Install:

- Node.js 22.13 or newer
- pnpm 11 or newer
- Go 1.22 or newer

Web console:

```bash
pnpm install
pnpm run dev
```

Diagnostic agent:

```bash
cd dce-diag
go test ./...
```

## Before submitting a change

Run:

```bash
pnpm run build
pnpm run lint
cd dce-diag
go fmt ./...
go vet ./...
go test ./...
```

For probe changes:

- include parser tests with representative platform output;
- return `CANNOT_RUN` when evidence cannot be collected reliably;
- never convert missing telemetry into a false `PASS`;
- keep raw hardware output bounded before sending it to the collector;
- document platform-specific limitations.

For UI changes:

- preserve keyboard and touch behavior;
- use accessible labels for controls;
- clearly distinguish simulated actions from live hardware actions;
- keep repair guidance evidence-backed.

## Commit and pull-request guidance

Use focused commits and explain:

- what changed;
- why the change is needed;
- operator impact;
- validation performed;
- remaining limitations.

Do not commit generated binaries, local caches, credentials, machine logs, or
diagnostic evidence containing sensitive infrastructure identifiers.

