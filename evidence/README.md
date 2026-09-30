# Evidence

Curated, **redacted** output from real runs, produced only by `/capture-evidence` and never hand-edited.
Raw scratch output goes to `.runs/` (gitignored). Each run directory below is a verbatim copy of the run
directory the CLI wrote (`result.json`, `run.jsonl`, `manifest.json`, masked screenshots, a11y snapshots,
intervention requests, and for discovery the model prompts and the compiled artifact). Nothing `localOnly` and
no `control.token` / `control.json` was copied (none remained).

Captured 2026-09-30 (UTC) on branch `feature/computer-use-automation-system`, after `pnpm build`, under
redaction rules **1.1.0** (adds the `money-amount` rule: balances are fully masked, including in the model
prompts), except the takeover capture (see its row). Target: `apps/mock-bank` started with
`node apps/mock-bank/dist/main.js` (`MOCKBANK_PORT=4211`, plus the fault/tenant variables shown). Common
environment for every CLI run: `MOCKBANK_ORIGIN=http://127.0.0.1:4211`, `MOCKBANK_OPERATOR_USER` /
`MOCKBANK_OPERATOR_PASSWORD` set in the shell to the synthetic seed login (`mock-bank` README; the shell wins over
`.env`, which the CLI loaded for `ANTHROPIC_API_KEY` only), `--runs-root <scratch dir>`. All data is synthetic.

**`artifacts/member-lookup.json` is now the artifact compiled by the real discovery run below** (member-lookup
v1.0.0, `sha256:dfff5470…`, model `anthropic:claude-sonnet-5-5`), replacing the hand-written reference fixture
(v1.0.1). `evidence/artifacts/member-lookup.json` is a byte-identical copy. Every `member-lookup` replay row
below ran against this discovered artifact.

## Runs

