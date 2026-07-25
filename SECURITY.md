# Security

## Current maturity

DC Resolve is a prototype and is not ready to control production hardware
without additional security controls.

## Sensitive data

Diagnostic reports can contain:

- server serial numbers;
- rack and tray identifiers;
- FRU and part numbers;
- hardware event logs;
- topology and firmware information.

Treat these reports as confidential infrastructure data. Do not include real
credentials, API keys, BMC passwords, customer data, or unrestricted raw logs in
issues or pull requests.

## Production hardening checklist

- Authenticate every diagnostic agent.
- Authorize each agent for an explicit machine identity.
- Encrypt all agent, collector, BMC, and browser traffic.
- Use short-lived credentials from a managed secret store.
- Prevent report replay and enforce timestamps.
- Rate-limit ingestion and bound every input.
- Store an immutable audit record for repair and BMC actions.
- Require explicit authorization for locate-LED, power, and machine-state
  transitions.
- Sanitize hardware output before rendering it in a browser.
- Separate read-only diagnostics from destructive repair actions.
- Run the agent with the minimum operating-system privileges.

## Reporting a vulnerability

Keep this repository private while the project is under development. Report
security concerns directly to the repository owner rather than opening a public
issue.

