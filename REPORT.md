# Design Report — Computer-Use Automation System

> The whole loop is built and captured with a real model: discover, compile, replay, hand off, evidence. It is
> tested with a scripted model (~1,300 unit and ~180 browser tests, in CI). Captured runs:
> [`evidence/`](evidence/README.md).

## 1. Architecture

```
artifact-schema ← policy ← evidence ← surface ← session ← { replay-engine, agent } ← { cli, operator }
apps/mock-bank: a black box, reached only over HTTP through a Surface
```

- **Discover** (`@idp/agent`): Claude sees a redacted accessibility-tree observation, with inputs as placeholders,
  and makes one policy-checked tool call per turn, with a reason.
- **Compile**: the successful trace becomes a strict, hashed artifact. Saving is refused if any concrete
  sensitive value remains, and the artifact is saved only after one verification replay succeeds.
- **Replay** (`@idp/replay-engine`): no model. It returns a typed `RunResult`.
- **Handoff** (`@idp/session`, `apps/operator`): a control lease, intervention requests, and a localhost control
  API over the same live browser.

**The real run.** `claude-sonnet-5-5` met "look up member 12345 and read their current savings balance" in 8
turns. Each turn is logged with its reason and the API's message id, stop reason and token usage. The artifact
became [`artifacts/member-lookup.json`](artifacts/member-lookup.json).

**Trade-offs.**
- **Layers checked by machine.** Only `surface` imports Playwright and only `agent` the Anthropic SDK. A lint rule
  fails if `replay-engine` can reach `agent`, so "no model on the replay path" is enforced. The cost is eleven
  workspaces of configuration ([ADR-0001](docs/adr/0001-stack-and-workspace-layout.md)).
- **One process, file storage, no queue or database.** That is enough for one operator per session; a real
  deployment would put a queue behind the same interfaces.
- **A hostile proxy target.** "CoreOne" has framesets, layout tables, no ids or ARIA, 13 deterministic fault
  switches and a tenant-B variant. Because we wrote it, its realism is our claim
  ([ADR-0002](docs/adr/0002-proxy-target-hostile-mock-bank.md)).

## 2. Artifact schema

Strict Zod, `schemaVersion` 1.0.0, with a JSON Schema export guarded by a drift test. One step of the discovered
artifact:

```json
{ "id": "s06-click-search", "kind": "click", "risk": "reversible",
  "target": { "frame": [{ "kind": "by_name", "name": "content" }], "ladder": [
    { "kind": "role", "role": "button", "name": "Search", "rationale": "…" },
    { "kind": "text", "text": "Search" }, { "kind": "structural", "anchor": { … }, "rationale": "…" } ] },
  "checkpoint": { "kind": "text_present", "text": "Member Inquiry" } }
```

| Part | Why |
| ---- | --- |
| Locator ladder, each rung with a rationale | Role and name → label or text → structural anchor (the cell next to a label, a form row). A lower rung that matches is reported as drift. The rationale says what would break the rung. |
| Typed `params` / `outputs`, `sensitive` flag | Steps hold `{{memberId}}` or a credential reference, never literals. Params are checked before the browser acts, outputs after extraction. |
| A checkpoint on every screen-changing step | Required by the schema. "The click didn't throw" is not success. |
| `successCondition` | Proposed by the model at finish, verified on screen, then re-checked at the end of every replay. |
| `outcomeRules` | Copied from the reviewed app profile, so the artifact can be read on its own. |
| `summary`, `provenance`, `version`, `contentHash` | What it does, needs and returns (for the calling agent); which run and model made it; semver; a sha256 checked on load. |

**Limits.** `discover` emits inputs as plain strings, so `memberId=abc` reaches the app and comes back as a
`validation_rejected` outcome. Tightening types is a review step. Boolean outputs are refused (extract parses
only text and numbers). There is no `draft → approved` status yet
([ADR-0003](docs/adr/0003-artifact-schema-and-locator-ladder.md)).

## 3. Determinism & error handling

- **Targeting.** Rungs are tried in order inside the frame path. A rung counts only on exactly one match. The
  resolver polls for up to 5 s, so a late-rendered control is waited for.
- **Waits.** Every wait is bounded: action 10 s, frame load 10 s, checkpoint 10 s, slow load at most 15 s. That is
  about 40 s per attempt, times a fixed recovery budget. The only fixed pauses are short settle windows.
- **Classification.** A detected condition is looked up in the artifact's rules, then the profile's, then the
  built-in catalog. An unknown code fails. A checkpoint that cannot read the page fails; it never passes by absence.

| Condition | Class | Response |
| --------- | ----- | -------- |
| `member_not_found`, `validation_rejected`, `permission_denied` | business outcome | Return the code and the redacted app message. |
| `known_dialog` | recoverable | Policy-checked dismiss (≤ 1 per step), re-verify the checkpoint. |
| `slow_load` / `failed_load` | recoverable | One extra wait, then ≤ 2 reload-and-retry. Never re-runs an irreversible step (declared or raised by policy). |
| `session_timeout` | recoverable | One re-sign-on per run, re-run to the failed step; else `session_lost`. |
| `unknown_dialog`, `app_error`, `target_unresolved`, `checkpoint_failed` | failure | Stop with step, expected, observed, masked evidence; escalate when attended. |

**Result contract.** `success` (outputs, drift, recoveries) | `business_outcome` (code, message, step) | `failure`
(reason, step, expected, observed, evidence refs). A recoverable condition is not a result type; it is handled
inside the run and logged. Every condition has a functional test driven by a fault switch. The evidence covers
success, not found, validation, app error, wrong screen, a recovered dialog, a recovered timeout and tenant-B drift.

