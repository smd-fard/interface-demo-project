---
description: Create a commit message by analyzing staged changes (test-gated)
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git commit:*), Bash(git log:*), Bash(pnpm test:*), Bash(pnpm build:*), Bash(test:*)
---

## Context

- Current git status: !`git status`
- Staged diff: !`git diff --staged`

## Pre-commit gates (required)

1. **Test gate.** If a root `package.json` exists, run `pnpm build && pnpm test`. If anything fails, **stop**:
   list every failed test (file + name) with the relevant output and tell the user the commit is blocked.
   Before `monorepo-foundation` lands there is no `package.json`. Say "test gate skipped: no workspace yet"
   and continue.
2. **Secret/PII gate.** Scan the staged diff for: `.env` files, API keys (`sk-ant-`, `sk-`, `ghp_`,
   `AKIA`), bearer tokens, passwords, and unredacted PII-looking values (full SSNs, 13–19 digit card or
   account numbers) in `evidence/` or artifacts. If you find any, **stop** and show the exact lines.

## Commit types

Only these: ✨ `feat:` · 🐛 `fix:` · 🔨 `refactor:` · 📝 `docs:` · 🎨 `style:` · ✅ `test:` · ⚡ `perf:`
(Spec/plan/design/ADR-only changes are `docs:`.)

## Format

```
<type>: <concise description, present tense>

<optional body: WHY this change, not just what>
```

## Output

1. The gate results.
2. A summary of the staged changes.
3. The proposed message.
4. Ask for confirmation. **Do not commit until the user approves.**
