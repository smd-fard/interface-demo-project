---
name: write-unit-test
description: Co-locate a Vitest unit test (*.test.ts) next to an existing TS source file, using fakes for ports (Surface, model client, clock, evidence sink) instead of real browsers or LLMs. Use when the user asks to "add a unit test for <file>", "backfill coverage on <X>", or tests are needed after the fact. Args expected -- "<repo-relative path to .ts source>", e.g. "packages/session/src/ControlLease.ts".
---

# write-unit-test

Creates `<File>.test.ts` next to an existing source file and exercises its public surface. For
endpoint-to-endpoint behaviour against a real browser and `mock-bank`, use `write-functional-test` instead.

## Hard rules

- **Vitest only.** Import `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach` from `vitest`.
- **Sibling location.** `ControlLease.ts` → `ControlLease.test.ts`.
- **Fakes at the ports, not mocks of internals.** Use the shared fakes described in
  `references/unit-test-patterns.md` (`FakeSurface`, `ScriptedModel`, `FakeClock`, `MemorySink`) when they
  exist. Only create a local `vi.fn()` stub when no fake fits.
- **Never** a real LLM, real network, or real browser in a unit test. Time goes through a fake clock, never
  a real `setTimeout` wait.
- **Assert on contracts.** Results are asserted by `kind` + `code` on the discriminated union, and schemas are
  validated with the real Zod schema. Don't assert on log strings. Assert on structured log events.
- **Test the invariants the file is responsible for.** For example, a sink test proves redaction happened,
  a replay handler test proves the policy check runs before the surface acts, and a lease test proves an
  illegal transition is rejected.

## Steps

1. Read the source. List its exports, public methods, constructor dependencies (the ports to fake) and
   branches (success, each error/condition class, policy denial, timeout).
2. If it is purely declarative (a type-only file or an enum), stop. There is nothing to unit-test. Schemas are
   the exception: they get parse tests (see `define-schema`).
3. Read `references/unit-test-patterns.md`, plus any existing tests in that directory, and match their style.
4. Write the test. Run `pnpm --filter <pkg> test -- <File>`.
5. If it is red because the **source** is wrong, report the defect to the user and stop. Don't quietly change
   the source, and never weaken the test.
6. Report:
   ```
   Source: <path>
   Test:   <path>
   Cases:  <n> (branches: <list>)
   Defects found: <none | list>
   ```

## Reference

@references/unit-test-patterns.md
