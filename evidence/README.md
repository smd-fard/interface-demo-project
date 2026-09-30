# Evidence

Curated, **redacted** output from real runs. Nothing here is hand-edited: each directory is a verbatim copy of
the run directory the system wrote (`result.json`, `run.jsonl`, `manifest.json`, masked screenshots, redacted
accessibility snapshots, intervention requests; for discovery also the model prompts and the compiled artifact),
plus the CLI's own stdout as `cli-output.txt`. No control token, console key or local-only file was copied.

**Captured** 2026-09-30 (UTC) from `feature/review-fixes`, after `pnpm build`, under redaction rules **1.2.0**.
Target: the local mock bank (`node apps/mock-bank/dist/main.js`, `MOCKBANK_PORT=4211`, plus the fault or tenant
variable shown per row). Every CLI run used `MOCKBANK_ORIGIN=http://127.0.0.1:4211`, the synthetic seed login in
`MOCKBANK_OPERATOR_USER` / `MOCKBANK_OPERATOR_PASSWORD`, and `--runs-root .runs/evidence/<scenario>/runs`, which is
why printed paths start with `.runs/evidence/`. Member `12345` exists and `99999` does not. All data is synthetic.

## The discovered capability

[`artifacts/member-lookup.json`](artifacts/member-lookup.json) is byte-identical to the catalog's
[`../artifacts/member-lookup.json`](../artifacts/member-lookup.json) and to `discovery-member-lookup/artifact.json`.
It is `member-lookup@1.0.0`, `sha256:14d2bdb2…`, compiled from run `discovery-20260930T191747-2ede`. It has 7 steps,
4 of them sign-on. Every `member-lookup` replay below ran this discovered artifact, not a hand-written one.

## Runs

| Directory | What ran | Result (exit) | Shows |
| --------- | -------- | ------------- | ----- |
| [`discovery-member-lookup/`](discovery-member-lookup/) | `pnpm idp discover --model anthropic --goal "look up member 12345 and read their current savings balance" --input memberId=12345 --sensitive memberId --output savingsBalance:decimal:2 --id member-lookup` | goal met in **8 model turns**; artifact compiled; verify-replay `success` (0) | A real Claude run (`claude-sonnet-5-5`). Each `decision` line in `run.jsonl` has the model's one-sentence reason and the API's `modelResponse`: message id (`msg_011CfaAN3Q…` … `msg_011CfaAP43…`), model, `stop_reason`, token usage, latency. `prompts/turn-*.json` are the exact (placeholderized) requests: the model saw `{{memberId}}` and `{{credential.password}}`, never the values, and every balance was masked. `verify-replay/` is the replay that gated the save. |
| [`replay-member-lookup-success/`](replay-member-lookup-success/) | `replay --param memberId=12345` | `success`, `savingsBalance` `[REDACTED]` (0) | Deterministic replay, no model. `run.jsonl` has the policy verdict, the ladder rung used and the checkpoint for every step. |
| [`replay-member-lookup-not-found/`](replay-member-lookup-not-found/) | `replay --param memberId=99999` | `business_outcome` `member_not_found` at `s06` (3) | A legitimate answer, not a crash. |
| [`replay-member-lookup-validation-rejected/`](replay-member-lookup-validation-rejected/) | `replay --param memberId=abc` | `business_outcome` `validation_rejected` ("Invalid Member Number") at `s06` (3) | The app's own validation, reported as an outcome. |
| [`replay-member-lookup-injected-failure/`](replay-member-lookup-injected-failure/) | `MOCKBANK_FAULTS=app_error` | `failure` `app_error` at step 4 `s04-click-sign-on`, with expected / observed (1) | A hard failure with a masked screenshot, a redacted a11y snapshot and an intervention request. |
| [`replay-member-lookup-checkpoint-failed/`](replay-member-lookup-checkpoint-failed/) | `MOCKBANK_FAULTS=wrong_screen` | `failure` `checkpoint_failed` at `s06`: expected "Member Inquiry", observed not present (1) | The click did not throw, but the app landed on the wrong screen, and the checkpoint caught it. |
| [`replay-member-lookup-recovered-known-dialog/`](replay-member-lookup-recovered-known-dialog/) | `MOCKBANK_FAULTS=known_dialog` | `success`, 1 recovery (0) | `condition_detected known_dialog` → policy-checked `dismiss_dialog` → checkpoint re-verified. |
| [`replay-member-lookup-recovered-session-timeout/`](replay-member-lookup-recovered-session-timeout/) | `MOCKBANK_FAULTS=session_timeout` | `success`, 1 recovery (0) | `session_timeout` → one re-auth (`recoveryKind: reauth`, budget 1) → the run continues. |
| [`replay-member-lookup-tenant-b-drift/`](replay-member-lookup-tenant-b-drift/) | `MOCKBANK_TENANT=b`, `--profile mock-bank.tenant-b` | `success` with 2 drift entries (`s05` rung 1, `s06` rung 2, structural) (0) | The artifact discovered on tenant A runs on tenant B ("Account holder ID", "Find") through its lower ladder rungs, and reports the drift. |
| [`handoff-open-sub-account/`](handoff-open-sub-account/) | `IDP_CONTROL_PORT=4221 replay --artifact artifacts/open-sub-account.json … --attended`, then `GET /interventions` and `POST /interventions/<id>/approve` on the control API with the token from the token file | `success`, `confirmationNumber` `SA-000001` (0) | The irreversible Confirm pauses for approval: lease `AGENT → PAUSED → RESUMING → AGENT`, intervention request (open → resolved), masked screenshot of the review screen. |
| [`handoff-member-lookup-takeover/`](handoff-member-lookup-takeover/) | `MOCKBANK_FAULTS=app_error:once@/member/detail`; `IDP_NO_DOTENV=1 IDP_DEMO_MEMBER_ID=12345 IDP_CONTROL_PORT=4222 node evidence/handoff-member-lookup-takeover/driver.mjs` | `success` (0) | Human takeover of the **same live session**: `app_error` at `s06` → takeover request → claim → 3 recorded `human_action`s (click, fill, click; all `allow`) → resume → `success`. Lease `AGENT → PAUSED → HUMAN → RESUMING → AGENT`. |

## Honest notes

- **No person clicked.** The approval was a scripted call to the real control API. The takeover gestures were
  real browser mouse and keyboard events sent by `SimulatedOperator`, a test helper, from `driver.mjs`. That
  script builds the same attended replay the CLI runs, because the CLI's browser has no external driving hook.
  Everything else is real: the control API, the lease, the recorder and the policy.
- **Two real discovery runs** were made for this capture. Both met the goal in 8 turns and passed verification.
  The first printed one absolute path. After that path was fixed, the second run became the evidence and the
  catalog artifact. An earlier capture (redaction rules 1.0.0) exposed a checking balance in a prompt and was
  not used. It led to the `money-amount` rule.
- **Over-redaction, by design:** the non-sensitive `initialDeposit` is masked wherever it is shown on screen
  (`money-amount`), and the Oracle error code on the app-error page is partly masked.
- **Partial identifiers** the app itself shows (the SSN's last four, account numbers' last four, the branch) do
  appear in the prompts. Last-four is the app's own masking. Full values never appear.
