# ADR-0007: Surface abstraction, accessibility tree first

| Field          | Value                                             |
| -------------- | ------------------------------------------------- |
| Status         | Accepted                                          |
| Date           | 2026-09-29                                        |
| Requirements   | R1.3, R7.1, R2.3, R3.2, R5.2                      |
| Report section | 4                                                 |
| Spec           | `_design/computer-use-automation-system/spec.md`  |

## Context

The targets are legacy bank back-office apps with no API. They use framesets, nested layout tables and no
test IDs, and some are not web apps at all (Win32/Java desktop clients, terminal screens). The brief asks for
mechanisms that work "without a clean DOM" (R1.3). It also asks for a design that extends to legacy web and
desktop (R7.1). The same perception feeds three consumers: the LLM that discovers a flow, the compiler that
turns it into a locator ladder (R2.3), and the replay engine, which must resolve targets deterministically
with no model (R3.2). If a browser API leaks into those consumers, a second surface means rewriting all three.

## Options

### A. A `Surface` port with the frame-aware accessibility tree as primary perception

- ➕ Role and accessible name are semantic and stable across restyling, and they turn directly into the
  `role` rung of a ladder. Replay is deterministic (a strict "exactly one match" per rung).
- ➕ The model gets compact, redactable text instead of pixels. That costs fewer tokens, and the text passes
  through the redactor before it reaches the prompt.
- ➕ Desktop accessibility APIs (Windows UIA, macOS AX) expose the same role/name/value tree, so the port
  carries over to them.
- ➖ The legacy markup has weak semantics. Layout-table cells and unlabelled inputs need structural rungs.
  Anything drawn on a canvas or as an image is invisible to it.

### B. Screenshot + coordinates (vision-first computer use) as primary perception

- ➕ Works on any surface that renders pixels, including terminals and apps with no accessibility tree.
- ➖ It yields no semantic locator to compile, and a coordinate click is not a stable target. It breaks on
  resolution, DPI, theme or layout changes, so replay would need a model or brittle image matching.
- ➖ It costs more tokens per step, and masking PII in an image is harder to prove than redacting text.

### C. Raw DOM/CSS selectors, with Playwright used directly across packages

- ➕ Fastest to build, and the Playwright API is familiar.
- ➖ Selectors like `td > table > tr:nth-child(3)` break on legacy markup changes. They mean nothing on a
  desktop surface. Every package gets tied to one browser driver, so R7.1 would require a rewrite.

## Decision

Option A. All interaction goes through the `Surface` port (`packages/surface/src/port/Surface.ts`):
`observe`, `resolve`, `act`, `check`, `describe` and `captureEvidence`, plus `location`, `pendingDialog` and
`close`. The port uses plain data types only; no Playwright type crosses the barrel, and `BrowserHandle` is
opaque. The deciding reason is that only a semantic tree gives both the model and the deterministic replay
the same stable targets, and only a port keeps that true for a second surface.

What the code does:

- **Perception.** `WebSurface.observe` walks every frame (`captureFrames.ts`). It takes each document's own
  `ariaSnapshot()`, because Playwright snapshots one document at a time. The pure `buildA11yTree`
  (`snapshot/a11ySnapshot.ts`) grafts each frame's tree under its `iframe` node by frame path and assigns refs
  `e<N>`, which stay valid until the next observe. Each frame also reports its title, status and bounded
  visible text for condition detection.
- **Screenshots are for evidence and humans only.** `captureEvidence` returns a masked screenshot and a
  redacted tree. The agent's prompt gets the redacted text observation (`formatObservation`), never an image.
- **Portable signals.** Ladder rungs are `role`, `label`, `text` and `structural`, and frame scopes name
  frames by name, URL path or title. Condition signatures use visible text, title, route, dialog text and load
  status, never selectors. A CSS selector survives only as `surface.web.cssHint`, which is diagnostic and which
  `rungToLocator` never uses (a unit test checks this).
- **Enforcement.** Only `@idp/surface` may depend on Playwright (`tools/repo-checks/layers.json` `owners`,
  BND004, plus ESLint).

A desktop adapter (UIA/AX), a terminal/3270 adapter and a visual-anchor rung are **designed, not built**.

## Consequences

- **Easier:** adding a surface means one new adapter. Artifacts, policy, replay and the agent stay unchanged.
  Unit tests use `FakeSurface` without a browser. Ladders are readable and reviewable.
- **Harder:** frame merging is our code, not Playwright's, so it depends on the snapshot format. We parse the
  YAML-like text, and that format has changed across Playwright versions. Legacy pages with poor semantics
  lean on structural rungs, which are more brittle (`nth_in_container` is marked last-resort and reports
  drift). Every port method must be expressible without a DOM, which rules out convenient web-only shortcuts.
  Canvas- or image-rendered controls are unreachable until a visual rung exists.
- **Revisit when:** a target exposes no usable accessibility tree (a canvas UI or a terminal emulator), which
  makes the visual-anchor rung necessary. Also revisit if the first desktop adapter needs a port method that
  cannot be defined without web concepts, or if a Playwright release ships a native frame-aware snapshot that
  replaces our merge.
