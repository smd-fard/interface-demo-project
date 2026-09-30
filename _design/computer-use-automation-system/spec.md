# Spec for computer-use-automation-system

branch: `feature/computer-use-automation-system`

| Field             | Value                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PoC               | Mos Fard                                                                                                                                                                                                                                                                                                                                               |
| Date              | 2026-09-29                                                                                                                                                                                                                                                                                                                                             |
| Status            | Draft                                                                                                                                                                                                                                                                                                                                                  |
| Requirements      | R1.1–R1.3, R2.1–R2.7, R3.1–R3.5, R4.1–R4.3, R5.1–R5.2, R6.1–R6.4, R7.1–R7.2, R-REAL, D1–D3                                                                                                                                                                                                                                                             |
| Affected packages | All shells get their first real code, sliced by roadmap specs 02–11: `packages/artifact-schema`, `packages/policy`, `packages/evidence`, `packages/surface`, `packages/session`, `packages/replay-engine`, `packages/agent`, `apps/cli`, `apps/operator`, `apps/mock-bank`; **new** top-level `evidence/`, `REPORT.md`; root `README.md` (demo path)       |
| Contract impact   | Introduces the first public contracts: capability artifact `schemaVersion` **1.0.0** (steps, locator ladder, params, outputs, checkpoints, outcome rules, provenance), the `RunResult` union, and the `InterventionRequest`. Each gets a JSON Schema export. No prior version exists, so nothing breaks.                                                 |
| Safety impact     | New action types with risk classes (`navigate`, `click`, `fill`, `select`, `press`, `extract`, `wait`, `dismiss_dialog`). New sinks: run log, evidence store, artifact files, intervention requests, LLM prompts; all pass through the redaction layer. New config: allowlist (origins/routes/action types), irreversible-action rules, redaction rules. A credential reference for the target login, read from `.env`. |

---

## Summary

This is the umbrella spec for the whole system: the end-to-end vertical slice the brief asks for (§5). Today
the repo is a buildable monorepo with eleven empty shells and enforced dependency boundaries
(`monorepo-foundation`). No schema, surface, agent, replay, policy or target app exists yet.

After this change (delivered through roadmap specs 02–11, each of which refines one slice of this spec
and cites it) one thread runs all the way through. An operator gives a natural-language goal and a
target. A Claude-driven observe → decide → act loop completes it on a deliberately hostile legacy
core-banking app (`mock-bank`). The successful run compiles into a typed, versioned, parameterized
**capability artifact**. That artifact replays deterministically, with params and no LLM, and returns
`success`, `business_outcome` or `failure`. It detects and deliberately handles the runtime conditions a
bank back-office app really produces. When the system is stuck, or is about to take an irreversible
action, it pauses, raises an intervention request, hands the **same live session** to a human, records
what the human does, and resumes. Every action passes the policy, and every sink sees only redacted data.

This spec fixes the system-level behaviour, the cross-slice decisions and the end-to-end acceptance
criteria. Slice specs may add detail but must not contradict it. A change to this spec is made here
first.

## Functional Requirements

**Target (proxy for the legacy bank app)**

- FR1 — A local target app, `mock-bank`, serves a legacy-style core-banking UI with synthetic data only:
  login → member search → member detail (balances) → open sub-account → confirmation. It uses
  framesets/iframes, nested layout tables and non-semantic markup, and has no test IDs. (enables R1.3,
  R3.3, R6)
- FR2 — `mock-bank` exposes fault switches that reproduce each runtime condition on demand: member not
  found, validation error, permission denied, unexpected dialog, session timeout, slow load, failed load
  and app error. It also serves a tenant-B variant (relabelled or re-versioned) for the R7.2 design
  story. (R3.3, R7.2)

**Discover**

- FR3 — `discover` accepts a natural-language goal, a target entry URL, and optional named example
  inputs (e.g. `memberId=12345`). (R1.1)
