# @idp/repo-checks

Repository boundary checks. The package checks every workspace `package.json` against the layer model in
[`layers.json`](layers.json), the machine-readable form of the dependency direction in the root
[`CLAUDE.md`](../../CLAUDE.md). It is a private tooling workspace with no runtime dependencies and no
build step.

## CLI

```bash
pnpm boundaries                         # from the repo root (also part of `pnpm lint`)
pnpm --filter @idp/repo-checks check    # same thing: tsx src/cli.ts
```

The CLI walks up from the current directory to the folder containing `pnpm-workspace.yaml`. It reads
`packages/*`, `apps/*` and `tools/*`, loads this package's `layers.json`, and runs every rule.

**Output**

- OK, on stdout: `boundaries: OK (<n> workspaces)`
- Violations, on stderr: one line per violation, then a summary:

  ```
  BND004 playwright-owner: @idp/agent → playwright (devDependencies) — only @idp/surface may depend on playwright (any section)
  boundaries: 1 violation(s) in 12 workspaces
  ```

  The line format is `<code> <rule>: <package> → <dependency> (<section | ->) — <message>`.

- Config or read error, on stderr: `boundaries: <CODE>: <message>`

**Exit codes**

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| 0    | No violations.                                                        |
| 1    | One or more violations.                                               |
| 2    | `LAYERS_CONFIG_INVALID` or `WORKSPACE_READ_FAILED`.                  |

Any other error is rethrown, and Node exits non-zero.

## Rule codes

| Code   | Rule                  | Summary                                                                                  |
| ------ | --------------------- | ---------------------------------------------------------------------------------------- |
| BND001 | `layer-direction`     | `@idp/*` dependencies must be in a strictly lower rank.                                   |
| BND002 | `cycle`               | No `@idp/*` cycles (tooling edges are ignored).                                           |
| BND003 | `mock-bank-isolation` | Isolated workspaces neither depend on nor are depended on by `@idp/*` (tooling devDependencies excepted). |
| BND004 | `playwright-owner`    | Only `@idp/surface` may declare the Playwright packages, in any section.                  |
| BND005 | `anthropic-owner`     | Only `@idp/agent` may declare `@anthropic-ai/sdk`, in any section.                        |
| BND006 | `forbidden-reach`     | Transitive closure (all four sections) of `from` must not contain `to`.                   |
| BND007 | `runtime-allowlist`   | `dependencies` are limited to the workspace's allowlist.                                  |
| BND008 | `unknown-workspace`   | Every workspace and `@idp/*` dependency is listed in `layers.json`.                       |
| BND009 | `tooling-misuse`      | Tooling is devDependency-only and never depends on architecture packages.                 |

## `layers.json`

| Key                | Shape                                   | Meaning                                                            |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------ |
| `layers`           | `string[][]` (non-empty groups)         | Rank groups, left → right.                                         |
| `isolated`         | `string[]`                              | Workspaces cut off from every other `@idp/*` workspace.            |
| `tooling`          | `string[]`                              | Allowed only as devDependencies.                                   |
| `owners`           | `Record<package, workspace>`            | The only workspace allowed to declare a third-party package.       |
| `runtimeAllowlist` | `Record<workspace, package[]>`          | The only packages allowed in that workspace's `dependencies`.      |
| `forbiddenReach`   | `{ from, to }[]`                        | `to` (an `@idp/*` name or a third-party package) must be unreachable from `from`. |
| `$comment`         | `string` (optional)                     | Ignored.                                                           |

Every workspace name must be `@idp/*` and appear exactly once across `layers`, `isolated` and `tooling`.
Unknown keys are rejected.

## API

All exports come from `src/index.ts`. The package has no `exports`/`main` field, so consumers (its own tests) import the source directly.

| Export | Kind | Description |
| ------ | ---- | ----------- |
| `checkBoundaries(graph, model): BoundaryViolation[]` | function | Pure rule engine. Returns violations sorted by code, then package, then dependency. |
| `readWorkspaceGraph(root): WorkspaceGraph` | function | Reads `<root>/{packages,apps,tools}/*/package.json`. Skips directories without a manifest. Throws `WorkspaceReadError`. |
| `loadLayerModel(path): LayerModel` | function | Reads and validates `layers.json`. Throws `LayersConfigError`. |
| `parseLayerModel(raw: unknown): LayerModel` | function | Validates an already-parsed value (pure). Throws `LayersConfigError`. |
| `formatViolations(violations): string` | function | One line per violation, in the CLI format. |
| `BOUNDARY_RULES` | const | `BoundaryCode` → rule name map. |
| `BoundaryCode` | type | `'BND001'` … `'BND009'`. |
| `BoundaryViolation` | type | `{ code, rule, package, dependency, section, path, message }`. `path` is the edge chain for cycles and forbidden reach, and `[package, dependency]` otherwise. |
| `LayerModel`, `ForbiddenReach` | types | The validated `layers.json`. |
| `DEPENDENCY_SECTIONS` | const | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`. |
| `DependencySection` | type | One of the four manifest sections. |
| `WorkspaceNode` | type | `{ name, dir, <four sections> }`. Missing sections are `{}`. |
| `WorkspaceGraph` | type | `ReadonlyMap<name, WorkspaceNode>`. |
| `LayersConfigError` | class | `code: 'LAYERS_CONFIG_INVALID'`, `key`: the offending key, or `(file)`. |
| `WorkspaceReadError` | class | `code: 'WORKSPACE_READ_FAILED'`, `path`: the offending manifest or directory. |

### Example

```ts
import { checkBoundaries, formatViolations, loadLayerModel, readWorkspaceGraph } from './src/index.js';

const model = loadLayerModel('tools/repo-checks/layers.json');
const graph = readWorkspaceGraph(process.cwd());
const violations = checkBoundaries(graph, model);
if (violations.length > 0) {
	console.error(formatViolations(violations));
}
```

## Tests

```bash
pnpm --filter @idp/repo-checks test        # unit (src/*.test.ts) + functional (test/functional/)
pnpm --filter @idp/repo-checks typecheck
```

The functional tests run against the real repository. They cover AC3 (zero boundary violations), AC6
(the ESLint source-import rules) and AC7 (`.env` hygiene). Test caching is disabled in `turbo.json`.
