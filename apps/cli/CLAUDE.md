# @idp/cli — CLAUDE.md

> Workspace: `apps/cli` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The demo-path command-line app: `discover` (LLM drives the live UI and compiles a capability artifact),
`replay` (deterministic execution of an artifact), `catalog` (list available capabilities) and `operator`
(intervention handoff). It wires the lower packages together and owns no domain logic of its own.
The `idp` bin points at `dist/main.js`, which exists only after build (never commit `dist/`); the root
`pnpm idp <command>` script runs it. Status: implemented (plan step 50 of `computer-use-automation-system`).

## Owns

- The `idp` bin entry and command parsing/dispatch (`discover`, `replay`, `catalog`, `operator`).
- Wiring of session, replay engine and agent for the demo path; printing the `RunResult` to the user.

## Never

- Never imports `@idp/operator` (peer app) or `@idp/mock-bank` (black box, reachable only over HTTP).
- Never imports `playwright` or `@anthropic-ai/sdk` directly — go through `@idp/surface` / `@idp/agent`.
- The `replay` command never constructs or calls the agent / an LLM (invariant 1, R3.1). Only
  `src/commands/discover.ts` imports `@idp/agent`; `main.ts` loads each command with a dynamic `import()`, so
  `replay`/`catalog`/`operator` never load it at run time (the functional test proves it with a resolve hook).
  Modules shared with `replay` (`replay/`, `config/`, `output/`, …) must never import `@idp/agent`.
- Never writes to stdout/stderr except through `output/Printer.ts` (every line redacted; JSON only as `Redacted<T>`).
- Never echoes secrets from `.env`.
- Never logs or prints unredacted data (invariant 3).

## Allowed dependencies

- `@idp/artifact-schema`, `@idp/policy`, `@idp/evidence`, `@idp/session`, `@idp/replay-engine`, `@idp/agent`.
- No third-party runtime dependencies yet. `@idp/surface` is a devDependency only (`@idp/surface/testing`:
  `launchMockBank` for the functional test).
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`, `tsx`) are `catalog:` devDependencies;
  versions live in the root `pnpm-workspace.yaml`. `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

The dependency direction is enforced by `pnpm lint`: ESLint `no-restricted-imports` generated from
`tools/repo-checks/layers.json` (source imports) plus `pnpm boundaries` (manifest check, BND001–BND009).
Codes most relevant here:

- BND001 — top layer; `@idp/operator` is the same rank (a peer), so it is forbidden.
- BND003 — `@idp/mock-bank` is isolated: no workspace may depend on it.
- BND004 (`playwright` is owned by `@idp/surface`); BND005 (`@anthropic-ai/sdk` is owned by `@idp/agent`).

The replay path has its own ESLint block, `idp/cli-replay-path-no-agent` in the root `eslint.config.js`: it forbids
`@idp/agent` in `src/commands/replay.ts`, `src/commands/catalog.ts`, `src/replay/**` and `src/catalog/**`
(invariant 1, R3.1). The functional test also asserts at run time that `replay` never loads `@idp/agent`.

## Layout

```
src/
  main.ts                 the bin: .env, base redactor, dispatch by dynamic import, errors → exit codes
  index.ts                empty barrel (an app: nothing imports it)
  args/                   CommandSpec, parseCommandArgs (node:util parseArgs), parseKeyValues, parseOutputFlag, formatHelp
  cli/                    CliContext, CommandModule, exitCodes (EXIT, exitCodeFor)
  config/                 loadConfig, expandEnvTokens, mockBankOrigin, resolveProfilePath, loadDotEnv, EnvCredentialProvider
  commands/               discover (the only @idp/agent import), replay, catalog, operator, controlPort
  replay/                 loadArtifactFile, runReplay (session + replay engine; shared by replay and discover)
  catalog/                readCatalog (hash status per artifact)
  operator/               writeControlFiles (0600 token), findLatestControl
  output/                 Printer (the only stdout/stderr writer), printResult (JSON + summary)
  paths/                  findRepoRoot, invocationDir (INIT_CWD), resolveRunsRoot
  errors/                 CliUsageError (64), ConfigError, ArtifactFileError, OperatorLaunchError
test/functional/cli.test.ts  spawns the built CLI against a launched mock-bank
vitest.config.ts             unit tests (src/**/*.test.ts): no browser, no process
vitest.functional.config.ts  functional tests (test/functional)
```

## Exemplars (copy these)

- A command: `src/commands/catalog.ts` (a `spec` for `--help` + `run(args, context)` returning an exit code).
- The replay wiring: `src/replay/runReplay.ts`. Output: `src/output/printResult.ts` (redacted JSON + summary).
- Env-backed config: `src/config/EnvCredentialProvider.ts` (ref `mockbank-operator` → `MOCKBANK_OPERATOR_USER` /
  `MOCKBANK_OPERATOR_PASSWORD`). Attended runs: `src/operator/writeControlFiles.ts` (`control.token` 0600 +
  `control.json`, removed when the session closes).
- Tests: `src/config/loadConfig.test.ts` (unit), `test/functional/cli.test.ts` (spawned CLI + agent-load probe).
  Contract-specific replay assertions (exact outputs, version, `invalid_params`) use the stable reference fixture
  `packages/artifact-schema/fixtures/member-lookup.artifact.json`; tests over `artifacts/` stay contract-agnostic
  (expectations derived from the artifact file), because a real discovery run legitimately replaces the catalog.

## Commands

```bash
pnpm --filter @idp/cli build
pnpm --filter @idp/cli typecheck
pnpm --filter @idp/cli test
pnpm --filter @idp/cli test:functional   # needs the CLI, mock-bank and deps built + Playwright chromium
pnpm idp <command> --help                # from the repo root (after build)
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
