---
description: Write the one-screen Before→After design README for the current feature (HLD after /define-spec, LLD after /define-plan)
argument-hint: (none — reads slug from branch) | <feature-slug> | hld | lld
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git branch:*), Bash(wc:*)
---

# Write the Feature Design README

Ultrathink, then produce `_design/<feature_slug>/README.md`: a **one-screen** visual summary of what this
change does to the system. `spec.md` says *what and why*, `plan.md` says *how, file by file*. The README
exists so that a reader, including an interviewer, understands the change in under a minute.

This command runs twice per feature:

- **HLD pass**, right after `/define-spec`. Writes everything except `## Low Level Design`.
- **LLD pass**, right after `/define-plan`. Appends `## Low Level Design` and refreshes the metadata line and
  `## Impact`. Nothing else may change: use `Edit`, not `Write`.

## Step 1. Resolve the slug

`git branch --show-current` → strip the `feature/` prefix. `$ARGUMENTS` can override it with a bare slug,
and the tokens `hld`/`lld` force the pass. On `main` with no slug, list `_design/*/spec.md` and ask. If
there is no spec, stop with: "No spec at `_design/<slug>/spec.md` — run `/define-spec` first."

## Step 2. Decide the pass

| `plan.md` | `README.md` | Pass                                              |
| --------- | ----------- | ------------------------------------------------- |
| missing   | missing     | HLD                                               |
| missing   | exists      | HLD — ask before overwriting                      |
| exists    | missing     | HLD + LLD in one go                               |
| exists    | exists      | LLD — additive edit only                          |

## Step 3. Gather context

1. `_design/readme_template.md`: the required structure. Do not rename, reorder, or invent sections.
2. `spec.md` (and `plan.md` on the LLD pass: Approach, Critical files, Risks).
3. The root `CLAUDE.md`, so nodes use the real workspace names (`apps/cli`, `replay-engine`, `surface`, `session`,
   `policy`, `evidence`, `agent`, `apps/operator`, `apps/mock-bank`, `artifact-schema`).
4. **The current code** the change touches. The *Before* diagram comes from the repo, not from prose. Before
   `monorepo-foundation` lands, *Before* may honestly be "nothing".

## Step 4. Ultrathink, then draft

Decide, in order: **the delta** (one sentence: what exists after that did not before), **the axes** (2–4 of
`Contract`, `Execution`, `Perception`, `Safety`, `Control`, `Evidence`, `Target`, `Tooling`; only axes that
move), **the frame** (draw *Before*, copy it, mutate it into *After*, so the eye lands on the difference),
and **what to leave out** (deferred scope is one Impact bullet).

Hard cap: **≤ 80 lines**. Why ≤ 3 sentences · table 2–4 rows · each diagram ≤ 12 nodes · HLD 3–6 bullets ·
LLD 4–8 bullets and ≤ 1 diagram · Impact exactly 3 bullets. Bullets are `**<subject>** — <one sentence.>`.

### Mermaid rules

- `flowchart LR` for both state diagrams, in the same direction. Short alphanumeric ids; never `end`,
  `graph`, `class` or `style` as an id.
- **Always quote labels**: `R["replay-engine"]`.
- Shapes: `[" "]` package/app, `[(" ")]` file store, `{" "}` decision, `(" ")` actor (agent, operator).
- Style the delta only in *After*, with `:::new` / `:::changed` / `:::removed` and the three `classDef` lines
  copied from the template.
- LLD diagram: one `sequenceDiagram` (a run or handoff flow) **or** one `stateDiagram-v2` (control lease,
  run lifecycle). Omit it if the HLD already shows the shape.
- No HTML, `<br>`, markdown or emoji in labels. Never put `<angle-bracket>` placeholders in a diagram; use `{braces}`.

## Step 5. Write + check

Write from the template. On the HLD pass, delete the LLD heading entirely. Status is `Draft` on HLD and
`Planned` on LLD. Drop the plan link until `plan.md` exists. Run `wc -l`. If the file is over 80 lines, cut
(table rows → HLD bullets → LLD bullets → diagram nodes) and re-check.

## Step 6. Index + output

Set the `Design` cell in `_design/index.md` to `[design](./<slug>/README.md)`. Respond with exactly:

```
Design file: _design/<slug>/README.md
Pass: <HLD | LLD | HLD+LLD>
Lines: <n>/80
Diagrams: <list>
```