- FR4 — Discovery runs an LLM loop: observe (a redacted accessibility-tree snapshot of the current
  surface, frames included) → decide (one tool call with a short stated reason) → act (through the
  `Surface`, after the policy check). It repeats until the model declares the goal met and the declared
  final checkpoint holds, or until a stop condition fires: max steps, wall-clock timeout, dead end
  (repeated no-progress observations), or a policy refusal the model cannot route around. Each stop
  reason is distinct in the run result. (R1.2)
- FR5 — The agent interacts with the real UI: navigate, click, type, select, press keys, read and extract
  state. Perception relies on the accessibility tree, not on CSS selectors or DOM ids. (R1.3)

**Compile**

- FR6 — Only a discovery run that met its goal compiles into a capability artifact. The artifact is JSON,
  validates against the published JSON Schema, and is stored apart from the model transcript. The
  transcript is evidence, not part of the artifact. (R2.1)
- FR7 — The artifact contains: identity (id, title, human-readable summary of what it does, needs and
  returns), `schemaVersion`, capability semver, a content hash, provenance (discovery run ref, target
  app/variant, date), typed input params (with a `sensitive` flag), typed outputs, ordered steps (action
  type, target, param references, risk class), a checkpoint after every screen-changing step, a final
  success condition, and outcome rules that map detectable screen states to business outcomes. (R2.2,
  R2.4–R2.7)
- FR8 — Each step target carries a **locator ladder**: an ordered list of independent ways to find the
  same control (accessible role + name → label/visible text → frame-scoped structural anchor such as
  "the cell right of the header 'Savings'"), each with a stated robustness rationale. (R2.3)
- FR9 — The compiler lifts the concrete values used during discovery into parameter references
  (`{{memberId}}`). It never writes the concrete sensitive value into the artifact. Credentials never
  appear in an artifact. Login steps reference a named credential. (R2.4, R4.3)

**Replay**

- FR10 — `replay` takes an artifact and params, validates the params against the artifact's params
  schema before any action, and executes the steps with no dependency on the model. The replay engine
  does not import `@idp/agent`, directly or transitively. (R3.1)
- FR11 — For each step, replay resolves the target by walking the locator ladder in order, records which
  rung matched, performs the action, and verifies the step's checkpoint within a bounded wait. A lower
  rung matching is logged as a drift signal, not treated as an error. (R3.2)
- FR12 — After the last step, replay verifies the final success condition, extracts the declared outputs,
  validates them against the outputs schema, and returns them. (R3.2, R2.5)
- FR13 — Replay detects each runtime condition and responds according to its class (see Decisions →
  runtime-condition taxonomy): return a business outcome, recover within a bounded budget and log it, or
  stop as a hard failure with evidence. A checkpoint that does not hold is never ignored. (R3.3, R3.4)
- FR14 — Every replay returns exactly one `RunResult`: `success` (outputs), `business_outcome` (code +
  redacted message), or `failure` (step index/id, expected, observed, evidence refs, optional intervention
  request ref). Recoverable conditions never appear as the result kind. They appear in the run log. (R3.4,
  R3.5)

**Guard**

- FR15 — A configurable allowlist lists permitted origins/routes and action types. Every agent tool call,
  replay step and recorded human action is checked against it before it runs. A disallowed action is
  refused, logged and never executed. (R4.1)
- FR16 — Every action type has a risk class: `read`, `reversible` or `irreversible`. A step's class can be
  raised by the policy's irreversible rules (e.g. a click on a control named "Confirm", "Submit" or "Open
  account", or on a route marked irreversible) and can never be lowered. Before any irreversible action,
  in discovery or replay, automation pauses and raises an intervention request for human approval. It
  continues only after an explicit approval on the same session. (R4.2, R6.1)
- FR17 — A redaction layer sits in front of every sink: run log, evidence files, artifacts, intervention
  requests and LLM prompts. It masks values of `sensitive` params, credentials and tokens, and PII
  patterns (member numbers, SSN-like and account-number-like strings, money amounts such as balances,
  names from the synthetic data set). Nothing reaches a sink unredacted. (R4.3)
  _Amended 2026-09-30 (PoC): money amounts added after the first real discovery run showed a balance to
  the model in clear. The model never needs the digits: `extract` reads the value from the surface._

**Evidence**

