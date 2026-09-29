---
name: define-action
description: Add an action type (e.g. click, fill, select, press, navigate, extract, wait, dismiss_dialog) end-to-end so it is consistent across every layer — step schema, policy risk class + allowlist key, Surface executor, replay handler, agent tool definition, human-recorder mapping, and tests. Use when a plan introduces a new thing the agent/replay/human can *do*, or the user asks to "support <action>", "add a <verb> tool/step". Args expected -- "<action_kind> <risk: read|reversible|irreversible> <short description>", e.g. "select reversible choose an option in a dropdown/listbox".
---

# define-action

Invariant 2: **every action goes through policy**. An action type exists in six places, and a gap in any one
of them is either a safety hole or a replay that can't run what discovery recorded. This skill adds all six in
one change, so they can't drift.

> Each package's `CLAUDE.md` is the authority on registry file locations. The first action that lands becomes
> the exemplar. Read an existing action (e.g. `click`) end to end before adding one, and mirror it.

## The six touch points (all required)

| # | Package                 | What to add                                                                                                                        |
| - | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `@idp/artifact-schema`  | A step union member `{ kind: '<action>', target?: TargetRef, … }` with described fields. **Via `define-schema`** (minor bump).       |
| 2 | `@idp/policy`           | A registry entry: risk class (`read` / `reversible` / `irreversible`), allowlist key, and the conservative handling for `irreversible` (per the policy ADR: e.g. require confirmation → intervention). Plus the redaction behaviour for its payload (e.g. `fill` values are redacted in logs). |
| 3 | `@idp/surface`          | The executor on the `Surface` port + the Playwright adapter: resolve the target through the locator ladder, act, and return an observation. The only place Playwright is called. |
| 4 | `@idp/replay-engine`    | The step handler: param substitution, the policy check **before** acting, execution through `Surface`, then the post-step checkpoint. |
| 5 | `@idp/agent`            | A tool definition (name, description, JSON input schema) that the model can call, mapped to the same action kind. The tool refers to targets by observation refs; the compiler turns them into locator ladders. Omit this only if the action is replay-only, and say why. |
| 6 | `@idp/surface` recorder | The human-action mapping: DOM events captured during a handoff are converted into this step kind (R6.2). Omit it only if a human can't perform it, and say why. |

## Hard rules

- Classify the risk **by effect on the bank system, not by UI gesture**. A `click` on "Submit transfer" is
  irreversible. Where the risk depends on the target, policy must be able to classify per step (e.g. a
  step-level `risk` override that is only allowed to *raise* the class, never lower it).
- The policy check happens **before** the surface acts, on every path: agent, replay and human-recorded
  replay.
- Payloads that may carry sensitive values (typed text, extracted values) are marked for redaction at the
  schema level and redacted at every sink.
- No action may navigate outside the allowlist, including through the side effects of clicks (check the
  landing URL after acting).

## Steps (TDD)

1. Read the existing action exemplar across all six places, plus the policy ADR.
2. **Tests first** (red): schema parse (valid/invalid), a policy classification + allowlist denial test, a
   surface functional test against `mock-bank` (acts on a real page), a replay handler test (policy blocks →
   the right result; success → checkpoint verified), an agent tool test with a scripted fake model, and a
   recorder mapping test.
3. Implement 1 → 6 in dependency order. Run each package's tests as you go.
4. `pnpm build && pnpm test`.
5. Report:
   ```
   Action:   <kind> (risk: <class>)
   Schema:   <file> (schemaVersion <old> → <new>)
   Policy:   <file> — handling: <allow | confirm→intervention | block>
   Surface:  <file>   Replay: <file>   Agent tool: <file | omitted: why>   Recorder: <file | omitted: why>
   Tests:    <files>
   ```
