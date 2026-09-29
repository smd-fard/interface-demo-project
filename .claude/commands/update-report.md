---
description: Sync /REPORT.md (the 7 required headings, ~1–3 pages) from ADRs, specs, and the current code
argument-hint: (none) | <section number 1-7> to refresh one section
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(wc:*), Bash(ls:*), Bash(git log:*)
---

# Update the Design Write-up (REPORT.md)

`REPORT.md` is a graded deliverable (D2). Reviewers read many submissions side by side, so **the headings are
fixed and exact**:

```
## 1. Architecture
## 2. Artifact schema
## 3. Determinism & error handling
## 4. Heterogeneity & multi-tenant
## 5. Escalation & handoff
## 6. Safety
## 7. Cuts
```

Target: **~1–3 pages (≈ 900–1,800 words)**. Communication is graded: clear reasoning, explicit trade-offs,
explicit cut lines.

## Steps

1. Scope. `$ARGUMENTS` limits the refresh to one section. Otherwise refresh all seven.
2. Sources, in priority order:
    - **The code** as it is today. Never describe something that does not exist as if it does. Planned work is
      labelled "designed, not built".
    - ADRs in `docs/adr/`, grouped by their `Report section` field.
    - Shipped specs (`_design/index.md`, Status `Shipped`/`In progress`) and their Decisions / Out of Scope.
    - `evidence/README.md`, to cite concrete runs ("see `evidence/…/result.json`").
3. Per section, content guide:
    1. **Architecture**: the package diagram (dependency direction), the discover → compile → replay flow,
       the key decisions and their trade-offs (stack, single process, file storage).
    2. **Artifact schema**: a trimmed real example + why each part exists (locator ladder, params/outputs,
       checkpoints, outcome rules, versioning/hash, status).
    3. **Determinism & error handling**: the locator ladder, the wait/checkpoint strategy, the runtime-condition
       taxonomy table (condition → detector → class → response), the result contract; UI drift secondary.
    4. **Heterogeneity & multi-tenant**: the `Surface` seam (legacy web, desktop via UIA/AX), base artifact +
       tenant overrides, drift detection (locator-rung degradation, checkpoint misses, version fingerprint).
    5. **Escalation & handoff**: stuck detection, the intervention request, the control-lease state machine,
       same-session takeover, human-action capture, resume; what is mocked and the full design.
    6. **Safety**: allowlist, risk classes and the conservative choice + why, redaction points, **limits**.
    7. **Cuts**: what was left out and why, what comes next (ordered). Pull this from every spec's Out of Scope.
4. Style: short paragraphs, tables over prose where the content is tabular, at most one diagram per section.
   Link ADRs (`docs/adr/NNNN-…`) for depth instead of expanding in place.
5. Check: exactly the seven headings in order (`grep -n '^## ' REPORT.md`), and the word count (`wc -w`).
   If it is over about 1,800 words, cut and link ADRs instead.
6. Output:
   ```
   REPORT.md: sections refreshed <list> · <words> words
   Unbacked claims: <anything the report states that code/evidence does not yet support — must be empty before submission>
   ```
