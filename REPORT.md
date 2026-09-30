# Design Report — Computer-Use Automation System

> **Status.** Discover → compile → replay → handoff is built, tested with a scripted model, and captured with a
> real model against the local mock-bank. All captured runs are in [`evidence/`](evidence/README.md).

## 1. Architecture

```
artifact-schema ← policy ← evidence ← surface ← session ← { replay-engine, agent } ← { cli, operator }
apps/mock-bank: isolated black box, reached only over HTTP through a Surface
```

| Stage    | Where                           | What happens                                                                                     |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Discover | `@idp/agent` `DiscoveryLoop`    | The model sees a redacted, placeholderized a11y observation and makes one policy-guarded tool call per turn. |
| Compile  | `@idp/agent` `ArtifactCompiler` | A `goal_met` trace becomes a strict, hashed artifact. `assertNoConcreteValues` refuses concrete sensitive values. |
| Verify   | `apps/cli discover`             | The artifact is replayed once with the example inputs and saved only if that replay succeeds.     |
| Replay   | `@idp/replay-engine`            | No model. It returns a `RunResult`.                                                              |

**Real run.** `claude-sonnet-5-5` met a member-lookup goal in 8 turns; the compiled artifact passed
verify-replay and is now `artifacts/member-lookup.json`. See `evidence/discovery-member-lookup/`
(placeholderized prompts, per-turn decisions with reasons). The scripted round trip is tested in
`apps/cli/test/functional/cli.test.ts`.

**Key decisions and trade-offs:**

- **TypeScript monorepo** (pnpm + Turborepo). Layering is machine-checked (`layers.json` BND001–BND009,
  ESLint): only `surface` imports Playwright, only `agent` the Anthropic SDK; a test fails if `replay-engine`
  reaches `agent`. Cost: 11 workspaces of config.
  See [ADR-0001](docs/adr/0001-stack-and-workspace-layout.md).
- **Single process, file storage.** The CLI hosts browser, session and a localhost control API; the operator
  console is separate. Artifacts, policy, profiles and evidence are files.
- **Proxy target.** A local, hostile "CoreOne" app: framesets, nested tables, no ids or ARIA, 11 deterministic
  fault switches, a tenant-B variant, synthetic data. Trade-off: we wrote it, so its realism is our claim. See [ADR-0002](docs/adr/0002-proxy-target-hostile-mock-bank.md).

## 2. Artifact schema

`CapabilityArtifactSchema`: strict Zod, `schemaVersion` 1.0.0, JSON Schema export with a drift test. Trimmed
from the **discovered** [`artifacts/member-lookup.json`](artifacts/member-lookup.json) (7 steps, 4 of them
sign-on):

```json
{ "provenance": { "discoveryRunId": "discovery-20260930T033842-7774", "model": "anthropic:claude-sonnet-5-5" },
  "params": [{ "name": "memberId", "type": { "kind": "string" }, "sensitive": true }],
  "steps": [ …,
    { "id": "s05-fill-member", "kind": "fill", "value": { "kind": "param", "name": "memberId" }, … },
    { "id": "s06-click-search", "kind": "click", "risk": "reversible",
      "target": { "ladder": [{ "kind": "role", "role": "button", "name": "Search", "exact": true, "rationale": "…" },
        { "kind": "text", "text": "Search", "match": "exact" }, { "kind": "structural", … }] },
      "checkpoint": { "kind": "text_present", "text": "Member Inquiry" } }, … ],
  "contentHash": "sha256:dfff5470…" }
```

| Part                                  | Why it exists                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Locator ladder (1–5 rungs + `rationale`) | Role → label/text → structural; a fallback rung reports drift; rationales make rungs reviewable (R2.3). |
| `params` / `outputs` (typed, `sensitive`) | Steps hold `{{memberId}}` or a `credentialRef`, never literals. Refinements reject undeclared placeholders. |
| `checkpoint` per screen-changing step | Required on navigate, click and press: "didn't throw" is not success. |
| `outcomeRules` + `successCondition`   | Copied from the reviewed app profile, so the artifact can be read on its own.                     |
| `summary`, `app`, `provenance`        | `does`/`needs`/`returns` for the calling agent; app identity; run id, model id, human step ids. |
| `version` + `contentHash`             | Capability semver + sha256 over canonical JSON (tamper-evident).                                 |

