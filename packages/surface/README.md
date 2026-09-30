# @idp/surface

The `Surface` port with the Playwright web adapter, the locator ladder, the policy guard, masked evidence
capture and the human-action recorder. Only plain types cross the barrel; Playwright stays inside. Rules for
contributors: [CLAUDE.md](CLAUDE.md).

## Usage

```ts
import { ApprovalGrantRegistry, launchWebSurface, PolicyGuardedSurface } from '@idp/surface';

const { surface: raw, handle } = await launchWebSurface({ origin: 'http://127.0.0.1:4010', headless: false });
const grants = new ApprovalGrantRegistry({ clock });
const surface = new PolicyGuardedSurface({ inner: raw, policy, origin: 'http://127.0.0.1:4010', grants, onVerdict });

const obs = await surface.observe(); // frame-aware a11y tree, refs e<N>
await surface.act({ kind: 'fill', actor: 'agent', target: { kind: 'ref', ref: 'e12' }, value: 'M-10001', sensitive: false });
const evidence = await surface.captureEvidence(redactor); // masked screenshot + redacted tree
await handle.close();
```

`policy` is a `@idp/policy` `ResolvedPolicy`; `redactor` a `@idp/policy` `Redactor`; `clock` an `@idp/evidence` `Clock`.

## Exports

### The port (types only)

- `Surface` — `observe(opts?)` → `Observation`; `resolve(target, bindings?)` → `Resolution`;
  `act(action)` → `ActOutcome`; `check(checkpoint, bindings, timeoutMs)` → `CheckResult`;
  `describe(target, bindings?)` → `ElementFingerprint`; `captureEvidence(redactor)` → `EvidenceCapture`;
  `location()` → `SurfaceLocation`; `pendingDialog()`; `close()`.
- `Observation` (`url`, `title`, `frames: FrameInfo[]`, `tree: A11yNode`, `pendingDialog`, `lastNavigation`,
  `digest`), `A11yNode`, `FrameInfo`, `FramePath`, `NavigationInfo`, `ObserveOptions`.
- `SurfaceAction` (one variant per action kind: `navigate`, `click`, `fill`, `select`, `press`, `extract`,
  `wait`, `dismiss_dialog`), `SurfaceActionOf<K>`, `ActionTarget` (`{ kind: 'target', target: TargetRef }` or
  `{ kind: 'ref', ref }`), `Bindings`.
- `ActOutcome` (`url`, `navigation`, `resolution?`, `extracted?`, `dialog?`, `acceptedDialog?`, `risk?`), `Resolution`,
  `CheckResult`, `ElementFingerprint`, `ContainerElementKind`, `PendingDialog`, `EvidenceCapture`,
  `SurfaceLocation`.

### Web adapter

- `launchWebSurface(options: LaunchWebSurfaceOptions)` → `WebSurfaceSession` (`{ surface, handle }`). Launches
  the installed Chromium (never downloads). Options: `origin`, `allowedOrigins?`, `viewport?`,
  `defaultTimeoutMs?`, `clock?`, `sensitiveRowHeaders?`, `headless?`, `slowMo?`. Requests outside
  `allowedOrigins` are aborted by the network guard.
- `BrowserHandle` — opaque: `bringToFront()`, `close()`, `closed`. Kept by the session for the handoff.

### Policy guard

- `new PolicyGuardedSurface({ inner, policy, origin, grants, onVerdict? })` — a `Surface` that checks every
  `act` against the policy (throws `PolicyDeniedError` / `ApprovalRequiredError`). Also `actWith(action,
hooks: GuardedActHooks)`, `checkNavigation(targetUrl, currentUrl, actor)` → `PolicyVerdict`, `acting`.
  Types `PolicyGuardedSurfaceOptions`, `VerdictListener`, `VerdictStage`, `GuardedActHooks`.
- `new ApprovalGrantRegistry({ clock, defaultTtlMs? })` — `mint(request: MintGrantRequest)` →
  `ApprovalGrant` (single-use, bound to a stepId or `fingerprintKey`); `consume(grant, binding)` →
  `GrantCheck`. Helpers `mintApprovalGrant`, `consumeGrant`. Types `ApprovalGrant`, `GrantBinding`,
  `GrantCheck`, `MintGrantRequest`, `ApprovalGrantRegistryOptions`.
