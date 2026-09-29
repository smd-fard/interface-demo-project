---
name: update-docs
description: Refresh a workspace's CLAUDE.md, README.md, and TSDoc on public exports after code changes so docs match the code; also keeps the root CLAUDE.md workspace map and the root README demo path in sync. Use after implementing a feature, when the user asks to "update the docs for <package>", or when implement-plan reaches its docs phase. Args expected -- "<workspace path>", e.g. "packages/replay-engine" (or "root").
---

# update-docs

Docs are part of the graded "communication" criterion, and they are the instructions future Claude sessions
follow. They must describe **the code as it is**, not the plan.

## What each doc is for

| File                   | Audience                  | Contains                                                                                                   |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `<pkg>/CLAUDE.md`      | Claude / contributors     | The rules: purpose + requirement IDs, what it owns, what it must never do, allowed deps, layout, commands, the exemplar files to copy. |
| `<pkg>/README.md`      | Humans / reviewers        | The API: exports, a minimal usage example, and for apps the run commands and config.                       |
| TSDoc on exports       | IDE + JSON Schema readers | One sentence on what it is, plus the non-obvious *why*. Contracts use `.describe()` (it ships in the JSON Schema). |
| root `CLAUDE.md`       | Everyone                  | The workspace map status ("planned" → real), dependency direction, invariants, commands.                   |
| root `README.md`       | Reviewers (D1)            | Setup, keys/config, how to run without live services, and the **exact demo path** commands.                |

## Steps

1. `git diff main...HEAD -- <workspace>` plus a read of the public barrel, to see what changed and what is
   exported.
2. **CLAUDE.md:** update the Owns / Layout / Commands sections and name the exemplar files. Remove
   statements the code no longer supports. Keep it under about 120 lines, and link the root rules instead of
   repeating them.
3. **README.md:** one entry per public export (a signature-level description plus a 3–10 line example for the
   main entry point). Apps: the run command, env vars, ports.
4. **TSDoc:** every exported class, function and type gets a one-sentence summary. Add `@throws` for typed
   errors and `@example` only where usage is non-obvious. Don't restate the type signature in prose.
5. **Root sync** (when `root` is passed, or when a package moved from planned to real): flip its row in the root
   `CLAUDE.md` workspace map, fix the root commands, and make sure the root `README.md` demo path still runs
   (commands copied from the CLI's real `--help`, not from memory).
6. Never document planned behaviour as existing. Label it "planned" and link the spec.
7. Report:
   ```
   Docs: <workspace>
   CLAUDE.md: <sections changed>   README.md: <sections changed>   TSDoc: <n exports documented>
   Root sync: <yes/no — what>
   ```
