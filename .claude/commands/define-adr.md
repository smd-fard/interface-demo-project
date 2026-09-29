---
description: Record an architecture decision (ADR) under docs/adr/ — for any choice you must defend in review
argument-hint: Short decision title, e.g. "accessibility tree as primary perception"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git branch:*), Bash(ls:*)
---

# Record an Architecture Decision

The brief says: *"be ready to defend every decision"*. An ADR is the defence, written down. REPORT.md cites
ADRs instead of repeating them.

Decision: $ARGUMENTS

## Steps

1. **Number.** `ls docs/adr/` → next `NNNN` (4 digits, zero-padded). Slug = kebab-case title, ≤ 50 chars.
2. **Deduplicate.** Grep `docs/adr/` for the topic. If an accepted ADR already covers it, propose superseding
   it (new ADR, status `Accepted`, `Supersedes: NNNN`; the old one becomes `Superseded by NNNN`) instead of
   writing a duplicate.
3. **Context.** Read the current feature's `spec.md` (from the branch), and `docs/requirements.md` for the IDs
   the decision serves.
4. **Options.** At least **two real alternatives**, each with honest pros and cons. A strawman alternative is
   worse than none. If the choice is not already made, ask the user and recommend one. Do not decide it
   yourself if it changes the product.
5. **Write** `docs/adr/NNNN-<slug>.md` from `docs/adr/0000-template.md`. Keep it to about one page.
   "Consequences" must include what gets **harder** because of the choice.
6. **Link.**
    - Add a row to the table in `docs/adr/README.md`.
    - Add the link under the current spec's **Decisions** section, if there is a spec.
    - Put the REPORT.md section it feeds (1–7) in the ADR's `Report section` field. `/update-report` uses it.
7. **Output:**
   ```
   ADR: docs/adr/NNNN-<slug>.md
   Status: <Proposed | Accepted>
   Feeds: REPORT §<n>
   ```
