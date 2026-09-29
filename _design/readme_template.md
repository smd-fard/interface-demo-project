# <Feature Title>

> **Status:** Draft · **PoC:** <name> · **Branch:** `feature/<slug>` · **Requirements:** <R-IDs>
> Detail: [spec](./spec.md) · [plan](./plan.md)

## Why

<1–3 short sentences: the problem, and which part of the through-line it serves. No solution, no file paths.>

## Before → After

| Axis         | Before     | After      |
| ------------ | ---------- | ---------- |
| <Contract>   | <one line> | <one line> |
| <Execution>  | <one line> | <one line> |
| <Safety>     | <one line> | <one line> |

**Before**

```mermaid
flowchart LR
  Cli["apps/cli"] --> Rep["replay-engine"]
  Rep --> Surf["surface"]
  Surf --> Bank["mock-bank"]
```

**After**

```mermaid
flowchart LR
  Cli["apps/cli"] --> Rep["replay-engine"]
  Rep --> Surf["surface"]
  Surf --> Bank["mock-bank"]
  Rep --> Cond["condition detector"]:::new
  Surf --> Loc["locator ladder"]:::changed

  classDef new fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
  classDef changed fill:#fff8e1,stroke:#f9a825,stroke-width:2px
  classDef removed fill:#ffebee,stroke:#c62828,stroke-dasharray:4 3
```

## High Level Design

- **<Component>** — <one sentence: what it is and why it exists.>
- **<Decision>** — <one sentence: the trade-off taken (link the ADR).>
- **<Boundary>** — <one sentence: what it deliberately does not own.>

## Low Level Design

- **<path/to/file.ts>** — <one sentence: key export, type, or method.>
- **<seam or contract>** — <one sentence.>

```mermaid
sequenceDiagram
  autonumber
  participant C as cli
  participant R as replay-engine
  participant S as surface
  C->>R: replay(artifact, params)
  R->>S: act(step)
  S-->>R: observation
  R-->>C: RunResult
```

## Impact

- **Touches:** <workspaces, comma separated>
- **Breaking:** <No, or the schema/contract break and for whom>
- **Deferred:** <what this explicitly does not do>
