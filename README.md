# interface-demo-project

A computer-use automation system for legacy bank back-office apps that have no API. An LLM **discovers**
how to accomplish a goal on a live UI. The successful run becomes a typed, versioned **capability artifact**,
and that artifact is **replayed deterministically**, without the model, whenever an AI agent invokes it.
When the system gets stuck, a human takes over the same live session and hands it back.

> **Status:** the full loop (discover → artifact → replay → handoff → evidence) is implemented; see
> [`_design/index.md`](_design/index.md) and the umbrella spec
> [`_design/computer-use-automation-system/`](_design/computer-use-automation-system/spec.md).

- Design write-up: [`REPORT.md`](REPORT.md)
- Evidence of real runs: [`evidence/`](evidence/README.md)
- Requirements traceability: [`docs/requirements.md`](docs/requirements.md) · Decisions: [`docs/adr/`](docs/adr/README.md)

## Setup

Requires Node ≥ 22.13 (`.nvmrc` pins major 22; `.npmrc` sets `engine-strict=true`) and pnpm via Corepack
(the version comes from `packageManager` in `package.json`).

```bash
nvm use                # Node 22 from .nvmrc
corepack enable        # provides the pinned pnpm
pnpm install
pnpm build             # turbo run build (the CLI, mock-bank and operator run from dist/)
pnpm setup:browsers    # Playwright Chromium, needed by replay, discover and the functional tests
pnpm test              # unit tests (no API key, no browser, no network)
pnpm test:functional   # functional tests: real mock-bank process + Chromium, scripted model, no API key
pnpm lint              # ESLint + dependency-boundary checks (pnpm boundaries)
pnpm format:check      # Prettier
```

Other root scripts: `pnpm typecheck`, `pnpm format`, `pnpm boundaries`, `pnpm clean`, `pnpm mock-bank`,
`pnpm idp <command>`, `pnpm operator`.

### Configuration

```bash
cp .env.example .env   # gitignored; never commit real values
```

The CLI reads `.env` at the repo root (the shell wins; `IDP_NO_DOTENV=1` skips the file) and never prints its
values.

