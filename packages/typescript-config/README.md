# @idp/typescript-config

Shared strict ESM `tsconfig` bases for the `@idp/*` workspaces.

## Exports

| Export                             | What it is                                                   |
| ---------------------------------- | ------------------------------------------------------------ |
| `@idp/typescript-config/base.json` | Strict ESM base, Node >= 22: `ES2024`, `NodeNext`, `node` types. |

`base.json` enables `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`,
`isolatedModules`, `resolveJsonModule`, `esModuleInterop`, `forceConsistentCasingInFileNames`,
`skipLibCheck`, `declaration`, `declarationMap` and `sourceMap`. It sets no `baseUrl`, `paths`, `include`
or output directories.

## How to extend

Add the dev dependency (never a runtime dependency — boundary check BND009):

```json
{ "devDependencies": { "@idp/typescript-config": "workspace:*" } }
```

`tsconfig.json` type-checks everything (including tests) and emits nothing:

```json
{
	"extends": "@idp/typescript-config/base.json",
	"compilerOptions": { "noEmit": true },
	"include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

`tsconfig.build.json` extends it and emits `src` to `dist`, without tests:

```json
{
	"extends": "./tsconfig.json",
	"compilerOptions": {
		"noEmit": false,
		"incremental": true,
		"rootDir": "src",
		"outDir": "dist",
		"tsBuildInfoFile": "dist/.tsbuildinfo"
	},
	"include": ["src/**/*.ts"],
	"exclude": ["src/**/*.test.ts"]
}
```

## Scripts

- `pnpm --filter @idp/typescript-config test` checks the key options in `base.json` so they cannot be
  loosened without anyone noticing.
