---
description: Run the real demo scenarios (discovery with a live LLM, replays incl. failure cases, handoff) and store redacted evidence under /evidence
argument-hint: (none — all scenarios) | discovery | replay-ok | replay-not-found | replay-fault <condition> | handoff
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(pnpm:*), Bash(ls:*), Bash(du:*), Bash(git status:*)
---

# Capture Evidence

D3 and R-REAL require **real** evidence: at least one genuine LLM-driven discovery run against a live surface,
plus replay logs, ideally including one replay that hits an error. This command produces those runs. It does
not fabricate or hand-edit evidence, ever.

Scenario(s): $ARGUMENTS

## Preconditions

- The CLI demo path exists: read `README.md` § "Demo path" for the exact commands. If it does not exist yet,
  stop and say which roadmap spec is missing (`cli-demo-path`).
- `pnpm build` passes.
- **Discovery costs money and calls an external API.** Before any `discovery` scenario, confirm with the user:
  the model, the max-steps budget, and that `ANTHROPIC_API_KEY` is set (check only that it is set; never print
  it). Replay scenarios need no key.

## Scenarios (default: all, in this order)

| Scenario             | What it proves                                               | Expected result variant                   |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `discovery`          | R1.*, R2.1, R-REAL: a real LLM run compiles an artifact       | artifact written + run log                |
| `replay-ok`          | R3.1, R3.2: deterministic replay with params returns outputs  | `success`                                 |
| `replay-not-found`   | R3.4: a business outcome is not a crash                       | `business_outcome` (e.g. member_not_found)|
| `replay-fault <c>`   | R3.3: an injected runtime condition (mock-bank fault switch)  | recovered → `success`, or `failure`       |
| `handoff`            | R6.*: pause → human control → recorded actions → resume       | intervention + control-lease log          |

## Steps

1. Start `mock-bank` if the demo path requires it (use the README command). Stop it at the end.
2. For each scenario, run the README command with the documented flags, writing output to
   `evidence/<YYYY-MM-DD>-<scenario>/`. Keep what the system wrote: the run log (JSONL), `result.json`, the
   artifact (discovery), and screenshots / a11y snapshots / trace on failure.
3. **Redaction scan** of every new file: raw credentials, API keys, tokens, full account/card numbers, SSNs,
   emails, and the concrete input values used as params. A hit is a **system bug**. Stop, report the file and
   line, and do not "fix" the evidence by hand. Fix it at the redaction layer, then re-run.
4. Size check: keep `evidence/` reviewable (`du -sh evidence`). Large traces go in `.zip` only if they are
   under ~5 MB each, otherwise keep the screenshot + snapshot.
5. Update `evidence/README.md`: one row per run with the scenario, command, result variant, key files, and the
   requirement IDs it proves.
6. Output:
   ```
   Evidence: <n> runs captured
   <scenario> → <result variant> → evidence/<dir>/
   Redaction scan: clean | <hits>
   Next: /update-report (cite the runs), /commit
   ```
