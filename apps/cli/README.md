# @idp/cli

The `idp` command-line app for the demo path: `discover`, `replay`, `catalog` and `operator`. Run it from the
repo as `pnpm idp <command> [flags]` (after `pnpm build`), or as `node apps/cli/dist/main.js <command>`.
`idp <command> --help` prints the real flags of each command.

## Commands

| Command    | What it does                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover` | A model (`--model scripted:<file>` or `anthropic`) drives the live app to `--goal`; the run compiles into an artifact, is replayed once with the example inputs (`--[no-]verify-replay`) and saved to `--out` only if that replay succeeds. |
| `replay`   | Runs `--artifact` with `--param k=v` deterministically (no LLM; `@idp/agent` is never loaded). Prints the redacted `RunResult` JSON, a one-line summary and the run dir. `--attended` prints the control URL and writes the token to `<run dir>/control.token` (0600). |
| `catalog`  | Lists `artifacts/*.json`: id, version, summary, params, outputs, hash status (`verified` / `mismatch` / `invalid`). `--verify` exits 1 on any non-verified file; `--json`.                                |
| `operator` | Spawns `node apps/operator/dist/main.js` with `IDP_CONTROL_URL`, `IDP_CONTROL_TOKEN` (read from `--token-file`) and `IDP_OPERATOR_PORT`; without flags it uses the latest `.runs/*/control.json`.          |

## Exit codes

`0` success / goal met · `3` business outcome (e.g. `member_not_found`) · `1` failure or error (config, credential,
missing `ANTHROPIC_API_KEY`, verify-replay not successful, catalog mismatch with `--verify`) · `4` discovery stopped ·
`64` usage error.

## Paths

- `config/policy.json`, `config/apps/<name>.profile.json`, `artifacts/` and `.runs/` resolve against the repo root
  (the nearest `pnpm-workspace.yaml` above `dist/main.js`), whatever the cwd (`pnpm idp` runs with cwd `apps/cli`).
- Relative paths in flags (`--artifact`, `--out`, `--profile <file>`, `--model scripted:<file>`, `--token-file`,
  `--runs-root`, `--dir`) resolve against `INIT_CWD` (pnpm sets it; for a root script it is the repo root), else
  the cwd.
- `--profile` takes a name (`mock-bank`, `mock-bank.tenant-b`) or a path (contains `/` or ends in `.json`).
- Runs root: `--runs-root`, else `IDP_RUNS_ROOT`, else `<repo>/.runs`.

## Configuration (env)

Read from the shell and from `<repo>/.env` when present (the shell wins; `IDP_NO_DOTENV=1` skips the file). Values
are never printed: every line on stdout/stderr passes through the redactor, which is seeded with every
`*_USER`/`*_PASSWORD`/`*_TOKEN`/`*_API_KEY`/`*_SECRET` env value, the credentials, the params and the extracted
outputs.

| Variable                                                  | Used for                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `MOCKBANK_ORIGIN` / `MOCKBANK_PORT`                       | `${MOCKBANK_ORIGIN}` in the config files (default `http://127.0.0.1:${MOCKBANK_PORT:-4010}`). Any other `${VAR}` in a config file is expanded from the env (unset → `unknown_env_var`). |
| `MOCKBANK_OPERATOR_USER` / `MOCKBANK_OPERATOR_PASSWORD`   | Credential ref `mockbank-operator` (generally `<REF>_USER` / `<REF>_PASSWORD`, upper snake case).      |
| `ANTHROPIC_API_KEY`, `IDP_MODEL`                          | `discover --model anthropic` only (a missing key fails before any browser starts).                     |
| `IDP_CONTROL_PORT`                                        | Control API port of an attended session (default 4020).                                               |
| `IDP_OPERATOR_PORT`                                       | Operator console port (default 4030).                                                                 |
| `IDP_RUNS_ROOT`, `IDP_NO_DOTENV`, `IDP_DEBUG`             | Runs root; skip `.env`; print (redacted) stacks on errors.                                            |

## Attended sessions

`replay --attended` starts the session control API on `IDP_CONTROL_PORT` and writes `<run dir>/control.token`
(mode 0600, the bearer token) and `<run dir>/control.json` (`controlUrl` + `tokenFile`, never the token). Both are
removed when the session closes. `idp operator` without flags picks the newest `control.json` under the runs root.
`discover --attended` also opens the control API (its URL is printed) but writes no control files; its
verify-replay always runs unattended.

## Discover: params and outputs

Each `--input name=value` becomes a required `string` param (no pattern) named `name`; `--sensitive name` marks it
sensitive (others are not). `--output name:type` (`string | integer | boolean | decimal[:scale]`, scale default 2)
declares an output, always sensitive; when any `--output` is given the list is complete (every output the model
extracts must be declared), otherwise the model's declarations are kept.

## Printed results

`replay` prints the same redacted copy of the `RunResult` as `<run dir>/result.json` (structural fields verbatim,
free text redacted, sensitive outputs `[REDACTED]`), then a one-line summary (durations in seconds, sensitive
outputs shown as `[REDACTED]`). The real output values reach a calling agent only in memory, never on a sink.
