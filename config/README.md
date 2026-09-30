# config/

Runtime configuration read by the CLI (`apps/cli/src/config/loadConfig.ts`). Everything here is data. No
secrets live in this directory: credentials are referenced by name and resolved from `.env` at run time.

| File | Contract | Controls |
| --- | --- | --- |
| `policy.json` | `PolicyConfig` (`@idp/artifact-schema`) | The allowlist (origins, routes, action types), irreversible-action rules (control-name patterns and routes that raise a step to `irreversible`, which then needs human approval), redaction patterns (`ssn`, `account-number`, `member-number`, `money-amount`; kept in step with `DEFAULT_REDACTION_CONFIG`, rules version 1.1.0) and synthetic name terms, and the approval expiry. |
| `apps/mock-bank.profile.json` | `AppProfile` | Tenant A of the CoreOne mock app: sign-on route, credential reference `mockbank-operator`, the default runtime-condition signatures (business outcomes, recoverables, failures), and the known dialogs replay may handle. |
| `apps/mock-bank.tenant-b.profile.json` | `AppProfile` | Tenant B (CoreOne 7.2): the same vendor app with relabelled fields. This is the R7.2 per-tenant specialisation, done at the profile level. |

## Environment expansion

`${MOCKBANK_ORIGIN}` is expanded by the loader before the policy is resolved (for example
`http://127.0.0.1:4010`). An unexpanded `${…}` token is a configuration error. The policy package never reads
the environment itself.

## Precedence

Condition rules resolve in this order: the artifact's own `outcomeRules`, then the app profile's
`conditions`, then the replay engine's built-in catalog defaults. The admin routes of mock-bank
(`/__admin/**`, `/__health`) are excluded from the allowlist, so neither the agent, replay nor a human
operator can reach them through a surface.
