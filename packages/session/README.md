# @idp/session

The live session controller (R6.1–R6.3): one browser, one run directory, one **control lease**. It raises
intervention requests, hands the **same live session** to a human operator, records the operator's actions,
and gives control back to the automation (replay or agent). An attended session runs a localhost control API
that the operator console drives.

## Quick start

```ts
import { openLiveSession } from '@idp/session';

const session = await openLiveSession({
	policy, // ResolvedPolicy from @idp/policy
	redactor, // Redactor from @idp/policy (seeded with the run's sensitive values)
	runsRoot: 'runs',
	runKind: 'replay',
	origin: 'http://127.0.0.1:4010',
	attended: true, // runs the control server; interventions wait for an operator
	subject: { kind: 'capability', id: 'member-lookup', version: '1.0.0' },
});
console.log(session.controlUrl); // hand controlUrl + controlToken to the operator process (never log the token)
await session.surface.observe(); // the leased, policy-guarded surface: the only one handed out
await session.manifest.writeResult(result);
await session.close();
```

## Exports

### Control lease

- **`ControlLease`** (`new ControlLease({ automationActor, clock? })`) — the state machine that says who holds
  the live session (FR20). `state()`, `holder()` (`agent | human | none`), `operator()`, `history()`,
  `onChange(listener) → unsubscribe`, `settled()`, and the transitions below. Transitions are serialized in a
  promise queue. A duplicate of the transition just applied is idempotent (it records nothing). Any other
  illegal operation rejects with `IllegalLeaseTransitionError` and changes nothing.

  | Operation                                | From      | To         | Actor                |
  | ---------------------------------------- | --------- | ---------- | -------------------- |
  | `pause(reason, requestId?)`              | `AGENT`   | `PAUSED`   | automation           |
  | `cede(operator, reason?)`                | `PAUSED`  | `HUMAN`    | operator             |
  | `approve(operator, requestId?, reason?)` | `PAUSED`  | `RESUMING` | operator             |
  | `reject(operator, reason?)`              | `PAUSED`  | `CLOSED`   | operator             |
  | `resume(operator, reason?)`              | `HUMAN`   | `RESUMING` | operator             |
  | `reacquire(reason?)`                     | `RESUMING`| `AGENT`    | automation           |
  | `close(actor, reason?)`                  | any       | `CLOSED`   | automation/operator  |

- Types: `LeaseHolder`, `AutomationActor` (`agent | replay`), `LeaseListener`, `ControlLeaseOptions`,
  `LeaseOperation`.
- **`LeasedSurface`** (`new LeasedSurface(inner, lease)`) — a `Surface` decorator. It rejects every `act`
  whose actor does not hold the lease (`agent`/`replay` need `AGENT`, `human` needs `HUMAN`) with
  `LeaseNotHeldError`, before the inner surface is touched. Observation methods always pass through.

### Intervention requests