**Judgment calls.** `permission_denied` is an outcome because a retry cannot fix it. Since it concerns the operator
account, production should also alert someone. `validation_rejected` could mask drift, because fills have no
checkpoint of their own ([ADR-0004](docs/adr/0004-result-contract-and-runtime-condition-taxonomy.md)).

## 4. Heterogeneity & multi-tenant

**The surface seam.** Replay, agent and session see only the `Surface` port (`observe`, `resolve`, `act`,
`check`), and no Playwright type crosses it. Artifacts name controls by role, name, label and layout, which Windows
UI Automation and macOS Accessibility also expose. A desktop adapter would therefore implement the same port and
keep the artifact format. **Built:** the Playwright adapter, reading the accessibility tree across framesets.
**Designed:** desktop and terminal adapters, and a visual rung for controls drawn as images
([ADR-0007](docs/adr/0007-surface-abstraction-a11y-first.md)).

**Reuse across tenants.** An artifact belongs to a vendor app (`coreone`), not a tenant. A tenant's differences
live in its app profile (origin, outcome signatures). **Built:** per-tenant profiles and drift reporting. The
artifact discovered on tenant A succeeds on tenant B, which renames "Member #" and "Search", and reports drift at
two steps. **Designed:** a base artifact with per-tenant overrides (`extends` is reserved in the schema), drift
aggregated across runs to trigger review or re-discovery, and an app-version fingerprint check. Trade-off: tenant B
passes only on last-resort rungs, and the checkpoints are what prove those rungs matched the right control
([ADR-0008](docs/adr/0008-multi-tenant-reuse-base-overrides-and-drift.md)).

## 5. Escalation & handoff

**Detecting "stuck".** Discovery: three actions in a row that don't change the screen, an A-B-A-B oscillation,
repeated policy denials, or `request_help`. Replay: any hard failure, or an irreversible step. The run raises an
**intervention request** with the goal or capability, the step and its risk, the reason, a masked screenshot, a
redacted snapshot and the allowed responses.

**Who is in control.** An explicit lease state machine:

```
AGENT → PAUSED → HUMAN → RESUMING → AGENT      (takeover)
AGENT → PAUSED → RESUMING → AGENT              (approval)        PAUSED → CLOSED (reject / abort)
```

Automation acts only in `AGENT`, a human only in `HUMAN`. Outside `HUMAN`, the headed window is locked: a
person's input is blocked, with a banner. Automation passes the lock one act at a time, after lease and policy allow.

**Same live session, recorded.** The human works in the automation's own browser. Each click, Enter, submit or
select is held, mapped to a step with a locator ladder, and policy-checked as actor `human` before it runs. A
refused fill is reverted. Human actions are logged, and in discovery they become `actor: 'human'` steps. **Resume**
re-verifies the step's checkpoint before automation takes the lease back. A step with no checkpoint resumes only if
the human acted. Waiting for a claim is bounded (5 min), and the takeover itself separately (30 min).

**Operator surface (deliberately minimal).** `idp operator` starts a localhost console, entered through a one-time
login URL: list, take control, approve, reject, resume, abort. **Full design, not built:** remote co-browsing (a CDP
screencast behind the same lock), a routed queue, operator identity, four-eyes approval for money movement, a
durable audit trail. **Evidence:** a real approval and a real takeover with three recorded human actions. A script
played the operator; no person clicked
([ADR-0006](docs/adr/0006-control-transfer-lease-and-mediated-human-control.md)).

## 6. Safety

**Allowlist.** Every agent, replay and human action goes through `PolicyGuardedSurface`, which checks the action
type, origin, route and risk, then the URL of every frame afterwards. A network guard blocks other origins. The
allowlist is configured in [`config/policy.json`](config/policy.json).

**Risk.** Risk is the highest of the action type's floor, the declared risk, and any irreversible name or route
pattern, so it can be raised but never lowered. **Irreversible actions need a human approval**: single-use, bound to
the step, valid 5 minutes. Blocking outright makes the capability useless, and flagging after the fact is too late
for money movement. The cost: nothing irreversible runs unattended
([ADR-0005](docs/adr/0005-policy-risk-classes-and-approval.md)).

**Redaction.** One redactor (known values, then patterns, then terms) sits in front of every sink: logs, results,
artifacts, intervention requests, the CLI and model prompts. A `Redacted<T>` type makes an unredacted write fail to
compile. The model types `{{memberId}}` and the surface substitutes the value. Screenshots are masked in the
browser. Balances are masked everywhere, since `extract` reads them from the screen; the first real run exposed that
gap and we closed it with a rule. There are no Playwright traces, because they cannot be redacted
([ADR-0009](docs/adr/0009-redaction-model-and-evidence-sinks.md)).

**Limits.** During an automation act the lock is open for that one act. Irreversible-name rules are hand-written
per app. Masking can miss values split across elements or drawn in images. Values that aren't extracted rely on
patterns. The local console trusts the machine it runs on.

## 7. Cuts

| Cut | Why |
| --- | --- |
| Param types inferred in discovery | Plain strings; patterns are added in review. |
| A person in the handoff captures | The API, lease and recorder are real; a script played the operator. |
| Playwright traces | Not redactable; a masked screenshot plus a snapshot instead. |
| Desktop / terminal surfaces | Only the seam is built. |
| Co-browsing console | Out of scope for the brief. |
| Tenant overrides, drift aggregation | Designed; the variant replay with drift is built. |
| Stretch goals, services, database | Depth went into replay, safety and handoff. |

**Next:** (1) infer param types from the example value and the app's validation message; (2) an approval status
gating the catalog; (3) base artifacts with tenant overrides; (4) persisted request expiry and operator identity;
(5) the desktop adapter.
