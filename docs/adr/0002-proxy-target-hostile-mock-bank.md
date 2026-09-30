# ADR-0002: Proxy target: a local, deliberately hostile mock-bank

| Field          | Value                                                     |
| -------------- | --------------------------------------------------------- |
| Status         | Accepted                                                  |
| Date           | 2026-09-29                                                |
| Requirements   | R1.3, R3.2, R3.3, R4.3, R7.2, R-REAL, D3, invariant 7     |
| Report section | 1                                                         |
| Spec           | `_design/computer-use-automation-system/spec.md`          |

## Context

The brief targets legacy bank back-office apps with no API, and asks us to bias toward mechanisms that work
without a clean DOM (R1.3). We cannot reach a real core-banking system, and invariant 7 forbids real PII, real
credentials, and real bank or public sites without approval. Whatever we drive must still be a live UI for the
real discovery run (R-REAL). It must also be able to show, on demand, every runtime condition R3.3 lists
(not found, validation error, permission denial, dialogs, session timeout, slow or failed load, app error). The
evidence needs at least one replay that hits an exceptional state (D3), and R7.2 needs a second tenant of the
same app. A friendly modern site would make the locator and perception work look easier than it is.

## Options

### A. A public demo banking site (e.g. a well-known intentionally-vulnerable test bank)

- ➕ No target code to write; a third party built it, so it looks less like we tuned the target to our agent.
- ➖ Terms of service and invariant 7: automated agent traffic against a public site needs approval we do not
  have, and its "demo" data may not be clearly synthetic.
- ➖ No fault control. We cannot force a session timeout, a 503 or an unknown dialog at a chosen step, so R3.3
  and the D3 error-path evidence become luck. No tenant variant for R7.2.
- ➖ Unstable: it can change or go offline, and then CI and the committed demo path break. Most such sites are
  also clean, modern HTML, not framesets.

### B. A commercial legacy-app sandbox, or a recorded HAR replayed offline

- ➕ A vendor sandbox is the most realistic markup and behaviour.
- ➕ HAR replay is deterministic and offline.
- ➖ A sandbox needs licences and credentials, which do not fit a take-home repo that others must run with one
  command (D1), and it still has no fault switches.
- ➖ HAR replay is not a live UI: posted forms, session state and native dialogs do not behave, so it cannot
  host a real discovery run (R-REAL) or a human handoff on the same session (R6.2).

### C. A local, deliberately hostile mock app (chosen)

- ➕ Full control of hostility, faults, tenants and data; runs offline in tests and CI.
- ➖ We wrote the target, so a reviewer can suspect it is shaped to our solution (see Consequences).

## Decision

Option C. `apps/mock-bank` ("CoreOne") is server-rendered HTML on `node:http` with no runtime dependencies. It has a
`banner`/`nav`/`content` frameset, layout tables nested three or more deep, labels in adjacent `<td>`s, generic
control names (`txt1`, `btnGo`), and no ids, test ids or ARIA. Messages are `<font color="red">` text, and the
irreversible Confirm uses an inline `window.confirm`. Eleven fault codes (`src/faults/faultCodes.ts`) are armed
through `MOCKBANK_FAULTS` or `POST /__admin/faults`. Each has a `once`/`always` mode and a route filter, and none
fires at random (`FaultSwitch`). A tenant-B config (`src/tenants/tenants.ts`) relabels "Member #" to "Account
holder ID" and "Search" to "Find", reorders the menu and changes the version, all on shared code. The data set
(`src/data/members.ts`) has three synthetic members with 900-range SSNs and made-up `8800…` account numbers,
shown in full on Member Inquiry so that redaction has something to catch. The deciding reason: only C lets every
R3.3 condition be reproduced deterministically in a test, with no ToS or data risk.

The target is a black box. `layers.json` lists it as `isolated`, and BND003 plus ESLint forbid imports in either
direction. Functional tests in `surface`, `replay-engine` and `agent` start `dist/main.js` as a separate process
through `@idp/surface/testing`'s `launchMockBank` and control faults only over HTTP.

## Consequences

- **Easier:** each runtime condition has an injected-fault test with an exact `RunResult`. The tenant-B drift
  replay runs as a real test. Tests, CI and demos run offline with synthetic data, and there is nothing to
  redact from real people.
- **Harder:** we built the target, so its realism is our claim, not a fact. The hostility is a sample; it has
  no Java applets, ActiveX, terminal emulation or desktop client. Screen texts, titles and control names are
  now a public contract with the fixtures in `packages/artifact-schema/fixtures/` and must change together.
  The `/__admin/**` API exists only for tests, so policy must never allow it. We maintain an extra app.
- **Revisit when:** access to a real vendor sandbox or a customer staging tenant is approved. Or when the
  agent does well on the mock but fails on real legacy markup, which would show the mock is too kind. Also
  when a desktop surface is added, since this target is web only.