- **`InterventionService`** — the intervention requests of one session. `raise(input)` captures masked
  evidence (the refs are `null` when a typed capture error occurs, e.g. a native dialog blocks the page),
  builds the request from redacted text, validates it against `InterventionRequestSchema`, persists it as
  `interventions/<id>.json`, logs `intervention raised` and pauses the lease. `claim` / `approve` / `reject` /
  `resume` / `abort` resolve requests. The lease transition runs first, so an illegal one leaves the request
  unchanged. Each status change is persisted as a new version (`<id>-v2.json`, …), and files are never
  overwritten. `approve` mints a single-use `ApprovalGrant`, which is kept in memory only.
  `awaitResolution(id, { timeoutMs?, claimedTimeoutMs? })` waits: `timeoutMs` bounds the open request, and a
  claim restarts the wait under `claimedTimeoutMs` (the operator's time at the controls). When a bound passes
  the request **expires**: it leaves `list()`, and claim / approve / reject answer `InterventionConflictError`
  (`problem: 'expired'`, 409). The persisted document keeps its last status (the contract has no `expired`
  status). `list()`, `get(id)`, `isExpired(id)` and `refOf(id)` read requests.
- Types: `RaiseInterventionInput`, `InterventionResolution`, `InterventionServiceOptions`,
  `InterventionSubject`, `InterventionStep`, `GrantBindingInput`.
- **`redactInterventionRequest(request, redactor)`** — redacts every free-text field (reason text, goal, step
  description, URL, title) and keeps structural fields verbatim.

### Control API (ADR-0006)

- **`ControlServer.start({ target, port?, random?, onError? })`** — a `node:http` server bound to
  **127.0.0.1 only** (port 0 means ephemeral). `url`, `token`, `address()`, `close()`. Every request needs
  `Authorization: Bearer <token>`: 64 hex characters from system randomness, compared in constant time.
  POST bodies are exactly `{ "operator": "<handle>" }` (lowercase handle, ≤ 16 KiB, no other field).

  | Route                                                 | Returns                                    |
  | ----------------------------------------------------- | ------------------------------------------ |
  | `GET /lease`                                          | `LeaseView` (state, holder, redacted history) |
  | `GET /interventions`, `GET /interventions/:id`        | redacted `InterventionRequest`(s)          |
  | `GET /evidence/:refId`                                | masked screenshot, redacted a11y snapshot or intervention JSON |
  | `POST /interventions/:id/claim\|approve\|reject`      | the updated request                        |
  | `POST /resume`, `POST /abort`                         | `LeaseView`                                |

  Errors are `{ error: { code, message } }`. 400 means an invalid body (`SESSION_VALIDATION`). 401 means a
  missing or bad token. 403 means the evidence is not shareable (`localOnly` refs such as traces are never
  served). 404 means an unknown route, request or evidence. 405 means the wrong method. 409 means an illegal
  lease transition, a request conflict or an invalid grant. 413 means the body is too large. 500 means an
  unexpected error, which is answered without detail and reported to `onError` (or `errors`).
- **`ControlClient`** (`new ControlClient({ url, token, fetch? })`) — a typed client with `lease()`,
  `interventions()`, `intervention(id)`, `evidence(refId) → ServedEvidence`, `claim(id, handle)`,
  `approve(id, handle)`, `reject(id, handle)`, `resume(handle)` and `abort(handle)`. Responses are validated
  against the contracts. Error answers throw `ControlApiError` (`status`, `apiCode`). An unreachable server
  has status 0 and `apiCode` `UNREACHABLE`.
- Types: `ControlTarget` (what the server drives; a fake in tests), `LeaseView`, `ControlServerOptions`,
  `ControlClientOptions`, `ServedEvidence`.

### Live session

- **`openLiveSession(options) → LiveSession`** — launches the web surface and stacks
  `LeasedSurface(PolicyGuardedSurface(AutomationGateSurface(web)))` for the automation. It creates the run directory, run log,
  evidence store and manifest. It logs `policy_verdict`, `lease_change` and `human_action`, and starts the
  human-action recorder while the lease is `HUMAN`. The recorder goes through
  `PolicyGuardedSurface(LeasedSurface(web))`, so a human also acts only while holding the lease. Attended
  sessions also start the `ControlServer`. Options (`OpenLiveSessionOptions`): `policy`, `redactor`,
  `runsRoot`, `runKind`, `runId?`, `origin`, `allowedOrigins?`, `headless?` (default true), `slowMo?`,
  `attended`, `controlPort?`, `subject`, `automationActor?`, `interventionTimeoutMs?` (the wait for a decision
  or a claim; default 15 min), `takeoverTimeoutMs?` (a claimed takeover; default 30 min), `clock?`, `random?`,
  `launch?`.
- **`LiveSession`** — `surface`, `lease`, `interventions`, `runLog`, `evidence`, `manifest`, `runDir`,
  `grants`, `browser`, `runId`, `controlUrl`, `controlToken`, `recordedHumanActions()`, `close()`.
  - `requestApproval(step: ApprovalStep, opts?) → ApprovalOutcome`. Call it after an
    `ApprovalRequiredError`. It raises an approval request and waits. On `granted`, the session has
    **already reacquired** the lease (PAUSED → RESUMING → AGENT: no human acted, so nothing changed on
    screen). Act once with `approvalGrant: grant`. The other outcomes: `rejected` / `aborted` (the lease is
    `CLOSED`), `timeout` (the lease stays `PAUSED`), `unattended`.
  - `escalate(reason, currentStep, opts?) → EscalationOutcome`. It raises a takeover request and waits for
    the operator to claim, act and resume. On `resumed`, the lease is `RESUMING` and `humanActions` holds the
    recorded actions. The **caller** re-observes and re-verifies its current checkpoint, then calls
    `lease.reacquire()` (a mismatch is a hard failure). The wait for the claim is bounded by `timeoutMs`; once
    claimed, by `takeoverTimeoutMs` (a claim does not end the wait; the operator's resume or abort does). The
    other outcomes: `aborted`, `timeout` (`stage: 'unclaimed' | 'takeover'`; the request expired),
    `unattended`.
  - **Unattended** (`attended: false`): no control server runs. Both calls raise and persist the request
    and return `{ kind: 'unattended', requestId }` immediately. The lease stays `PAUSED`, and the caller
    fails with the request ref.
  - Write the run result (`manifest.writeResult`) before `close()`.
- Types: `ApprovalStep`, `ApprovalOutcome`, `EscalationOutcome`, `InterventionCallOptions`,
  `SessionHumanAction`.

### Errors (typed, stable `code`)

| Class                         | `code`                     | When                                                       |
| ----------------------------- | -------------------------- | ---------------------------------------------------------- |
| `IllegalLeaseTransitionError` | `ILLEGAL_LEASE_TRANSITION` | an operation is not legal from the current state (409)     |
| `LeaseNotHeldError`           | `LEASE_NOT_HELD`           | an actor acted without holding the lease                   |
| `InterventionConflictError`   | `INTERVENTION_CONFLICT`    | wrong request kind or status, or an expired request (409)  |
| `InterventionNotFoundError`   | `INTERVENTION_NOT_FOUND`   | unknown request id (404)                                   |
| `InterventionTimeoutError`    | `INTERVENTION_TIMEOUT`     | nobody resolved the request in time                        |
| `SessionValidationError`      | `SESSION_VALIDATION`       | malformed operator, reason, id or body (400); names the field, never the value |
| `ControlServerStartError`     | `CONTROL_SERVER_START`     | the control server cannot listen                           |
| `ControlApiError`             | `CONTROL_API_ERROR`        | client side: the API answered an error or broke the contract |

## Tests

```bash
pnpm --filter @idp/session test              # unit: lease, leased surface, interventions, control server/client
pnpm --filter @idp/mock-bank build           # the functional test starts apps/mock-bank/dist
pnpm --filter @idp/session test:functional   # handoff.test.ts: takeover, approval, unattended (headless Chromium)
```
