# ADR-0006: Control transfer: a control lease, mediated human control on the same session, and a localhost control API

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Status         | Accepted                                               |
| Date           | 2026-09-29                                             |
| Requirements   | R6.1, R6.2, R6.3, R6.4, R4.1, R4.2, R4.3               |
| Report section | 5                                                      |
| Spec           | `_design/computer-use-automation-system/spec.md`       |

## Context

When replay or discovery gets stuck, or reaches an irreversible step, a human has to take over. They must
work in the **same** live session, not a fresh one (R6.2), the system must know who is in control (R6.3),
and the human's actions must be recorded (R6.2). Invariant 2 still applies: every action, including a
human's, must pass the policy. A human who clicks straight into the browser would bypass the allowlist and
the approval gate. Legacy markup makes this harder: framesets, and inline
`onclick="return window.confirm(…)"` handlers that act before any listener that runs later. Finally, the
operator console runs in a separate process (R6.4) and needs a way to drive the session.

## Options

### A. Control lease + mediated human control in the same headed context + localhost control API

- ➕ The same Playwright context: cookies, frameset state and evidence carry over.
- ➕ One explicit lease decides who may act, testable as a pure state machine.
- ➕ Human gestures go through the same policy guard as automation. A refused action is refused and
  recorded, and a human cannot click past an approval.
- ➖ Intercepting gestures in the page is fragile: double-firing, submits started by `onclick`, frames. It
  needs careful code and functional tests.
- ➖ The operator needs local access to the headed window. There is no remote operation.

### B. A new browser session for the human, then replay of the state

- ➕ Simple isolation. There is nothing to intercept.
- ➖ Violates R6.2 ("not a fresh one"). The legacy app's server-side session state (login, the half-finished
  wizard) cannot be moved over reliably. Evidence is split across two sessions.

### C. Remote co-browsing (CDP screencast / VNC)

- ➕ The real product shape: the operator works from anywhere.
- ➖ Out of scope per brief §3.6, and it still needs A's input mediation. Part of the REPORT §5 full design.

### D. Passive recording without mediation

- ➕ Much simpler: listen to events and log them.
- ➖ It cannot refuse a disallowed or irreversible human action. It only reports it after it has happened.

## Decision

**Option A.** It is the only option that keeps the same session and keeps invariant 2 for human actions too.

- **Lease.** `ControlLease` (`packages/session/src/lease`) has the states `AGENT → PAUSED → HUMAN → RESUMING →
  AGENT`, plus `PAUSED → RESUMING` (approve), `PAUSED → CLOSED` (reject) and `close` from any state.
  Transitions are serialized in a promise queue. A duplicate of the last transition is idempotent. Any other
  illegal transition throws `IllegalLeaseTransitionError`.
- **LeasedSurface.** It refuses an `agent`/`replay` act unless the lease is `AGENT`, and a `human` act unless it
  is `HUMAN` (`LeaseNotHeldError`). Observation always passes.
- **Mediation.** `HumanActionRecorder` (`packages/surface/src/recorder`) is started by `LiveSession` while the
  lease is `HUMAN`. A capture-phase script, installed with `addInitScript` in every frame, blocks clicks, Enter
  and submits, and reports them over a randomized `exposeBinding`. The recorder fingerprints the element and
  checks that the locator ladder built from the fingerprint resolves back to that element. It then re-executes
  the action through `PolicyGuardedSurface(LeasedSurface(web))` as actor `human`. The re-execution gets through
  the script with a single-use pass for one element and one event, set only after the policy allowed it and
  gated by a per-recording secret. Denied and approval-requiring actions are not performed. They are recorded
  as refused and shown in an in-page banner. The network guard checks address-bar and script navigations and
  records them. Each action is logged as a `human_action` entry, and fill values are marked sensitive.
- **Resume.** After a takeover, the caller re-verifies its checkpoint before `reacquire()`
  (`handleHardFailure.ts`, `DiscoveryLoop.ts`). A mismatch fails the run with `checkpoint_failed`.
- **Control API.** `ControlServer` is `node:http` on 127.0.0.1 only. It uses a per-session 64-hex bearer token
  and is used through `ControlClient` by the separate, deliberately minimal `apps/operator`, which keeps the
  token server-side. The routes list requests, claim, approve, reject, resume and abort.

## Consequences

- **Easier:** proving R6.2 and R6.3 (`handoff.test.ts` asserts the history `AGENT → PAUSED → HUMAN → RESUMING →
  AGENT`, a ladder-ready fingerprint on the recorded action, and that an agent act while `HUMAN` throws).
  Irreversible approval and "stuck" use one mechanism. Human steps from discovery compile into the artifact
  with `actor: 'human'`.
- **Harder:** the capture script is the most delicate code in the repo. Gestures that are not intercepted
  (hover, drag, right-click menus, keyboard shortcuts other than Enter) are not recorded. The human must be
  at the machine that runs the headed browser (`--headed`). One operator per session, and nothing is
  persisted if the process dies: grants are in memory only. The bearer token must be handed to the operator
  process out of band.
- **Revisit when:** operators need remote access (move to option C, with the same guard behind a streaming
  input channel); a desktop surface arrives (mediation has to move from the DOM to UIA/AX hooks); or real
  legacy screens show gestures that are not captured.