- `fingerprintKey(fingerprint)` → string — the target key a grant binds to.

### Human-action recorder

- `new HumanActionRecorder(handle, { clock?, bannerMs?, onError? })` — `start(guard, onRecorded)`, `stop()`,
  `settleDialog('accept' | 'dismiss')` → `RecordedHumanAction`, `recording`. Every human gesture is
  re-executed through the guard (actor `human`) and recorded, refused or not.
- `RecordedHumanAction`, `HumanActionKind`, `RecordListener`, `HumanActionRecorderOptions`,
  `DomEventDescriptor`, `RecordedGesture`.
- `mapDomEventToStep(descriptor, fingerprint)` → `RecordedGesture | null` and `targetFromFingerprint(fingerprint)` → `TargetRef | null` — the pure
  mapping from a captured DOM event to a step and a locator ladder.

### Pure helpers

`parseAriaSnapshot`, `buildA11yTree` (types `FrameSnapshot`, `RefTarget`), `observationDigest`,
`structuralXPath`, `xpathLiteral`, `substituteTemplate`, `normalizeText`, `dialogMatches`.

### Errors

| Class                        | `code`                    | Class                   | `code`              |
| ---------------------------- | ------------------------- | ----------------------- | ------------------- |
| `PolicyDeniedError`          | `POLICY_DENIED`           | `DialogPendingError`    | `DIALOG_PENDING`    |
| `ApprovalRequiredError`      | `APPROVAL_REQUIRED`       | `DialogMismatchError`   | `DIALOG_MISMATCH`   |
| `ApprovalGrantError`         | `APPROVAL_GRANT_INVALID`  | `NoDialogPendingError`  | `NO_DIALOG_PENDING` |
| `TargetNotResolvedError`     | `TARGET_UNRESOLVED`       | `OptionNotFoundError`   | `OPTION_NOT_FOUND`  |
| `FrameNotFoundError`         | `FRAME_NOT_FOUND`         | `WaitTimeoutError`      | `WAIT_TIMEOUT`      |
| `UnknownRefError`            | `REF_UNKNOWN`             | `BindingMissingError`   | `BINDING_MISSING`   |
| `ActionFailedError`          | `ACTION_FAILED`           | `NavigationBlockedError` | `NAVIGATION_BLOCKED` |
| `RecorderStateError`         | `RECORDER_STATE`          | `SurfaceClosedError`    | `SURFACE_CLOSED`    |
| `SurfaceNotImplementedError` | `SURFACE_NOT_IMPLEMENTED` |                         |                     |

Types `PolicyDenialStage`, `ApprovalRequiredDetails`, `GrantRejection`, `RungObservation`.

## `@idp/surface/testing`

Functional-test harness; never imported by production code.

- `launchMockBank({ tenant?, faults?, slowMs?, sessionIdleMs?, startTimeoutMs? })` → `MockBank` (`origin`,
  `setFault(code, FaultOptions?)`, `clearFaults()`, `reset()`, `stop()`) — starts `apps/mock-bank/dist` as a
  process on a free port. Throws `MockBankStartError` (`MOCKBANK_START_FAILED`).
- `launchBrowserFixture({ headless? })` → `BrowserFixture` (`newSession(options)`, `closeSessions()`, `close()`).
- `new SimulatedOperator(handle)` — real mouse/keyboard input: `open(url)`, `click(target)`, `type(target, text)`,
  `press(key)`. Type `OperatorTarget`.
- `new FakeSurface(options: FakeSurfaceOptions)` plus `fakeFingerprint`, `fakeLocation`, `fakeObservation` —
  a scripted `Surface` for unit tests.
- `mockBankPolicyConfig(origin, { exclude? })` → `PolicyConfig` for the mock bank.

## Tests

```bash
pnpm --filter @idp/surface test               # unit, no browser
pnpm setup:browsers && pnpm --filter @idp/mock-bank build
pnpm --filter @idp/surface test:functional    # real Chromium against a real mock-bank process
```
