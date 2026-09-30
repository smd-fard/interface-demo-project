# @idp/surface — CLAUDE.md

> Workspace: `packages/surface` · Root rules: [../../CLAUDE.md](../../CLAUDE.md) · API: [README.md](README.md)

## Purpose

The perception-and-action seam between the system and a target application (R7.1, R1.3, R2.3, R4.1, R6.2):
the **`Surface` port** (`observe` / `resolve` / `act` / `check` / `describe` / `captureEvidence`), the
Playwright web adapter behind it, the locator-ladder resolver, the policy guard and the human-action
recorder. The frame-aware accessibility tree is the primary perception. It is the only package that imports
Playwright and the only place a raw browser action (e.g. `page.click`) may appear. Plan steps 23–28
(`_design/computer-use-automation-system/plan.md`).

## Owns

- **Port** (`src/port/`) — plain data types only; no Playwright type ever crosses the barrel.
- **Web adapter** — `launchWebSurface` → `{ surface, handle }` (`WebSurface` + opaque `BrowserHandle`).
  `observe` merges each frame's aria snapshot into one tree (`snapshot/a11ySnapshot.ts`, refs `e<N>` valid
  until the next observe) plus per-frame text/titles, pending dialog and last navigation.
- **Locator ladder** — `LadderResolver` walks a `TargetRef`'s rungs (`role` → `label` → `text` →
  `structural`) inside its frame scope; the first rung matching exactly one element wins; one re-resolution
  after a pause, then `TargetNotResolvedError` with per-rung counts.
- **Action executors** — `executeAction` dispatches exhaustively (a `never` check) to
  `src/actions/executors/<kind>.ts` (**define-action touch point 3**). Every kind but `dismiss_dialog` is
  refused with `DialogPendingError` while a native dialog is open. After a gesture, `waitForFramesLoaded`
  waits for frame navigations (`NavigationTracker`) to go quiet and for `load` in every frame. Executors never
  log and never call policy; browser errors become `ActionFailedError` (no selector or value in the message).
- **Dialogs** — `DialogMonitor` holds native dialogs pending and **never auto-accepts**. Gestures race
  `DialogMonitor.next()` (`raceDialogs`): a dialog raised by the gesture is reported in `ActOutcome.dialog`
  and left open. Only a `click` carrying an `approvalGrant` accepts the `confirm` raised by that click
  (`ActOutcome.acceptedDialog`).
- **Policy guard** — `PolicyGuardedSurface` is the only `Surface` session, replay and agent receive
  (invariant 2). Before each `act` it builds an intent (target's accessible name + frame URL, a resolved
  `navigate` route, or every frame URL — most restrictive verdict wins); a click/press whose `navigatesTo`
  is off the allowlist is denied, and is passed as `destinationUrl` (an irreversible route → approval).
  `deny` → `PolicyDeniedError` (pre_action); `require_approval` → `ApprovalRequiredError` unless the action
  carries a grant the `ApprovalGrantRegistry` minted, unused, unexpired and bound to the same stepId or
  `fingerprintKey` (consumed, then forwarded). Allowed actions are forwarded without their grant. After acting
  every frame URL passes `evaluateLanding` (deny → `PolicyDeniedError` post_action). `checkNavigation` gives
  the verdict for a navigation the guard did not start. Verdicts go to `onVerdict`; the guard never logs.
- **Masked evidence** — `captureEvidence` / `captureMaskedScreenshot` mask, in every frame, each element whose
  text/value the redactor would change plus the value cells of sensitive-header rows, and only then brand the
  bytes `MaskedScreenshot`. Refused (`DialogPendingError`) while a native dialog blocks the page.
- **Network guard** — `installNetworkGuard` aborts every request to an origin outside the allowlist (and every
  non-http(s) scheme but `about:`/`data:`); it has one navigation-hook slot used by the recorder.
- **Human-action recorder** — see below (**define-action touch point 6**: `recorder/mapDomEventToStep.ts`).

## Human-action recorder (mediated control, R6.2)

- A capture script (`addInitScript` + evaluate in open frames) blocks click / Enter / submit in the capture
  phase and reports them (plus `change`, not blocked) through an exposed binding with a random name.