| Key                                                     | Needed for                          | Default / value                                                                                     |
| ------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                     | `discover --model anthropic` only   | none; replay, scripted discovery and the tests never use it                                         |
| `IDP_MODEL`                                             | `discover --model anthropic` only   | `claude-sonnet-5-5`                                                                                  |
| `MOCKBANK_OPERATOR_USER` / `MOCKBANK_OPERATOR_PASSWORD` | every replay and discovery          | the synthetic seed login `teller01` / `synthetic-pass-01` ([mock-bank README](apps/mock-bank/README.md#synthetic-credentials)) |
| `MOCKBANK_PORT`                                         | `pnpm mock-bank` and the CLI        | `4010`                                                                                              |
| `MOCKBANK_ORIGIN`                                       | the CLI (target origin)             | `http://127.0.0.1:$MOCKBANK_PORT`                                                                   |
| `IDP_CONTROL_PORT`                                      | attended sessions (control API)     | `4020`                                                                                              |
| `IDP_OPERATOR_PORT`                                     | operator console                    | `4030`                                                                                              |
| `IDP_RUNS_ROOT`                                         | where run directories go            | `<repo>/.runs`                                                                                      |
| `CONTEXT7_API_KEY`                                      | optional developer-docs MCP server  | none                                                                                                |

Runtime configuration that is data, not secrets: [`config/`](config/README.md) (the policy allowlist, risk
rules, redaction patterns and the per-tenant app profiles). The capability catalog is
[`artifacts/`](artifacts/README.md).

### Running without live services

No API key and no external network are needed for any of this; everything runs against the local mock-bank.

- **Tests:** `pnpm test` (unit), then `pnpm setup:browsers && pnpm test:functional` (end to end).
- **Replay** of the committed artifacts (`artifacts/member-lookup.json`, `artifacts/open-sub-account.json`):
  see the demo path below. Replay never loads the model.
- **Scripted discovery:** `--model scripted:packages/agent/scripts/member-lookup.script.json` drives the same
  discovery loop with a recorded fake model instead of Claude (step 2 below).

## Demo path

`pnpm build` and `pnpm setup:browsers` first, and `.env` with the synthetic operator login. Commands run from
the repo root; run `pnpm idp <command> --help` for every flag.

**1. Start the target** (terminal 1):

```bash
pnpm mock-bank                       # prints: listening http://127.0.0.1:4010
```

**2. Discover** a capability from a natural-language goal (terminal 2). Real Claude (needs `ANTHROPIC_API_KEY`,
costs money). This is the command that produced the committed `artifacts/member-lookup.json`
([evidence](evidence/discovery-member-lookup/)); use another `--out` to keep it:

```bash
pnpm idp discover --model anthropic \
  --goal "look up member 12345 and read their current savings balance" \
  --input memberId=12345 --sensitive memberId \
  --output savingsBalance:decimal:2 \
  --id member-lookup --out /tmp/member-lookup.json
```

Or without an API key, with the scripted model (use a different `--out` to keep the committed artifact):

```bash
pnpm idp discover --model scripted:packages/agent/scripts/member-lookup.script.json \
  --goal "look up member 12345 and read their current savings balance" \
  --input memberId=12345 --sensitive memberId \
  --output savingsBalance:decimal:2 --output memberName:string \
  --id member-lookup --out /tmp/member-lookup.json
```

Discovery compiles the run into an artifact, replays it once with the example inputs (`--verify-replay`, on by
default) and saves it only if that replay succeeds. Example values in the goal are placeholderized; the artifact
stores `{{memberId}}`, never `12345`. Each `--input` becomes a plain `string` param with no pattern; tighten it
in review (the edit changes the content hash, so re-hash).

**3. Replay** it deterministically (no LLM):

```bash
pnpm idp catalog --verify                                                     # list + verify content hashes
pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=12345  # success, exit 0
pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=99999  # business_outcome member_not_found, exit 3
pnpm idp replay --artifact artifacts/member-lookup.json --param memberId=abc    # business_outcome validation_rejected, exit 3
pnpm idp replay --artifact packages/artifact-schema/fixtures/member-lookup.artifact.json \
  --param memberId=abc                                                          # failure invalid_params, exit 1
```

The discovered artifact's `memberId` has no pattern, so `abc` reaches the app and CoreOne itself rejects it
("Invalid Member Number"). The hand-written reference fixture declares `^\d{5}$`, so the same value fails
`invalid_params` before any browser action.

Each prints the redacted `RunResult` JSON (sensitive outputs `[REDACTED]`), a one-line summary and the run dir.

**4. Faults.** Mock-bank's deterministic fault switches ([list](apps/mock-bank/README.md#fault-switches)) are
armed at start with `MOCKBANK_FAULTS` or at run time over its admin API:

```bash
MOCKBANK_FAULTS=app_error pnpm mock-bank        # replay → failure app_error with evidence, exit 1
MOCKBANK_FAULTS=known_dialog pnpm mock-bank     # replay dismisses the known dialog → success (1 recovery), exit 0
curl -X POST -H 'content-type: application/json' -d '{"code":"session_timeout"}' \
  http://127.0.0.1:4010/__admin/faults          # replay signs on again → success (1 recovery), exit 0
curl -X DELETE http://127.0.0.1:4010/__admin/faults   # disarm all
```

`failed_load_persistent` gives `failure recovery_exhausted` after the bounded retries.

**5. Attended handoff.** Opening a sub-account ends in an irreversible Confirm, which policy refuses without a
human approval. Run it attended (terminal 2):

```bash
pnpm idp replay --artifact artifacts/open-sub-account.json \
  --param memberId=12345 --param "product=Holiday Club" --param initialDeposit=250.00 --param nickname=Trip \
  --attended --headed
```

It prints the control URL and the token file, and pauses with an intervention request at the Confirm step.
In terminal 3:

```bash
pnpm idp operator                    # console at http://127.0.0.1:4030 (latest attended session)
```

In the console, take control or approve the step; the same live session resumes and returns
`success` with the confirmation number (`SA-nnnnnn`). Captured runs: approval in
[`evidence/handoff-open-sub-account/`](evidence/handoff-open-sub-account/), takeover with recorded human
actions in [`evidence/handoff-member-lookup-takeover/`](evidence/handoff-member-lookup-takeover/).

### Run evidence and exit codes

Every run writes a run directory (redacted `result.json`, run log, manifest, masked screenshots, snapshots,
intervention requests) under `.runs/` (gitignored; `--runs-root` or `IDP_RUNS_ROOT` to move it). Curated runs
are copied into [`evidence/`](evidence/README.md).

| Exit | Meaning                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------- |
| `0`  | success / goal met (discover: and verified and saved; catalog: listed and verified)                   |
| `3`  | business outcome (e.g. `member_not_found`)                                                            |
| `1`  | failure or error (step failure, config/credential error, missing API key, verify-replay failed, catalog mismatch with `--verify`) |
| `4`  | discovery stopped without meeting the goal                                                            |
| `64` | usage error                                                                                           |

## Repository layout

See [`CLAUDE.md`](CLAUDE.md) § Workspace map.