| Scenario | Command | Result (exit) | Key files | Proves |
| -------- | ------- | ------------- | --------- | ------ |
| `discovery` (real LLM) | `pnpm idp discover --model anthropic --goal "look up member <existing-member> and read their current savings balance" --input memberId=<existing-member> --sensitive memberId --output savingsBalance:decimal:2 --id member-lookup --out <scratch>/member-lookup.json --runs-root <scratch>/runs` (model `claude-sonnet-5-5`, default budgets: 25 steps, 300 s) | goal met after **8 model turns** (fill user id, fill password, click Sign On, fill Member #, click Search, `declare_output`, `extract`, `finish`); compiled `member-lookup@1.0.0` (7 steps, 4 of them sign-on); verify-replay `success`, 0 recoveries (exit 0) | [`discovery-member-lookup/`](discovery-member-lookup/): `prompts/turn-01..08.json` (every model request: the goal as `look up member {{memberId}}`, observations with balances and names masked), `run.jsonl` (per-turn decisions, policy verdicts), `artifact.json`, `result.json`, `manifest.json`, `cli-output.txt`, [`verify-replay/`](discovery-member-lookup/verify-replay/) (`result.json`, `run.jsonl`, `manifest.json`) | AC1, R-REAL, D3 (R1.*, R2.1) |
| `replay-ok` | `pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=<existing-member>` | `success`, outputs `[REDACTED]`, 0 recoveries (exit 0) | [`replay-member-lookup-success/`](replay-member-lookup-success/): `result.json`, `run.jsonl` (policy verdict, locator rung and checkpoint per step), `manifest.json`, `cli-output.txt` (the CLI's redacted stdout) | AC4 (R3.1, R3.2) |
| `replay-not-found` | `pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=<unknown-member>` | `business_outcome` `member_not_found` at `s06-click-search` (exit 3) | [`replay-member-lookup-not-found/`](replay-member-lookup-not-found/): `result.json`, `run.jsonl`, `manifest.json`, `cli-output.txt` | AC6 (R3.3, R3.4) |
| `replay-fault app_error` | mock-bank with `MOCKBANK_FAULTS=app_error` (once, content pages); `pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=<existing-member>` | `failure` `app_error` at step 4 `s04-click-sign-on`, with expected / observed and evidence refs (exit 1) | [`replay-member-lookup-injected-failure/`](replay-member-lookup-injected-failure/): `result.json`, `screenshots/0002-failure-s04-click-sign-on.png`, `snapshots/0002.json`, `interventions/ir-*.json`, `manifest.json`, `run.jsonl`, `cli-output.txt` | AC7 (app error → failure), AC13 partially: screenshot + a11y snapshot referenced and in the manifest, **no trace** in this run |
| `replay-fault known_dialog` | mock-bank with `MOCKBANK_FAULTS=known_dialog`; `pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=<existing-member>` | `success`, 1 recovery (exit 0); `run.jsonl` has `condition_detected known_dialog` at `s06-click-search` → policy-checked `dismiss_dialog` → `recovery … succeeded` | [`replay-member-lookup-recovered-known-dialog/`](replay-member-lookup-recovered-known-dialog/): `result.json`, `run.jsonl`, `manifest.json`, `cli-output.txt` | AC7 (known dialog → recovered success) (R3.3, R3.5) |
| `replay-fault` tenant-B drift | mock-bank with `MOCKBANK_TENANT=b`; `pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=<existing-member> --profile mock-bank.tenant-b` | `success` with 2 drift entries (`s05-fill-member` rung 1, `s06-click-search` rung 2, both structural) (exit 0) | [`replay-member-lookup-tenant-b-drift/`](replay-member-lookup-tenant-b-drift/): `result.json`, `run.jsonl`, `manifest.json`, `cli-output.txt` | The discovered artifact reused on a tenant variant via its locator ladder (R7.2) |
| `handoff` (approval) | `IDP_CONTROL_PORT=4221 pnpm idp replay --artifact artifacts/open-sub-account.json --param memberId=<existing-member> --param "product=Holiday Club" --param initialDeposit=250.00 --param "nickname=<synthetic nickname>" --attended` (headless); then `GET /interventions` and `POST /interventions/<id>/approve` `{"operator":"ops-1"}` on the control API with the bearer token read from the printed token file | `success`, `confirmationNumber` `SA-000001` (exit 0) | [`handoff-open-sub-account/`](handoff-open-sub-account/): `interventions/ir-*.json` (open) and `ir-*-v2.json` (resolved), `run.jsonl` (`intervention raised`, lease `AGENT → PAUSED → RESUMING → AGENT`, `intervention resolved approve`, then the confirm), `screenshots/0001-intervention.png`, `snapshots/0001.json`, `result.json`, `manifest.json`, `cli-output.txt` | AC10 (R4.2, R6.1, R6.3) |
| Attended human takeover on the same live session: `app_error` (once, `/member/detail`) at s06 → takeover request → operator claims → fixes in the same browser → resumes. The human gestures were performed by a scripted `SimulatedOperator` issuing real browser mouse/keyboard input events, not by a person. | mock-bank with `MOCKBANK_FAULTS=app_error:once@/member/detail`, then `IDP_NO_DOTENV=1 node evidence/handoff-member-lookup-takeover/driver.mjs` (env: `IDP_DEMO_MEMBER_ID`, `MOCKBANK_OPERATOR_USER`/`_PASSWORD`, `MOCKBANK_ORIGIN`, `IDP_CONTROL_PORT`, `IDP_RUNS_ROOT`). It composes the CLI's `runReplay` (attended) with the real control API, because the CLI's browser exposes no external driving hook. It ran against member-lookup v1.0.1, the hand-written reference fixture, under redaction rules 1.0.0. | `success` (outputs `[REDACTED]`); lease AGENT → PAUSED → HUMAN → RESUMING → AGENT; 3 `human_action` (click, fill, click; all `allow`) | `handoff-member-lookup-takeover/run.jsonl`, `result.json`, `interventions/ir-20260930T032228-3f82{,-v2,-v3}.json`, `screenshots/0001-intervention.png`, `driver.mjs` | AC11, R6.2–R6.4 |
| Discovered artifact | copy of `artifacts/member-lookup.json` | n/a | [`artifacts/member-lookup.json`](artifacts/member-lookup.json) | D3: the capability artifact compiled from the real discovery run (`provenance.discoveryRunId` = the run in `discovery-member-lookup/`) |

## Notes

- **Discovery attempts.** Two real discovery runs were made. The first (redaction rules 1.0.0) met the goal and
  verified, but its recorded prompts held a non-extracted synthetic checking balance in clear, so it was not
  promoted; the `money-amount` rule (1.1.0) was added and the run above is the second attempt. No scripted run
  is used as R-REAL evidence.
- **Discovered vs. the former fixture.** The discovered artifact declares only `savingsBalance` (the goal asks for
  nothing else) and its `memberId` param is a plain `string` with no pattern (the CLI derives plain string
  params). Consequently `--param memberId=abc` is no longer rejected up front as `invalid_params`; the app itself
  rejects it: `business_outcome` `validation_rejected` ("Invalid Member Number") at `s06-click-search`, exit 3.
  That run is not stored as a separate evidence directory.
- **The approval in `handoff-open-sub-account` was issued by a scripted operator call** (curl) against the real
  session control API of the live attended run, not by a human clicking in the operator console. The lease
  history in this run is therefore `AGENT → PAUSED → RESUMING → AGENT` (approval path), without a `HUMAN` phase.
  The `HUMAN` phase is in `handoff-member-lookup-takeover/`.
- `cli-output.txt` and the run directories contain the scratch runs-root path of the capture machine; they are
  kept verbatim.
- The non-sensitive `product` param and `confirmationNumber` output appear in clear by design; `memberId`,
  `nickname`, member name, account numbers and balances are redacted in logs, snapshots, prompts and screenshots.
  Under rules 1.1.0 the `money-amount` rule also masks the non-sensitive `initialDeposit` wherever it is shown on
  screen (over-redaction, not a leak).
- The redactor over-masks the Oracle error code in the app-error page (`ORA-06512` → `ORA-[•••12]` in
  `snapshots/0002.json`, and the whole error line is blacked out in the screenshot). This is over-redaction,
  not a leak.
