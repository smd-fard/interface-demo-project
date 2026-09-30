# ADR-0005: Policy, risk classes and human approval for irreversible actions

| Field          | Value                                                 |
| -------------- | ----------------------------------------------------- |
| Status         | Accepted                                              |
| Date           | 2026-09-29                                            |
| Requirements   | R4.1, R4.2, R6.1, R6.3                                |
| Report section | 6                                                     |
| Spec           | `_design/computer-use-automation-system/spec.md`      |

## Context

Actions come from three actors: the LLM in discovery, the replay engine, and a human during a handoff. On a
back-office app one click can open an account or move money, and that cannot be undone. The brief asks for a
configurable allowlist that the agent cannot step outside (R4.1). It also asks us to separate reversible from
irreversible actions and to treat the irreversible ones conservatively (R4.2). On legacy markup the
committing control may be called "Next", or the commit may be a form post or a native `confirm()`. A check
that trusts one signal, or that only some actors pass through, will leak.

## Options

### A. One pure policy evaluation in a guard surface; risk per action kind, raised by rules; approval via intervention (chosen)

- ➕ Every actor passes the same check, because the guard is the only `Surface` anyone receives (AC9).
- ➕ Risk has a floor that the author cannot lower. Rules can only raise it.
- ➕ The demo can finish `open-sub-account` with a human in the loop, on the same session.
- ➖ Every irreversible step needs an operator, so it cannot run unattended.
- ➖ Rules based on names and routes must be kept per app, and a missed pattern goes unnoticed.

### B. Block irreversible actions outright

- ➕ Simplest; no approval machinery.
- ➖ `open-sub-account` can never complete, and the system is useless for write flows, which are the
  valuable ones in a back office.

### C. Pre-approved unattended execution (S3: `draft → approved` artifact gates the run)

- ➕ High throughput; matches how a mature deployment would run trusted capabilities.
- ➖ Too permissive for money movement at PoC maturity. It needs a reliability score and a review workflow we
  do not have. It is kept as stretch goal S3 (designed, not built).

### D. Author-declared risk only (`declaredRisk` on the step)

- ➕ Explicit, and visible in the artifact.
- ➖ A wrong or missing annotation silently allows an irreversible click. A compiled artifact comes from an
  LLM run, so its annotations are not a trust anchor.

## Decision

Option A. It is the only option that is conservative and still lets a write flow finish. How it works in code:

- **Registry.** `ACTION_REGISTRY` (`packages/policy/src/actions/actionRegistry.ts`) has one entry per
  `ActionKind`. A `satisfies Record<ActionKind, …>` clause makes a missing entry a compile error.
  `navigate`, `extract` and `wait` are `read`. `click`, `fill`, `select`, `press` and `dismiss_dialog` are
  `reversible`. `click`, `press` and `dismiss_dialog` can be raised by their target.
- **Classification.** `classifyRisk` takes the maximum of the registry risk, `declaredRisk`, the
  irreversible control-name patterns (matched against the accessible name, or the dialog message), and the
  irreversible routes. The routes are checked against the navigate target or current page and against the
  **`destinationUrl`** of a click or press (the link href or form action). The result never goes below the
  registry risk.
- **Evaluation.** `evaluateAction` checks, in order: unknown kind, action allowlist, origin, route, risk. It
  is pure, never throws, and gives the same verdict whatever the actor. After acting, `evaluateLanding`
  checks every frame URL.
- **Guard.** `PolicyGuardedSurface` (`packages/surface/src/guard/`) builds the intent from the resolved
  target's fingerprint. `LiveSession` builds the guard and hands it to agent, replay and the human recorder.
  A `deny` throws `PolicyDeniedError`. A `require_approval` throws `ApprovalRequiredError` unless the action
  carries an `ApprovalGrant` that `ApprovalGrantRegistry` minted. The grant must be unused, unexpired
  (`approval.expiresMs`, 300 s) and bound to the same `stepId` or target `fingerprintKey`. The grant is
  consumed. An allowed action is forwarded without its grant, so a grant can never widen another action.
- **Replay.** `handleApproval.ts` raises the intervention. In an attended run, an approval retries the step
  once with the grant; a rejection fails with `approval_rejected` and a timeout with `timeout`. An
  unattended run fails with `approval_required` and the request ref.
- **Defence in depth.** `playwright/networkGuard.ts` aborts every browser request to an origin that is not
  allowlisted, and every scheme except http(s), `about:` and `data:`.

A `/safety-review` finding changed `config/policy.json`. `irreversible.routes` now names the commit endpoint
`/subaccount/opened`, which the Review page's form posts to. The review page `/subaccount/confirm` is
reversible. The `cannot be undone` pattern was added so that accepting the commit's native `confirm()`
also needs approval.

## Consequences

- **Easier:** proving R4.1/R4.2 on all three paths with one set of unit tests. Adding an action kind cannot
  skip policy. An irreversible commit is stopped even when its button has an innocent name, because the form
  action is checked.
- **Harder:** every write capability needs an operator at run time. Irreversible rules are per app and
  kept by hand; a missed pattern or route leaves a commit classed `reversible`. Known limits: an `Enter`
  with no target is judged only by the frame URLs, not by where the focused form posts (the dialog pattern
  is the backstop on the mock app). Cancelling a commit dialog also needs approval, because the rule matches
  the message and not accept or dismiss. Grants live in memory, so a restarted session loses them.
- **Revisit when:** a capability has a reliability record that justifies S3 pre-approval. A target app's
  commits are not visible in names, routes or form actions (e.g. XHR-only commits). Operators report
  approval fatigue on dismissing dialogs.