- FR18 — Every run (discovery or replay) writes a JSONL run log: one entry per observation, decision (with
  the model's short reason in discovery, the step id in replay), action, policy verdict, locator rung,
  checkpoint result, recovery and control-lease change. It also writes a run manifest that lists all its
  evidence files. (R5.1)
- FR19 — On failure or escalation, the run captures a screenshot and an accessibility snapshot of the
  current state (and a Playwright trace for the run), redacted, and references them from the result or
  intervention request. (R5.2)

**Escalate & hand off**

- FR20 — The session controller holds a control lease with one holder at a time: `AGENT` → `PAUSED` →
  `HUMAN` → `RESUMING` → `AGENT`. Every transition is explicit, logged and queryable, so it is always
  known who is, or should be, in control. The automation never acts while it does not hold the lease.
  (R6.3)
- FR21 — An intervention request is raised when discovery is stuck (dead end, or an ambiguous state after
  bounded retries), when replay hits an unrecoverable condition while escalation is enabled, and before
  any irreversible action. It carries the capability or goal, current step, redacted state (screenshot +
  accessibility snapshot refs), the reason, and the requested decision (approve / take over). (R6.1)
- FR22 — The human operates the **same** live browser session the automation was using, not a new one.
  Their actions are recorded as steps (action type + locator ladder derived from the accessibility tree)
  and policy-checked like any other action. They go into the run log and, for discovery, into the
  compiled artifact. On resume, automation re-observes and verifies the checkpoint before it continues.
  (R6.2)
- FR23 — A minimal operator surface (`apps/operator`, deliberately mocked) lists open intervention
  requests, shows their context, lets the operator take control, approve an irreversible step, and signal
  resume. REPORT §5 describes the full version. (R6.4)

**Deliver**

- FR24 — The CLI exposes `discover`, `replay`, `catalog` (list stored artifacts with summary, params and
  outputs) and `operator`. The README gives setup, keys/config, how to run without an API key (replay,
  tests and the scripted-model discovery), and the exact demo path: discover a goal, then replay the
  resulting artifact. (D1, R1.1)
- FR25 — `evidence/` holds a real discovery run (R-REAL), its compiled artifact, a successful replay, a
  replay that ends in a business outcome (member not found), a replay that ends in a hard failure from an
  injected fault, and a handoff run. All of it is redacted. (D3, R-REAL)
- FR26 — `REPORT.md` covers the seven required headings, including the design for legacy web/desktop
  surfaces (the `Surface` seam) and multi-tenant reuse (base artifact + per-tenant overrides, drift
  detection). (D2, R7.1, R7.2)

## Non-Functional Requirements

- **No LLM on the replay path.** Enforced structurally (boundary check) and by a test. Given the same
  artifact, params and target state, replay produces the same sequence of actions.
- **Bounded everything.** Discovery has max steps and a timeout. Replay waits, retries, re-auth and dialog
  dismissal each have explicit budgets. Nothing waits or retries without a limit.
- **Redaction before sinks.** No sink API accepts un-redacted data. `/safety-review` scans `evidence/`
  and artifacts, and finds no synthetic PII values, credentials or tokens.
- **Observability.** Every run can be reconstructed from its run log and manifest alone: what happened,
  why, who held control, and which locator rung matched.
- **Testability.** `pnpm test` needs no network, no real LLM and no API key. Agent tests use a scripted
  fake model. Functional tests start `mock-bank` as a process and drive it through the real `Surface`.
  The only real model calls are `/capture-evidence` discovery runs, which need PoC confirmation.
- **Simplicity.** A single-process Node CLI with files on disk for artifacts, policy and evidence. No
  services, queues or database (the brief does not reward scaling infrastructure).
- **Latency.** A replay of the member-lookup capability against a healthy local `mock-bank` completes in
  seconds, not minutes. Default step timeouts are tuned for a slow legacy app but stay bounded.

## Decisions

- **Umbrella spec + slice specs** (PoC, 2026-09-29). This spec holds system behaviour and the end-to-end
  ACs. Roadmap specs 02–11 each deliver one slice and cite the FRs/ACs here that they close. Rejected:
  only per-slice specs, where no document owns the end-to-end thread the brief grades.
- **Proxy target = local hostile `mock-bank`**, rejected: a public demo site. A local app gives full
  control over framesets/tables/no test IDs, deterministic fault injection for every runtime condition,
  a tenant variant, synthetic data only, and no terms-of-service risk. → ADR (target choice), report §1.
- **Two demo capabilities.** `member-lookup` (read-only: search a member, read the savings balance) is
  the primary discovery + replay path. `open-sub-account` (ends in an irreversible confirm) exercises the
  risk policy and handoff. Rejected: a single flow, which cannot show both the read path and the
  irreversible-approval path.
- **Perception = accessibility tree (frame-aware), screenshots for evidence and humans.** Rejected:
  screenshot + coordinates as primary. It is less deterministic to replay, costs more tokens, and cannot
  produce a semantic locator. The a11y tree exists on desktop too (UIA/AX), which keeps the `Surface` seam
  honest. → ADR (surface abstraction), R7.1.
- **Locator ladder** (role+name → label/text → frame-scoped structural anchor), with the matched rung
  recorded. Rejected: a single CSS/XPath selector, which breaks on legacy markup. A visual-anchor rung is
  design-only (report §3/§4). → ADR (artifact schema & locators).
- **Result contract = discriminated union `success | business_outcome | failure`.** Recoverables are
  handled inside the run and logged, never returned. → ADR (result contract & error taxonomy).
- **Runtime-condition taxonomy** (a default classification that the artifact's outcome rules can refine
  per capability):
  | Condition | Class | Response |
  | --- | --- | --- |
  | Record not found | business outcome | return `member_not_found` |
  | App validation error on a caller-supplied value | business outcome | return `validation_rejected` + redacted message |
  | Permission denied | business outcome | return `permission_denied` (entitlement, not a bug; retrying won't help) |
  | Known interstitial / unexpected-but-recognised dialog | recoverable | dismiss per policy (≤ 1 per step), log |
  | Slow load | recoverable | bounded wait, then treat as failed load |
  | Failed load | recoverable | bounded retry of the step, then hard failure |
  | Session timeout | recoverable | one re-auth via the credential reference, then resume at the last checkpoint; else hard failure |
  | Unknown dialog, app error page, checkpoint mismatch, target not resolvable on any rung | hard failure | stop, capture evidence, and raise an intervention request when escalation is on |
  Params that fail the artifact's params schema are rejected **before any action** as a `failure` with
  reason `invalid_params`.
- **Irreversible actions require human approval** (PoC, 2026-09-29). They go through the same
  intervention + control-lease mechanism as "stuck". Rejected: blocking outright (the demo could then
  never finish `open-sub-account`) and pre-approved unattended execution (too permissive for regulated
  money movement at this maturity; noted as S3 in Cuts). → ADR (policy & risk classes).
- **Risk class is per action type, raisable per step, never lowerable.** Rejected: author-declared risk
  only, where a wrong or missing annotation would silently allow an irreversible click.
- **Replay escalation is a run option.** Attended runs pause and escalate on a hard failure; unattended
  runs return the `failure` with an intervention-request ref. The demo shows both.
- **Handoff on the same headed browser context.** The human drives the same Playwright-owned browser
  window. A recorder behind the `Surface` captures their actions. Rejected: a new session or remote
  co-browsing (out of scope per brief §3.6). → ADR (control-transfer model).
- **Credentials by reference.** Login uses a named credential resolved from `.env` at run time. It is
  never in artifacts, logs or prompts.
- **Artifact versioning:** `schemaVersion` (contract semver) and capability semver, plus a content hash
  over the normalized artifact. The human-readable summary and the JSON Schema make it reviewable by
  people and by a calling agent.
- **Multi-tenant = design + schema room.** The artifact has an explicit app/variant identity, and the
  schema leaves room for a base artifact with per-tenant overrides. Implementation is S5, decided in
  roadmap #12. → ADR (multi-tenant reuse), report §4.
- ADRs recorded for these decisions:
  [0002 proxy target](../../docs/adr/0002-proxy-target-hostile-mock-bank.md),
  [0003 artifact schema & locator ladder](../../docs/adr/0003-artifact-schema-and-locator-ladder.md),
  [0004 result contract & taxonomy](../../docs/adr/0004-result-contract-and-runtime-condition-taxonomy.md),
  [0005 policy & risk classes](../../docs/adr/0005-policy-risk-classes-and-approval.md),
  [0006 control transfer](../../docs/adr/0006-control-transfer-lease-and-mediated-human-control.md),
  [0007 surface abstraction](../../docs/adr/0007-surface-abstraction-a11y-first.md),
  [0008 multi-tenant reuse](../../docs/adr/0008-multi-tenant-reuse-base-overrides-and-drift.md),
  [0009 redaction & evidence sinks](../../docs/adr/0009-redaction-model-and-evidence-sinks.md).

## Possible Edge Cases

- The model claims the goal is met but the final checkpoint does not hold → discovery continues or stops
  with `goal_unverified`. It never compiles.
- The discovery loop oscillates between two screens → dead-end detection stops it and raises an
  intervention request.
- The model proposes an action outside the allowlist (another origin, an unregistered action type) →
  refused, logged, fed back to the model as a tool error. It counts toward the step budget.
- A param value also appears on screen as ordinary text → it is redacted in observations, prompts and
  logs, while replay still resolves `{{memberId}}` correctly.
- A frame reloads between resolve and act (a stale element) → re-resolve once within the step budget,
  then hard failure.
- A session timeout during a checkpoint wait → re-auth once, resume from the last verified checkpoint.
  A second timeout → hard failure.
- A dialog appears on top of an irreversible confirm → it is resolved first (dismiss or escalate). The
  approval is never implied by dismissing a dialog.
- The human performs an action outside the allowlist during handoff → refused and recorded as refused.
  The lease stays `HUMAN`.
- The human navigates somewhere unexpected and resumes → automation re-observes. A checkpoint mismatch
  is a hard failure, not a blind continue.
- A resume is signalled while the human is mid-action, or two resume signals arrive → the lease
  transitions are idempotent and serialized, and only one `RESUMING` → `AGENT` transition happens.
- The tenant-B variant relabels a control → the ladder falls to a lower rung and logs drift, or fails
  cleanly with the rung-by-rung observations.
- An output fails its schema (e.g. the balance is not a decimal) → hard failure with expected vs
  observed, not a success with bad data.
- No API key is configured → `discover` fails fast with a clear message. `replay`, `catalog` and the tests
  still work.

## Acceptance Criteria

- AC1 — Given `mock-bank` running and a valid API key, when `discover` runs with the goal "look up member
  12345 and read their current savings balance", then the run meets its goal with the final checkpoint
  verified, writes a run log with a reason per decision, and emits a `member-lookup` artifact that
  validates against the JSON Schema and contains `{{memberId}}`, not the concrete member number.
  (R1.1–R1.3, R2.1, R-REAL; evidence)
- AC2 — Given a scripted fake model, when discovery hits each stop condition (max steps, timeout, dead
  end), then it stops with that distinct stop reason and does not compile an artifact. (R1.2; test)
- AC3 — Given the `member-lookup` artifact, when inspected, then it has ordered steps, a locator ladder
  with a rationale per target, typed params and outputs, a checkpoint after every screen-changing step,
  a final success condition, outcome rules, `schemaVersion`, capability semver, a content hash and a
  human-readable summary. (R2.2–R2.7; test + fixture)
- AC4 — Given the artifact and `memberId` of an existing synthetic member, when `replay` runs with no
  model configured, then it returns `success` with the savings balance matching the `mock-bank` seed data,
  and the run log shows the matched locator rung and checkpoint result for every step. (R3.1, R3.2;
  functional test + evidence)
- AC5 — Given the repo, when the boundary check and a dedicated test run, then `@idp/replay-engine` has
  no direct or transitive dependency on `@idp/agent` or the Anthropic SDK. (R3.1; test)
- AC6 — Given an unknown `memberId`, when `replay` runs, then it returns `business_outcome` with code
  `member_not_found`, not `failure`. (R3.3, R3.4; functional test + evidence)
- AC7 — Given each fault switch in `mock-bank`, when `replay` runs, then the `RunResult` matches the
  taxonomy table: business outcomes for not-found / validation / permission; `success`, with the recovery
  logged, for a known dialog, a slow load, one failed load and one session timeout; `failure` with step,
  expected, observed and evidence refs for an app error, an unknown dialog and an unresolvable target.
  (R3.3–R3.5, R5.2; one injected-fault functional test per condition)
- AC8 — Given params that violate the artifact's params schema, when `replay` runs, then it returns
  `failure` with reason `invalid_params` and no action was sent to the surface. (R2.4; test)
- AC9 — Given a policy that does not allow an origin or action type, when the agent, a replay step or a
  recorded human action attempts it, then it is refused, logged, and not executed, on all three paths.
  (R4.1; tests)
- AC10 — Given the `open-sub-account` flow, when discovery or replay reaches the confirm step, then the
  lease moves to `PAUSED`, an intervention request of kind approval is raised with redacted context, and
  the confirm is executed only after an operator approval on the same session. (R4.2, R6.1, R6.3;
  functional test + evidence)
- AC11 — Given an attended replay that hits an app error, when the operator takes control through
  `apps/operator`, performs the fix in the same browser session and signals resume, then the recorded
  human actions appear in the run log as policy-checked steps, automation re-verifies the checkpoint,
  and the run completes. The lease history reads `AGENT → PAUSED → HUMAN → RESUMING → AGENT`. (R6.2–R6.4;
  functional test + evidence)
- AC12 — Given every file under `evidence/` and every stored artifact, when `/safety-review` scans them,
  then no synthetic member number (other than as a masked value), name, credential or token appears
  unredacted, and the LLM prompts recorded in evidence are redacted too. (R4.3; review + test on the
  redaction layer)
- AC13 — Given a failed replay, then its result references a screenshot, an accessibility snapshot and a
  trace that exist in the run's evidence folder and are listed in its manifest. (R5.2; functional test)
- AC14 — Given a fresh clone, when a reviewer follows `README.md`, then setup, the no-API-key path
  (tests, replay of the committed artifact) and the demo path (discover → replay) work as written.
  (D1; manual check recorded in the report)
- AC15 — Given `REPORT.md`, then it has exactly the seven required headings and covers the surface seam
  and multi-tenant reuse. (D2, R7.1, R7.2; `/update-report` check)

## Evidence

- `evidence/discovery-member-lookup/`: run log, redacted prompts/decisions, manifest, compiled artifact
  (AC1).
- `evidence/replay-member-lookup-success/`, `…-not-found/`, `…-injected-failure/` (AC4, AC6, AC7, AC13).
- `evidence/handoff-open-sub-account/`: intervention request, lease history, recorded human steps (AC10,
  AC11).
- `evidence/artifacts/member-lookup.json` (the saved example artifact, D3).
- Optional short screen recording of the handoff.

## Out of Scope

- A real bank system, real PII, or real credentials; any public site.
- Desktop and non-browser surfaces: design only (the `Surface` seam + report §4).
- A real-time co-browsing operator console: `apps/operator` is a minimal, mocked surface (brief §3.6).
- Multi-tenant plumbing (tenant registry, per-tenant storage, rollout). Design + schema room only.
- Stretch goals S1–S6, including unattended pre-approved irreversible actions (S3) and LLM-assisted
  replay fallback (S4). At most one or two are picked in roadmap #12, after 01–11 are thin-but-real.
- Services, queues, a database, CI pipelines, containerization.
- Submission itself (D4): the PoC pushes and emails.

## Open Questions

- Which stretch goal, if any, for roadmap #12 (S1 catalog or S5 tenant overrides)? Decide after #11.
- Default Claude model id and per-run token/step budget for the real discovery run. Decide in `discovery-agent` and record in its spec.
- No conflicts with the Hard invariants were found. Invariant 1 is kept because S4 is out of scope. Invariant 3 is met because human-recorded steps are also redacted and compiled with parameter references.
