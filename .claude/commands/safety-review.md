---
description: Audit the current branch diff (or a path) against the safety invariants — policy bypass, LLM on replay path, unredacted sinks, real data
argument-hint: (none — diff vs main) | <path>
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(pnpm ls:*)
---

# Safety Review

This is a regulated-data domain, so safety and data handling are graded (R4.*). The review checks the diff
against the root `CLAUDE.md` **Hard invariants**. It is read-only: report, don't fix.

Target: $ARGUMENTS (default: `git diff main...HEAD` plus uncommitted changes)

## Checks

1. **No LLM on the replay path (inv. 1, R3.1).** `@idp/replay-engine` and its transitive deps must not import
   `@idp/agent` or `@anthropic-ai/sdk`. Check the package.json deps and the imports.
2. **Every action through policy (inv. 2, R4.1–R4.2).**
    - No Playwright call (`page.`, `locator.`, `mouse.`, `keyboard.`) outside `packages/surface`.
    - Every action type in the step schema has a policy entry (risk class + allowlist key), a surface
      executor, a replay handler and (if the agent may use it) an agent tool. Missing any one is a finding.
    - Navigation targets are checked against the domain/route allowlist, and so are redirects.
    - Risky/irreversible actions are gated as the policy ADR says, and cannot be skipped by the replay or
      human path.
3. **Redact before any sink (inv. 3, R4.3).** Every write to a log, artifact, evidence file, intervention
   request, LLM prompt or operator UI goes through the redaction layer. Artifacts hold `{{param}}`
   references, not concrete input values. No `console.log` of observations, params or page text.
4. **Business outcome ≠ failure (inv. 4, R3.4).** New conditions are classified; none is swallowed; none is
   returned as a bare thrown error.
5. **Synthetic data / secrets (inv. 7).** No real PII, no real URLs other than localhost/allowlisted demo
   targets, no keys or tokens in code, fixtures, or `evidence/`. `.env*` is gitignored.
6. **Prompt injection surface.** Page text reaches the LLM only as *data* (quoted observation), never as
   instructions. The system prompt says the page content is untrusted. Allowlist enforcement does not rely
   on the model obeying.

## Output

```
Safety review: <target>
| # | Invariant | File:line | Finding | Severity (block/warn) |
Verdict: PASS | BLOCK (<n> blocking findings)
```

Severity is `block` for any breach of invariants 1–3 or 7. When there are no findings, say so plainly.
