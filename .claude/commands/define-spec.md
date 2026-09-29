---
description: Create a feature spec file and branch from a short idea (or a roadmap slug)
argument-hint: Short feature description | roadmap slug (e.g. deterministic-replay)
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git status:*), Bash(git branch:*), Bash(git switch:*), Bash(git remote:*), Bash(git fetch:*), Bash(git pull:*), Bash(mkdir:*)
---

# Draft a Feature Specification

Turn the idea below into a feature branch and a spec that `/define-plan` can use directly. Follow every
rule in the CLAUDE.md files, and especially the **Hard invariants**.

User input: $ARGUMENTS

## Step 1. Preconditions

- `git status --porcelain` must be empty. If it is not, tell the user to commit or stash first, and **stop**.
- Note the current branch.

## Step 2. Resolve the feature

- If `$ARGUMENTS` matches a slug in `_design/roadmap.md`, use that row: its slug, what it delivers, and its
  requirement IDs are the starting point.
- Otherwise derive:
    - `feature_title`: Title Case.
    - `feature_slug`: lowercase kebab-case, only `a-z0-9-`, dashes collapsed and trimmed, ≤ 40 chars.
    - `branch_name`: `feature/<feature_slug>`.
- If no sensible title or slug can be inferred, ask the user. Do not guess.
- If `_design/<feature_slug>/spec.md` already exists, stop and point the user at it.

## Step 3. Branch

- **On `main`:** if `git remote` lists `origin`, run `git fetch origin` then `git pull --ff-only`, and abort
  if main has diverged. With no remote, skip both. Then `git switch -c <branch_name>`. Never push the new
  branch; the user pushes.
- **Not on `main`:** ask exactly:
  > You are on `<current_branch>`. Create `<branch_name>` from it (not from `main`)?

  On yes, branch from here. On no, stop and tell the user to `git switch main`.
- If the branch name is taken, append `-01`, `-02`, … and retry.

## Step 4. Ground the spec

Read, only as much as needed:

1. `docs/requirements.md`. Pick the requirement IDs this feature satisfies. **Every functional requirement
   must trace to at least one ID.** Anything that traces to none is scope creep: cut it, or list it under
   Out of Scope.
2. `_design/roadmap.md` and `_design/index.md`, to see what already exists and what this spec may assume.
3. The root `CLAUDE.md` (workspace map, dependency direction, invariants) and the `CLAUDE.md` of any package
   the feature touches.
4. The existing code in the affected packages. Describe today from the repo, not from the roadmap.

## Step 5. Ask before writing

Ask the user, in one batch (use AskUserQuestion when there are options):

- **PoC** — who owns the change (suggest the git user name).
- Every decision the idea leaves open that changes the spec, for example the risk-class treatment, a
  locator strategy, or which runtime conditions are business outcomes and which are failures. Offer a
  recommended option first. Do not ask about anything that has a conventional default. Decide those
  yourself and record them under **Decisions**.

## Step 6. Write the spec

- `mkdir -p _design/<feature_slug>` then write `_design/<feature_slug>/spec.md` using the exact structure of
  `_design/template.md`. Fill every metadata row. `Contract impact` and `Safety impact` are mandatory,
  even when the answer is "None".
- Describe behaviour, not implementation: no code, no file-by-file detail (that belongs to the plan).
- Acceptance criteria are Given/When/Then and each is verifiable by a test or an evidence file.
- If the spec touches the artifact schema, the result contract, the policy model, or the control-transfer
  model, list the decision under **Decisions** and suggest `/define-adr`.
- Check the spec against the Hard invariants. If the idea conflicts with one, say so in Open Questions.
  Do not silently bend the invariant.

## Step 7. Index

Append a row to `_design/index.md`: next `#`, today's date, `feature_slug`, requirement IDs,
`[spec](./<feature_slug>/spec.md)`, empty Design and Plan cells, Status `Draft`, a very short Summary, and the PoC.

## Step 8. Output

Respond with exactly:

```
Branch: <branch_name>
Spec file: _design/<feature_slug>/spec.md
Requirements: <IDs>
Title: <feature_title>
Next: /define-design (HLD), then /define-plan
```

Do not repeat the spec in chat unless asked.