- Each gesture is fingerprinted, mapped (`mapDomEventToStep`), given a ladder (`targetFromFingerprint`,
  checked to resolve the same element) and re-executed through `PolicyGuardedSurface.actWith` (actor `human`).
- **Single-use passes, secret-keyed:** only after policy allowed it, the recorder sets a pass through the
  document's capture control (closure state behind a non-writable `window[stateKey]` that requires the
  per-recording secret — no DOM attribute). It lets exactly one trusted event of the re-execution's kind
  through (plus the submit it causes), and is cleared when the act ends (or once a pending dialog is settled).
- Refusals are recorded (`refused: true`) and shown in an in-page banner. Humans cannot bypass approval.
- **Address-bar navigation:** off-allowlist origins are blocked by the network guard and recorded as refused;
  any other document request no guarded act started goes through the navigation hook →
  `guard.checkNavigation` (actor `human`): denied / irreversible → aborted and recorded refused; allowed
  top-level → recorded as `navigate`. The URL is a sensitive value.
- **Omitted kinds:** `extract` and `wait` are not actions on the page; `dismiss_dialog` is settled by the
  operator via `settleDialog` (the dialog is held outside the page).

## Never

- Never executes an action that did not pass policy outside the guard: every `act` maps to one registered
  action type with a risk class and an allowlist check.
- Never lets Playwright types leak through the barrel; `BrowserHandle` stays opaque.
- Never auto-accepts a native dialog; never navigates back after a denied landing.
- Never sends unredacted data to evidence (`captureEvidence` returns masked/redacted data only).
- Never imports `@idp/session`, `@idp/replay-engine`, `@idp/agent` or any app (incl. `apps/mock-bank`, which
  tests start as a process). Never depends on `@anthropic-ai/sdk`.
- Never downloads browsers (tests and `launchWebSurface` use the Chromium from `pnpm setup:browsers`).
- Never imports `./testing` from production code.

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/policy`, `@idp/evidence`, and third-party `playwright` (owned here: BND004).
- Dev tools are `catalog:` devDependencies; `@idp/typescript-config` is `workspace:*`.
- Enforced by `pnpm lint` (ESLint `no-restricted-imports` from `tools/repo-checks/layers.json` +
  `pnpm boundaries`): BND001 (workspace deps above only), BND004, BND005 (`@anthropic-ai/sdk` → `@idp/agent`).

## Layout

```
src/
  index.ts        barrel: port types, launchWebSurface, guard, recorder, pure helpers, errors
  port/           the Surface port and its plain data types (Observation, SurfaceAction, ActOutcome, …)
  snapshot/       pure: aria-snapshot parsing, frame merge + refs, observation digest
  locators/       FrameResolver, LadderResolver, rungToLocator, structuralXPath, fingerprintElement
  playwright/     WebSurface, launch/openWebSurface, captureFrames, networkGuard, NavigationTracker, …
  dialogs/        DialogMonitor, dialogMatches
  actions/        executeAction, ActionContext, raceDialogs, actAndSettle, executors/<kind>.ts
  guard/          PolicyGuardedSurface, ApprovalGrant(Registry), fingerprintKey
  evidence/       markSensitiveElements, captureMaskedScreenshot
  recorder/       captureScript, mapDomEventToStep, targetFromFingerprint, HumanActionRecorder
  errors/         typed errors with stable codes
  internal/       template substitution, route globs, text normalization
  testing/        `@idp/surface/testing` harness (see README)
test/functional/  Playwright against a real mock-bank process
```

Exemplars: `actions/executors/select.ts` + `select.test.ts` (an executor), `guard/PolicyGuardedSurface.test.ts`
(unit tests on `FakeSurface`), `test/functional/recorder.test.ts` (functional test with `launchMockBank`,
`launchBrowserFixture`, `SimulatedOperator`).

## Commands

```bash
pnpm --filter @idp/surface build
pnpm --filter @idp/surface typecheck
pnpm --filter @idp/surface test               # unit: src/**/*.test.ts, no browser, no process
pnpm setup:browsers                           # once: installs Chromium (functional tests only)
pnpm --filter @idp/mock-bank build            # functional tests start apps/mock-bank/dist
pnpm --filter @idp/surface test:functional    # test/functional/** (vitest.functional.config.ts)
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
