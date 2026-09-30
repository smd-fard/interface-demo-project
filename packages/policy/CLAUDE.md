# @idp/policy — CLAUDE.md

> Workspace: `packages/policy` · Root rules: [../../CLAUDE.md](../../CLAUDE.md)

## Purpose

The guardrails as pure functions: the action registry (risk class, allowlist key, payload redaction per
action kind), risk classification, the allowlist evaluation of every action and landing URL, and the redactor
applied before data reaches any sink. It is the single source of truth behind hard invariant 2 (every action
goes through policy) and invariant 3 (redact before any sink). Serves R4.1 (allowlist), R4.2 (reversible vs
irreversible, conservative handling), R4.3 (redaction) and AC9 (same verdict for agent, replay and human).

**Status:** implemented — registry for all eight `ACTION_KINDS`, `evaluateAction` / `evaluateLanding`,
`classifyRisk`, `resolvePolicy`, `createRedactor` (default rules `REDACTION_RULES_VERSION = '1.2.0'`).

## Owns

- `ACTION_REGISTRY` in `src/actions/actionRegistry.ts` — **`define-action` touch point 2**. One frozen entry
  per `ACTION_KINDS` member (`risk`, `allowlistKey`, `raisableByTarget`, `payloadRedaction`, `rationale`);
  the `satisfies Record<ActionKind, ActionPolicyEntry>` makes a missing entry a compile error.
- `classifyRisk`: max of registry risk, declared step risk and irreversible rules (control-name patterns for
  target-raisable kinds; irreversible routes for the navigate target, the current page, and a click/press
  `destinationUrl`). It only ever raises.
- `evaluateAction`: unknown kind → action allowlist → origin → route → risk (irreversible →
  `require_approval`). Never throws; the verdict never depends on the actor. `evaluateLanding`: the
  post-action landing-URL check.
- `resolvePolicy`: compiles a parsed, env-expanded `PolicyConfig` into a frozen `ResolvedPolicy`
  (throws `PolicyConfigError`).
- `createRedactor`: known sensitive values → config patterns → config terms; `placeholderize` for LLM
  observations; the `Redacted<T>` and `MaskedScreenshot` compile-time brands; `DEFAULT_REDACTION_CONFIG`.

## Never

- Never performs I/O (no filesystem, network, env or clock access) — pure functions only. Loading and
  env-expanding `config/policy.json` is the caller's job.
- Never imports `@idp/evidence`, `@idp/surface`, `@idp/session`, `@idp/replay-engine`, `@idp/agent` or
  any app. Never depends on `playwright` or `@anthropic-ai/sdk`.
- Never lets an action kind exist without a registry entry, and never lowers a risk (a declared or registry
  risk is a floor).
- Never puts query strings, typed values or control names in a verdict reason.
- Never calls `asMaskedScreenshot` except from the surface masking helper, after masking.
- Never changes a default pattern, mask or term without bumping `REDACTION_RULES_VERSION` (and keeping
  `config/policy.json` in step).

## Allowed dependencies

- `@idp/artifact-schema` only (contracts: `ActionKind`, `RiskClass`, `PolicyConfig`). No third-party
  runtime dependencies.
- Dev tools (`typescript`, `vitest`, `rimraf`, `@types/node`) are `catalog:` devDependencies;
  `@idp/typescript-config` is a `workspace:*` devDependency.

## Enforcement

`pnpm lint` runs ESLint `no-restricted-imports` generated from `tools/repo-checks/layers.json` plus
`pnpm boundaries` (BND001–BND009). Here: BND001 (may depend only on `@idp/artifact-schema`), BND004
(`playwright` belongs to `@idp/surface`), BND005 (`@anthropic-ai/sdk` belongs to `@idp/agent`).

## Layout

```
src/
  index.ts                     barrel (also re-exports ACTION_KINDS, ActionKind, RISK_ORDER, RiskClass, maxRisk)
  actions/actionRegistry.ts    ACTION_REGISTRY, ActionPolicyEntry, PayloadRedaction, isActionKind  (define-action #2)
  risk/classifyRisk.ts         classifyRisk → { risk, reasons }
  config/resolvePolicy.ts      PolicyConfig → ResolvedPolicy (origins normalized, regex/globs precompiled)
  config/ResolvedPolicy.ts     ResolvedPolicy, ControlNameRule, IrreversibleRouteRule
  config/matchRouteGlob.ts     compileRouteGlob (`*` one segment, `**` any segments)
  config/urlParts.ts           internal: http(s) origin + path of a URL
  errors/PolicyConfigError.ts  typed error, codes unexpanded_env_token | invalid_origin | invalid_regex | invalid_route_glob
  intent/ActionIntent.ts       ActionIntent, KnownActionIntent, PolicyActor
  verdict/PolicyVerdict.ts     PolicyVerdict (allow | require_approval | deny), LandingVerdict, DenyCode
  evaluate/                    evaluateAction, evaluateLanding, checkUrl (internal)
  redaction/                   createRedactor, defaultRedactionRules, Redacted, MaskedScreenshot, RedactionConfig
test/fixtures/policyConfig.ts  fixturePolicyConfig() + BANK origin (synthetic, shaped like config/policy.json)
```

Unit tests sit beside the source (`*.test.ts`).

## Exemplars

- **`define-action` touch point 2:** the `click` entry in `src/actions/actionRegistry.ts` (a raisable
  reversible kind) and `fill` (a value-redacted kind); tests in `actionRegistry.test.ts` and
  `risk/classifyRisk.test.ts`.
- **A verdict test:** `src/evaluate/evaluateAction.test.ts` (each deny code, evaluation order, the AC9
  every-actor-same-verdict table).
- **A redaction test:** `src/redaction/createRedactor.test.ts` (nested values, balances masked whole by `money-amount`,
  placeholderize, idempotence).

## Commands

```bash
pnpm --filter @idp/policy build
pnpm --filter @idp/policy typecheck
pnpm --filter @idp/policy test
```

Lint and format are root-only (`pnpm lint`, `pnpm format:check`); there is no per-package lint script.
