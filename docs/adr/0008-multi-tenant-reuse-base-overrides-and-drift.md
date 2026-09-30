# ADR-0008: Multi-tenant reuse: per-tenant profiles, base artifact + overrides, drift from rung fallback

| Field          | Value                                             |
| -------------- | ------------------------------------------------- |
| Status         | Accepted                                          |
| Date           | 2026-09-29                                        |
| Requirements   | R7.2, R3.2, R3.4, S5, D2                          |
| Report section | 4                                                 |
| Spec           | `_design/computer-use-automation-system/spec.md`  |

## Context

Many credit unions run the same vendor core (here "CoreOne") with per-tenant configuration: relabelled
fields, a different menu order, a different minor version. R7.2 asks how artifacts are shared or specialised
across such tenants and how per-tenant/version drift is detected. The spec keeps multi-tenant plumbing out of
scope ("design + schema room"; the override mechanism is stretch goal S5). So the v1 decision has two parts:
what ships now, and what the schema must leave room for.

The mock bank has a real tenant variant (`apps/mock-bank/src/tenants/tenants.ts`). Tenant B runs
`CoreOne 7.2` instead of `7.4`, relabels "Member #" to "Account holder ID" and "Search" to "Find", and
reorders the menu.

## Options

### A. One base artifact + per-tenant profiles + a locator ladder that degrades and reports drift; overrides via `extends` (chosen)

- ➕ One reviewed artifact covers every tenant whose differences the ladder can absorb. No copies drift apart.
- ➕ Drift is a signal, not a failure: the run succeeds and says which step fell back.
- ➖ A structural fallback rung is weaker than a role rung. Relying on it for a tenant accepts some
  risk of a wrong match, which the checkpoint must catch.
- ➖ The override mechanism is a second document type with merge rules to design and test.

### B. Fork: one artifact copy per tenant

- ➕ Simplest model. Each copy is exact for its tenant, and every rung can be a strong one.
- ➖ N copies of the same flow. A fix to one (a checkpoint, a new outcome rule) must be carried to all by hand.

### C. One universal artifact with tenant conditionals inside the steps

- ➕ One file, exact per tenant.
- ➖ Turns steps into a branching program. That is harder to review, and harder to prove deterministic.

### D. Always re-discover per tenant

- ➕ No reuse logic at all. Each tenant gets an artifact fitted to it.
- ➖ An LLM run, its cost and a human review per tenant per version, for a flow already known to work.

## Decision

Option A. The part that is **built**:

- **Per-tenant App Profiles.** `config/apps/mock-bank.profile.json` and `mock-bank.tenant-b.profile.json`
  each carry the vendor app, `appVersion`, `variant`, login route, `credentialRef`, condition signatures and
  known dialogs. The replay engine applies the rules in this order: artifact → profile → catalog default. The
  CLI selects a profile with `--profile mock-bank.tenant-b`. Today the two profiles differ only in variant
  and version; tenant B's messages are unchanged, so the signatures are the same.
- **Explicit app identity.** `CapabilityArtifact.app` has `{ vendorApp, variant, appVersion? }` and no origin.
  The compiler stamps it from the profile.
- **Drift from rung fallback.** Each rung above 0 is recorded in `RunResult.success.drift`
  (`{ stepId, rungIndex, rungKind }`) and in the `locator_resolved` log entry. It is proven in
  `packages/replay-engine/test/functional/replayMemberLookup.test.ts`: the tenant-A artifact replays on tenant
  B and succeeds with the right outputs. `drift` holds `s05-fill-member-id` (rung 1, structural) and
  `s06-click-search` (rung 2, structural). The step checkpoints ("Member Inquiry") confirm that the fallback
  hit the right control.

The part that is **designed, not built** (S5):

- **Base + overrides.** A tenant artifact declares the optional `extends: { baseId, baseVersion }`
  (in the schema; no v1 engine reads it) and carries only overrides keyed by step id (a ladder, a checkpoint,
  an outcome rule). A resolver merges them before replay; the merged artifact gets its own `contentHash`.
- **Drift over time.** Aggregate drift across runs per capability × variant: rung-degradation rate, checkpoint
  misses, and the app-version fingerprint against `app.appVersion`. Crossing a threshold opens a re-discovery
  (or a human re-record) for that tenant. The result is an override, not a fork.

## Consequences

- **Easier:** onboarding a tenant with cosmetic differences means writing a profile, not a new artifact.
  Every replay reports its drift, so a label change shows up in the run result before it becomes an outage.
- **Harder:** tenant B passes only because the last-resort structural rungs happen to hold. One field added
  to its form would break `nth_in_container`. Replay does not yet compare `artifact.app.variant` or
  `appVersion` with the selected profile, so a mismatch shows up only as drift or as a failure. Drift is per
  run only: nothing aggregates it, and nothing triggers re-discovery. When S5 is built, override merge rules
  (and how a base bump flows to its overrides) become part of the public schema contract, and every change to
  them bumps `schemaVersion`.
- **Revisit when:** a tenant needs different steps (not only different locators), which suggests a separate
  capability; drift on a tenant stays non-empty across releases (write an override); or the number of tenants
  makes profile-per-tenant files unmanageable (a tenant registry).
