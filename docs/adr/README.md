# Architecture Decision Records

One decision per file, created with `/define-adr`. `REPORT.md` cites these instead of repeating them.

| ADR | Title | Status | Report § | Requirements |
| --- | ----- | ------ | -------- | ------------ |
| [0001](./0001-stack-and-workspace-layout.md) | Stack and workspace layout | Accepted | 1 | D1, R3.1, R7.1 |
| [0002](./0002-proxy-target-hostile-mock-bank.md) | Proxy target: a local, deliberately hostile mock-bank | Accepted | 1 | R1.3, R3.2, R3.3, R4.3, R7.2, R-REAL, D3, invariant 7 |
| [0003](./0003-artifact-schema-and-locator-ladder.md) | Capability artifact schema and the locator ladder | Accepted | 2 | R2.1–R2.7, R3.2, R7.1, R7.2 |
| [0004](./0004-result-contract-and-runtime-condition-taxonomy.md) | Result contract and runtime-condition taxonomy | Accepted | 3 | R3.3, R3.4, R3.5, R5.2, R6.1, R7.1 |
| [0005](./0005-policy-risk-classes-and-approval.md) | Policy, risk classes and human approval for irreversible actions | Accepted | 6 | R4.1, R4.2, R6.1, R6.3 |
| [0006](./0006-control-transfer-lease-and-mediated-human-control.md) | Control transfer: a control lease, mediated human control on the same session, and a localhost control API | Accepted | 5 | R6.1, R6.2, R6.3, R6.4, R4.1, R4.2, R4.3 |
| [0007](./0007-surface-abstraction-a11y-first.md) | Surface abstraction, accessibility tree first | Accepted | 4 | R1.3, R7.1, R2.3, R3.2, R5.2 |
| [0008](./0008-multi-tenant-reuse-base-overrides-and-drift.md) | Multi-tenant reuse: per-tenant profiles, base artifact + overrides, drift from rung fallback | Accepted | 4 | R7.2, R3.2, R3.4, S5, D2 |
| [0009](./0009-redaction-model-and-evidence-sinks.md) | Redaction model and evidence sinks | Accepted | 6 | R4.3, R5.1, R5.2, R6.1 |