**Limit.** `discover` emits each `--input` as a plain `string` param, so `memberId=abc` reaches the app, which
rejects it (`business_outcome` `validation_rejected`, exit 3). The hand-written fixture
(`packages/artifact-schema/fixtures/member-lookup.artifact.json`, `^\d{5}$`) fails `invalid_params` before any
browser action; tightening is a manual review step today. No `status` (`draft → approved`) field (S3). See
[ADR-0003](docs/adr/0003-artifact-schema-and-locator-ladder.md).

## 3. Determinism & error handling

**Resolution.** `LadderResolver` tries rungs in order in the frame path, requiring exactly one match; a stale
frame is re-resolved once. **Waits.** Every step is bounded (10 s); the checkpoint is polled, raced against the
condition detectors. No fixed sleeps.
**Classification** resolves artifact rule → app profile → catalog default; an unknown code fails as
`checkpoint_failed`, so the engine never guesses a class.

| Condition             | Detector              | Class            | Response (budget)                                             |
| --------------------- | --------------------- | ---------------- | ------------------------------------------------------------- |
| `member_not_found`, `validation_rejected`, `permission_denied` | text signature | business_outcome | stop, return the code and redacted message |
| `known_dialog`        | native dialog text    | recoverable      | policy-checked dismiss (≤ 1 per step), re-verify the checkpoint |
| `slow_load`           | step used its whole bound | recoverable  | one wait up to `slowLoadBudgetMs`, then `failed_load`          |
| `failed_load`         | 5xx signature         | recoverable      | retry ≤ 2 with backoff; never across an irreversible step     |
| `session_timeout`     | Sign On signature     | recoverable      | one re-auth per run, re-run to the failed step; else `session_lost` |
| `unknown_dialog`, `app_error`, `target_unresolved`, `checkpoint_failed` | dialog / signature / locator / checkpoint | failure | stop, capture masked evidence, escalate when attended |

**Result contract.** `success` (outputs, drift, recoveries) | `business_outcome` (code, message, step) |
`failure` (reason, step, expected, observed, evidence refs, intervention id). `FailureReason` has no member
for a recoverable or an outcome. Every code has an injected-fault functional test.

Captured against the discovered artifact (`evidence/replay-member-lookup-*`): `success`, `not-found`
(`member_not_found`), `recovered-known-dialog` (1 recovery), `injected-failure` (`app_error` at `s04`, masked
screenshot + snapshot).

Limits: `slow_load` is a heuristic; recoveries do not nest inside a retry. See
[ADR-0004](docs/adr/0004-result-contract-and-runtime-condition-taxonomy.md).

## 4. Heterogeneity & multi-tenant

**Surface seam.** Every consumer sees the `Surface` port (`observe`, `resolve`, `act`, `check`, …); no
Playwright type crosses it. Perception is the frame-aware accessibility tree. Ladder rungs and condition
signatures map to Windows UIA and macOS AX. **Built:** the Playwright web adapter. **Designed, not built:**
desktop (UIA/AX) and terminal/3270 adapters, a visual-anchor rung for canvas/image controls. See
[ADR-0007](docs/adr/0007-surface-abstraction-a11y-first.md).

| Mechanism                                   | Status                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Per-tenant app profiles (`--profile mock-bank.tenant-b`) | Built                                                                  |
| Drift from rung fallback in `RunResult.success.drift` | Built. In `evidence/replay-member-lookup-tenant-b-drift/result.json`, the artifact discovered on tenant A succeeds on tenant B ("Find", "Account holder ID") with drift at `s05` rung 1 and `s06` rung 2. |
| Base artifact + overrides (`extends`)       | Designed, not built (S5). The field is in the schema, but no engine reads it.      |
| Drift aggregation, fingerprint check, re-discovery | Designed, not built.                                        |

Trade-off: tenant B passes only because last-resort rungs hold; the checkpoint proves the match.
See [ADR-0008](docs/adr/0008-multi-tenant-reuse-base-overrides-and-drift.md).

## 5. Escalation & handoff

**Stuck detection.** Discovery: same screen digest 3 times, A-B-A-B oscillation, `request_help`, repeated
denials. Replay: any hard failure or irreversible step. **Intervention request:** redacted
reason, step, risk, masked screenshot, allowed actions. **Control lease** (`ControlLease`):

```
AGENT → PAUSED → HUMAN → RESUMING → AGENT      (takeover)
AGENT → PAUSED → RESUMING → AGENT              (approve)       PAUSED → CLOSED (reject)
```

`LeasedSurface` refuses an agent act unless the lease is `AGENT`, a human act unless `HUMAN`. **Same
session:** the human works in the same headed Playwright context. **Capture is mediated:** a
capture-phase script blocks clicks, Enter and submits and re-executes each through the policy guard as actor
`human`; recorded actions compile as `actor: 'human'` steps. **Resume** re-verifies the checkpoint before
`reacquire()`. See [ADR-0006](docs/adr/0006-control-transfer-lease-and-mediated-human-control.md).

