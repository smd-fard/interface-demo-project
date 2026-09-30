# ADR-0003: Capability artifact schema and the locator ladder

| Field          | Value                                                        |
| -------------- | ------------------------------------------------------------ |
| Status         | Accepted                                                     |
| Date           | 2026-09-29                                                   |
| Requirements   | R2.1–R2.7, R3.2, R7.1, R7.2                                  |
| Report section | 2                                                            |
| Spec           | `_design/computer-use-automation-system/spec.md`             |

## Context

The artifact between non-deterministic discovery and LLM-free replay (R3.1) is the product. A human reviewer
and a calling agent must be able to read it (R2.7), and replay must be able to trust it with no judgement of
its own. The target is hostile: framesets, nested
layout tables, no ids or test ids, and inputs labelled by the adjacent table cell. Tenants of the same vendor
app relabel controls (tenant B shows "Account holder ID" / "Find" where tenant A shows "Member #" / "Search").
One selector per element is therefore not enough. Each target needs a ranked set of ways to find it, and the
artifact must record why each one is expected to hold (R2.3).

## Options

### A. Strict, versioned Zod contract with a locator ladder per target, plus reviewed app profiles (chosen)

`CapabilityArtifactSchema` (`packages/artifact-schema/src/artifact/CapabilityArtifact.ts`) is a strict object.
It holds `schemaVersion` `1.0.0`, a capability `version` (semver), a `summary` (`does`/`needs`/`returns`), app
identity with no origin, and `provenance` (run id, compiler version, model id only, `humanStepIds`). It also
holds typed `params`/`outputs`, ordered `steps` over 8 action kinds, a final `successCondition`,
`outcomeRules` and a `contentHash`. The hash is sha256 over the canonical JSON (sorted keys), with the hash
field itself left out. Refinements reject undeclared params, outputs and `{{placeholders}}`, and they check
that every output is extracted exactly once. They also enforce unique step ids, login steps first, and
credential values that reference the artifact's `credentialRef`. `Step.ts` requires a checkpoint on every
screen-changing kind. A sensitive fill cannot hold a literal. Each `TargetRef` holds a frame path (by frame
`name` first) and a **ladder** of 1–5 rungs, each with a required `rationale`:
role+name → label/text → structural anchor (`table_cell_relative`, `form_row`). `nth_in_container` is the
documented brittle last resort. `LadderResolver` (surface) tries the rungs in order. The first rung with
exactly one match wins. It re-resolves a stale frame once. Any rung after the first is reported as `drift`.
`buildLocatorLadder` (agent) builds the ladder from an element fingerprint. It never uses an extracted
value or a param value as locator text.
Per-app condition signatures, origin, login route and credential ref live in reviewed `AppProfile` files
(`config/apps/*.profile.json`). The compiler copies the profile's conditions into `outcomeRules`, so a
reviewer can read the artifact alone. A JSON Schema export (`schemas/*.schema.json`) has a drift test.

- ➕ Semantic rungs survive the relabels and layout changes that break CSS paths. Drift shows up before the
  last rung fails.
- ➕ The rationale per rung, the summary and the hash make the artifact reviewable and tamper-evident.
- ➕ Role/label/text/anchor map to UIA/AX trees, so the core contract is not web-only (R7.1).
- ➖ The schema is large (about 30 exported parts), and hand-editing a fixture needs `fixtures:hash`.
- ➖ The cross-field rules exist only in Zod. The JSON Schema export cannot express them.

### B. A single CSS/XPath selector per step (Playwright codegen style)

- ➕ Tiny schema, familiar tooling.
- ➖ On nested tables with no ids the selector is positional, so one relabel or inserted row breaks it. There
  is no fallback and no drift signal, and it carries no reasoning (R2.3). It is web-only.

### C. A recorded coordinate/screenshot script

- ➕ Works with any pixels, including desktop and Citrix surfaces.
- ➖ It breaks when resolution, zoom, theme or layout changes. It cannot verify semantically, and matching a
  vague position tends to pull a model back into the loop. Screenshots carry PII into the artifact.

Sub-choice: **outcome rules inline only** (each artifact writes its own) versus **profiles**. Inline-only
duplicates the rules across capabilities and lets them diverge. Profile-only makes an artifact depend on
config it does not carry. We keep both: the compiler copies the profile rules, and at run time replay applies
the artifact's rules first, then the profile's `any_step` defaults (`resolveRules.ts`).

## Decision

Option A. It is the only option that fits the hostile markup and still explains itself. Tenant B shows it:
replaying the unchanged `member-lookup` fixture there still succeeds. "Find" defeats the role and text rungs
of `s06-click-search`, which resolves on rung index 2 (`nth_in_container`). "Account holder ID" defeats the
`form_row` rung of `s05-fill-member-id`, which resolves on rung index 1. Both steps are reported as `drift`.
This is shown in `packages/replay-engine/test/functional/replayMemberLookup.test.ts` and
`packages/surface/test/functional/ladder.test.ts`. It is a functional test, not yet a run captured in
`evidence/`.

## Consequences

- **Easier:** reviewing a capability from one file. Detecting tenant or version drift from `drift` entries.
  Adding a surface without changing the contract.
- **Harder:** every contract change needs a `schemaVersion` bump, a CHANGELOG entry, a JSON Schema re-export
  and new fixture hashes. A copied profile rule does not pick up later profile fixes until the artifact is
  recompiled, although the live profile defaults still apply behind it. A last-resort rung can
  "succeed" on the wrong element when a tenant reorders controls. Only the checkpoint catches that. The
  visual-anchor rung and the `extends` base-plus-overrides mechanism are **designed, not built**: `extends`
  is recorded, but no engine reads it.
- **Revisit when:** drift on the last rung becomes routine across tenants (build `extends`/overrides, S5), a
  desktop or Citrix surface has no usable accessibility tree (build the visual rung), or reviewers need
  signed artifacts rather than hashed ones.
