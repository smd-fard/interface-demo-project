# ADR-0010: Locked headed window, bounded takeover and one-time operator console key

| Field          | Value                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Status         | Accepted                                                                                        |
| Date           | 2026-09-30                                                                                      |
| Extends        | [ADR-0006](./0006-control-transfer-lease-and-mediated-human-control.md) (does not supersede it) |
| Requirements   | R6.1, R6.2, R6.3, R6.4, R4.1, R4.2, R4.3                                                        |
| Report section | 5 (console auth also feeds 6)                                                                   |
| Spec           | `_design/review-fixes/spec.md` (FR1, FR2, FR3, FR5)                                             |

## Context

ADR-0006 mediates human input only while the lease is `HUMAN`. A review found three gaps around it. (a) In an
attended run the headed window is open the whole time: while the automation held the lease, or an approval was
pending, a person could click and type into the page unrecorded and outside the policy (invariant 2). (b) One
timeout covered both the wait for an operator to claim a takeover and the takeover itself, so a human at the
controls could be timed out mid-task, and nothing bounded a claimed takeover separately. (c) The operator console
had no authentication: any local process could drive the session through it.

## Options

### a. Human input outside a takeover

- **A1. Lock by default; open only for one automation act.** ➕ Nothing reaches the page unless the lease is
  `HUMAN` or a policy-allowed automation act is running. ➖ More init-script code; a race window at frame load.
- **A2. Record-only (log unmediated input).** ➕ Simple. ➖ Reports a disallowed action after it happened
  (ADR-0006 option D).
- **A3. Kiosk / read-only window, or OS-level input capture.** ➕ Stronger isolation. ➖ Kiosk still delivers
  input to the page; OS hooks are per-platform, outside the `Surface` port, and cannot be tested headless.

### b. Timeouts

- **B1. Two waits: claim bound + takeover bound.** ➕ An operator is not cut off for being slow to finish; an
  abandoned takeover still ends. ➖ Two knobs, more timer state.
- **B2. One timeout for both.** ➕ One knob. ➖ Either too short for the human or too long for the claim.
- **B3. No takeover bound.** ➕ Never interrupts a human. ➖ A walked-away operator hangs the run forever.

### c. Console authentication

- **C1. One-time login key exchanged for a session cookie.** ➕ The control token never enters a URL, browser
  history or stdout. ➖ One login per console process.
- **C2. Reuse the control token (the spec's FR5 wording).** ➕ No new secret. ➖ The token would sit in a URL,
  browser history and the printed login line.
- **C3. No auth, localhost only.** ➕ Zero friction. ➖ Any local process can approve an irreversible step.

## Decision

**A1, B1, C1.** Each keeps invariant 2 or the control token's secrecy without adding a new process.

- **Lock.** The capture script has modes `off | block | record`. In `block` it stops every trusted pointer,
  click, key, input, change, paste, cut, drop and dragstart event in the capture phase and shows a banner,
  unless `automation` is on. Attended sessions call `recorder.lock()` before `ControlServer.start`. The
  automation stack is `LeasedSurface(guard(AutomationGateSurface(web, recorder)))`: the innermost gate wraps
  each `agent`/`replay` act in `automationAct`, so the page opens for exactly one act the lease and the policy
  allowed; a `human` act never opens it. `stop()` returns the recorder to `block` when locked. In `record`
  mode a human fill/select is checked by the policy and, if refused, reverted with `settle`.
- **Two waits.** `approvalTimeoutMs` bounds only the wait for a claim; `claim()` re-arms the waiter with
  `takeoverTimeoutMs` (default 30 min, bounded 1–14 400 000 ms). An expired request is hidden from `list()`,
  refuses every transition with an `INTERVENTION_CONFLICT` whose `problem` is `expired`, and is skipped by
  resume/abort. The timeout outcome carries `stage: unclaimed | takeover`. Expiry is in memory only.
- **Console key.** `idp operator` writes a 40-letter random key (`operator.key`, mode 0600, created with `wx`
  after removing any old file) and passes it as `IDP_OPERATOR_KEY`; it is removed when the console exits.
  Config requires 32–128 of `[A-Za-z0-9_-]` and a value different from the control token. `GET /login?k=`
  compares in constant time and accepts the key once, then sets a random `HttpOnly; SameSite=Strict; Path=/`
  session cookie and redirects (303) to `/`. Every other route answers 401 `LOGIN_REQUIRED` without calling
  the session. This is stricter than FR5's wording ("requires the session control token").

## Consequences

- **Easier:** a person at the headed window cannot act outside a takeover; a slow operator is not timed out
  once they have claimed; the console token stays server-side.
- **Harder:** the lock depends on the init script. A frame that loads before the reconfigure lands, or while a
  native dialog is pending (retried every 100 ms), is briefly unguarded. `submit` is not blocked, so a script
  `requestSubmit()` still works (a person's click or Enter that would submit is). A takeover timeout fails the
  run with the lease still `HUMAN`; cleanup relies on the session closing. Expiry is not persisted: the
  intervention contract has no `expired` status, so a persisted request keeps its last status. The console
  allows a single login; a lost cookie means restarting `idp operator`.
- **Revisit when:** remote operation arrives (ADR-0006 option C moves the lock to the input channel); an
  `expired` status is added to the intervention contract; or several operators need to share one console.