| Path                            | Proof                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Approval (`…→RESUMING→…`) | Captured in `evidence/handoff-open-sub-account/` (`SA-000001`); a scripted call to the real control API approved, not a human. |
| Takeover (`…→HUMAN→…`) | Captured in `evidence/handoff-member-lookup-takeover/`: `app_error` at `s06` → claim → 3 recorded `human_action` (all `allow`) → resume → `success`. Gestures are real input events from a scripted `SimulatedOperator` (`driver.mjs`), not a person; run on the v1.0.1 fixture, rules 1.0.0. |

**Mocked vs full design.** Built: `apps/operator`, a minimal localhost console (list, claim, approve, reject,
resume, abort) over the bearer-token control API; the operator sits at the headed browser's machine, one per
session, grants in memory. **Full design (not built):** remote co-browsing (CDP screencast behind the same
guard), a persistent routed queue, operator identity, four-eyes approval for money movement, durable audit.

## 6. Safety

**Allowlist.** `evaluateAction` checks action kind, allowlist, origin, route and risk; `evaluateLanding` checks
every frame URL; a network guard aborts other origins. `PolicyGuardedSurface` is the only `Surface` the agent,
replay and the human recorder receive.

**Risk classes.** Risk is the maximum of the registry floor, `declaredRisk`, irreversible name/dialog patterns
and irreversible routes (incl. a click's form action): raisable, never lowerable. **Irreversible actions need
human approval** (single-use, step-bound 300 s grant), deliberately giving up unattended money movement at this
maturity. Rejected: blocking outright, pre-approval (S3). See [ADR-0005](docs/adr/0005-policy-risk-classes-and-approval.md).

**Redaction points.** One redactor (known values → patterns → name terms) fronts every sink; branded
`Redacted<T>`/`MaskedScreenshot` types make an unredacted write fail to compile. The model sees and types
`{{memberId}}`, and the surface substitutes the real value. Screenshots are masked in the browser; artifacts
are scanned for concrete values. **No Playwright traces** (not reliably redactable): AC13 is met by a masked
screenshot plus a redacted a11y snapshot. See [ADR-0009](docs/adr/0009-redaction-model-and-evidence-sinks.md).

**A limit the real run found.** The first real discovery run met the goal and verified, but the scan of its
recorded prompts found a synthetic *checking* balance in clear: only extracted outputs were known values and no
pattern covered amounts. We did not promote it. We added a `money-amount` rule (rules 1.1.0, spec FR17, ADR-0009)
masking every 2-decimal amount before every sink, prompts included; the model never needs the digits, since
`extract` reads the value from the surface. Attempt 2 is the evidence. Cost: over-redaction.

**Open limits (last safety review):** a target-less `Enter` is judged by frame URLs, not the focused form's
action; cancelling a commit dialog also needs approval; a short navigation window exists while a human gesture
is re-executed; some page text reaches tool results outside the `<observation>` block; screenshot masking can
miss values split across nodes or drawn in images; on-screen values not yet extracted are protected only by
patterns (the gap the real run exposed); `unknown_dialog` evidence is snapshot-only; irreversible rules are
hand-kept per app, so a missed pattern leaves a commit `reversible`.

## 7. Cuts

| Cut                                          | Why                                                             |
| -------------------------------------------- | --------------------------------------------------------------- |
| Typed params from discovery                  | `discover` emits plain strings; patterns are added in review.   |
| A person in the takeover capture             | Gestures scripted (real input events), not via the console.     |
| Playwright traces (FR19/AC13 deviation)      | A trace cannot be redacted. Screenshot + snapshot instead.      |
| Desktop / terminal surfaces, visual rung     | Designed, not built (the seam only).                            |
| Real-time co-browsing operator console       | Out of scope per brief §3.6. The console is minimal.            |
| Multi-tenant `extends` overrides, drift aggregation | Designed, not built (S5).                                |
| Stretch goals S1–S6; services, DB, CI        | Deferred / out of scope for a file-based PoC.                   |

**Next, in order:**

1. Close the §6 warnings (a form-action check for a target-less Enter, an accept-only dialog rule).
2. Infer param types from discovery (e.g. a pattern from the example and the app's validation message).
3. S3 approval status, so a discovered artifact is reviewed before the catalog serves it.
4. S5 overrides.
5. The desktop adapter.
