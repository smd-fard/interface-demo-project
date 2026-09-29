---
name: define-mock-screen
description: Add a screen, flow step, fault switch, or tenant-variant override to apps/mock-bank — the deliberately hostile legacy core-banking proxy target (framesets/iframes, nested tables, no test IDs, non-semantic markup) with synthetic data only. Use when a plan needs a new page in the target app (login, member search, member detail, open sub-account, confirmation, error pages, dialogs) or a tenant-B variant. Args expected -- "<screen-name> <short description>", e.g. "member-detail shows balances in a nested table inside the content frame".
---

# define-mock-screen

`apps/mock-bank` stands in for a real legacy bank back-office app. It exists to make the **interesting
problems** real: no clean DOM, runtime errors, a risky irreversible action, and a second tenant running the
same "vendor product". It is **not** part of the system: nothing in `packages/*` imports it, and it imports
nothing from them.

> The `apps/mock-bank/CLAUDE.md` is the authority on routing, templates, fault switches and the tenant config.
> The first screen that lands (the `mock-bank-target` spec) is the exemplar.

## Legacy-realism rules (what makes it a fair test)

- **Server-rendered HTML** only. No SPA framework, no client-side routing. Minimal inline JS is allowed only
  where legacy apps typically have it (`window.confirm`, `alert`, a popup window, `onclick` handlers).
- **Hostile structure:** a frameset or iframes (nav frame + content frame), layout tables nested 3+ deep,
  generic `name`s (`txt1`, `btnGo`), **no `id`s meant for automation, no `data-testid`, no ARIA landmarks**.
  Labels sit in adjacent table cells, not in `<label for>`.
- **Keep what a human sees stable.** Visible text, the order of controls, and page titles are the stable
  surface, just as in a real vendor app. That is what the locator ladder should prefer. Avoid randomizing
  what a human sees. You **may** randomize incidental DOM (wrapper depth, generated class names) behind a
  flag, to prove locators don't depend on it.
- **Synthetic data only.** Fixture members and accounts are obviously fake (e.g. member `12345`, "Jane Sample").
  Include fields that *look* sensitive (a masked SSN, full account numbers) so redaction has something real to
  catch.
- **Sessions:** a cookie session with a configurable idle timeout, so `session_timeout` is reproducible.
- **Risky action:** at least one irreversible action (e.g. "Open sub-account" → confirmation) that the
  policy must gate.
- **Fault switches:** deterministic and documented in the mock-bank README (condition code → how to trigger).
  They are enabled only by explicit request (query/header/admin toggle), never at random.
- **Tenant variant:** tenant B is the *same app* with different branding, some relabelled fields (e.g.
  "Member #" vs "Account holder ID"), a reordered menu, and a different version string, selected by
  config/port. It is not a copy of the code.

## Steps

1. Read `apps/mock-bank/CLAUDE.md` and an existing screen.
2. **Test first:** a functional test (plain HTTP + HTML assertions, or Playwright if interaction matters) that
   the screen renders, the flow transition works, and each fault switch produces its condition. For a variant,
   test that the same flow works with tenant-B labels.
3. Implement the route + template + fixture data, and register fault switches.
4. Update the mock-bank README: the screen list, flows, fault switch table, and tenant differences.
5. `pnpm --filter @idp/mock-bank build && pnpm --filter @idp/mock-bank test`.
6. Report:
   ```
   Screen:  <name> → <route>   (frames: <yes/no>, test IDs: none)
   Flow:    <prev> → <this> → <next>
   Faults:  <codes + triggers>
   Variant: <tenant-B differences | n/a>
   Tests:   <files>
   ```
