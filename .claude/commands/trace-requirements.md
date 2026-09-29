---
description: Build the requirements coverage matrix (R*/D*/S* → spec → code → tests → evidence) and list the gaps
argument-hint: (none) | <requirement ID prefix, e.g. R3>
allowed-tools: Read, Glob, Grep, Bash(ls:*), Bash(git log:*)
---

# Trace Requirements

The brief wants *"a complete end-to-end vertical slice that touches every core requirement"*. This command
shows how close the repo is to that. It is **read-only** and changes no files.

Filter: $ARGUMENTS

## Steps

1. Load the IDs from `docs/requirements.md` (filtered by the prefix, if one was given).
2. For each ID, find:
    - **Spec**: `_design/*/spec.md` whose Requirements row lists it.
    - **Code**: the package(s) implementing it (from the spec's plan Critical files, confirmed by Glob/Grep
      that the files exist).
    - **Tests**: `*.test.ts` that exercise it. Grep for the concept (condition name, action type, lease
      state), not just the ID.
    - **Evidence**: rows in `evidence/README.md` that cite it.
    - **Report**: whether `REPORT.md` addresses it in the right section.
3. Rate each ID: ✅ covered end to end · 🟡 partial (name the missing column) · ❌ not started ·
   📝 design-only (acceptable **only** for R7.*).
4. Output a table:
   ```
   | ID | Spec | Code | Tests | Evidence | Report | Status |
   ```
   then:
   ```
   Gaps (ordered by evaluation weight — design, core loop, errors, HITL, generalization, safety):
   - <ID>: <what is missing> → suggested next step (/define-spec <slug> | test | /capture-evidence <scenario>)
   ```
   Also flag **scope creep**: code or specs that trace to no ID.
