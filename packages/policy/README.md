# @idp/policy

The guardrails as pure functions: the action registry and risk classes, the allowlist evaluation every action
passes before the surface acts (invariant 2), and the redactor every sink's data passes through (invariant 3).
No I/O.

## Usage

```ts
import { createRedactor, evaluateAction, evaluateLanding, resolvePolicy } from '@idp/policy';

const policy = resolvePolicy(parsedAndEnvExpandedPolicyConfig); // throws PolicyConfigError
const verdict = evaluateAction(
	{ actor: 'replay', kind: 'click', currentUrl: page.url, targetName: 'Confirm', stepId: 's7' },
	policy,
);
if (verdict.kind === 'deny') throw new Error(verdict.code); // origin_not_allowed | route_not_allowed | …
if (verdict.kind === 'require_approval') await raiseIntervention(verdict.reason); // irreversible
// …act, then: evaluateLanding(page.url, policy) must be { kind: 'allow' }

const redactor = createRedactor({ config: policy, sensitiveValues: [{ value: '12345', paramName: 'memberId' }] });
redactor.redact({ note: 'member 12345 has 1523.47' }); // { note: 'member [REDACTED] has [REDACTED]' }
redactor.placeholderize('search 12345'); // 'search {{memberId}}' — for LLM observations
```

## Exports

### Action registry and risk

| Export                                           | What it is                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTION_REGISTRY`                                | Frozen `Record<ActionKind, ActionPolicyEntry>`, one entry per action kind. `navigate`, `extract`, `wait`: `read`. `click`, `fill`, `select`, `press`, `dismiss_dialog`: `reversible`. |
| `ActionPolicyEntry`                              | `{ risk, allowlistKey, raisableByTarget, payloadRedaction, rationale }`. `click`, `press` and `dismiss_dialog` can be raised by their target.                                       |
| `PayloadRedaction`                               | `'none' \| 'value'` (typed value, e.g. `fill`) `\| 'extracted'` (per the output's `sensitive` flag).                                                                            |
| `isActionKind(value)`                            | Type guard: whether a string (e.g. a model tool name) is a registered kind. Prototype keys are rejected.                                                                          |
| `classifyRisk(intent, policy)`                   | `{ risk, reasons }`: the max of registry risk, `declaredRisk`, irreversible control-name patterns (raisable kinds) and irreversible routes — for screen-changing kinds the navigate target or current page, **and the `destinationUrl` of a click/press** (link href / form action). Never lowers. |
| `RiskClassification`                             | `{ risk: RiskClass; reasons: readonly string[] }` (rule sources and globs, never values).                                                                                       |
| `ACTION_KINDS`, `ActionKind`, `RISK_ORDER`, `RiskClass`, `maxRisk` | Re-exported from `@idp/artifact-schema`.                                                                                                                         |

### Config

| Export                                          | What it is                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolvePolicy(config)`                         | Compiles a parsed, env-expanded `PolicyConfig` into a frozen `ResolvedPolicy`. Throws `PolicyConfigError`.                                       |
| `ResolvedPolicy`                                | `{ version, origins, actions, irreversibleControlNames, irreversibleRoutes, redaction, approvalExpiresMs, isRouteAllowed(origin, path) }`. No route rule for an origin = denied; excludes win. |
| `ControlNameRule`, `IrreversibleRouteRule`      | Compiled irreversible rules (`{ source, regex }` case-insensitive; `{ glob, matches }`).                                                          |
| `compileRouteGlob(glob)` / `RouteMatcher`       | `*` matches within one segment, `**` across segments (`/member/**` also matches `/member`). Throws `PolicyConfigError` (`invalid_route_glob`).    |
| `PolicyConfigError` / `PolicyConfigErrorCode`   | Typed error with `code`: `unexpanded_env_token \| invalid_origin \| invalid_regex \| invalid_route_glob`.                                         |

### Evaluation

| Export                                                                              | What it is                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `evaluateAction(intent, policy)`                                                    | `PolicyVerdict`. Order: unknown kind → action allowlist → origin → route (of `targetUrl` resolved against `currentUrl`, else `currentUrl`) → risk. Pure, never throws, actor-independent (AC9). |
| `evaluateLanding(landingUrl, policy)`                                               | `LandingVerdict`: the URL the top document landed on after acting must still be on an allowed origin and route.                                                   |
| `ActionIntent`, `KnownActionIntent`, `PolicyActor`                                  | `{ actor: 'agent' \| 'replay' \| 'human', kind, currentUrl, targetUrl?, destinationUrl?, targetName?, declaredRisk?, stepId? }`. `kind` is a plain string.      |
| `PolicyVerdict`, `AllowVerdict`, `RequireApprovalVerdict`, `DenyVerdict`, `DenyCode`, `LandingVerdict` | `allow` (risk) \| `require_approval` (irreversible, reason) \| `deny` (`origin_not_allowed \| route_not_allowed \| action_not_allowed \| unknown_action`, reason). Reasons carry no query strings, values or control names. |

### Redaction

| Export                                   | What it is                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRedactor({ config?, sensitiveValues })` | Returns a `Redactor`. Masks, in order: exact known values (longest first; a value with a digit edge matches only at a digit boundary, so `12345` is not masked inside `8800123450`) → config patterns → config terms (case-insensitive, any whitespace). Values shorter than 2 characters are ignored. Idempotent (runs to a fixpoint). `config` may be a `PolicyConfig`, a `ResolvedPolicy` or `{ redaction }`; omitted = defaults. |
| `Redactor`                               | `redact(value)` (deep copy: strings, numbers, arrays, Maps, Sets, Errors; keys kept; binary → mask; cycles → `[Circular]`), `redactString(text)`, `placeholderize(value)` (known param values → `{{paramName}}`, the rest masked; for LLM prompts), `addSensitiveValue(value)`. |
| `CreateRedactorOptions`, `SensitiveValueInput` | A sensitive value is a string, a number or `{ value, paramName? }`.                                                                                                                                                      |
| `FULL_MASK`                              | `'[REDACTED]'`. `keep_last_4` / `keep_last_2` masks render as `[•••6789]` / `[•••45]`.                                                                                                                                       |
| `DEFAULT_REDACTION_CONFIG`               | Patterns `ssn` (full), `account-number` (10 digits, keep last 4), `member-number` (5 digits, keep last 2) — number patterns never match inside a decimal amount such as `12,345.67` — `money-amount` (full; since 1.1.0: exactly 2 decimals, optional thousands separators and leading `-`/`$`, e.g. `842.10`, `1,523.47`, `$10,250.00`, `-3.00`; never versions, IPs/ports, integers, timestamps or hex), and the synthetic names as terms.       |
| `REDACTION_RULES_VERSION`                | `'1.2.0'` (1.1.0 added `money-amount`; 1.2.0 exempts hex digests — `sha256:<8+ hex>`, standalone 32+ hex runs — and URL authorities (scheme, host, port) from patterns and terms, and matches name-like known values case-insensitively at word boundaries); bumped whenever a default pattern, mask or term changes; recorded in each run manifest.                                                                                                                              |
| `RedactionConfig`                        | `PolicyConfig['redaction']`.                                                                                                                                                                                                       |
| `Redacted<T>`                            | Compile-time brand produced only by the redactor; the `@idp/evidence` sinks accept only this type.                                                                                                                              |
| `MaskedScreenshot`, `asMaskedScreenshot(bytes)` | Brand for screenshot bytes with every sensitive region masked; the evidence store accepts only this type. Call `asMaskedScreenshot` only after masking (the surface masking helper).                                   |
