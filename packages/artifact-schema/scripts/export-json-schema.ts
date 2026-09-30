// Writes schemas/<name>.schema.json from the Zod contracts (src/jsonSchema.ts), formatted with the repo's
// prettier config. Run with `pnpm --filter @idp/artifact-schema schemas:export` after any contract change; the
// drift test (src/jsonSchema.test.ts) fails until the committed files match.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { toJsonSchemas } from '../src/jsonSchema.js';

const dir = new URL('../schemas/', import.meta.url);
mkdirSync(dir, { recursive: true });

const schemas = toJsonSchemas();
const expected = new Set(Object.keys(schemas).map((name) => `${name}.schema.json`));
for (const file of readdirSync(dir)) {
	if (file.endsWith('.schema.json') && !expected.has(file)) rmSync(new URL(file, dir));
}

for (const [name, schema] of Object.entries(schemas)) {
	const filepath = fileURLToPath(new URL(`${name}.schema.json`, dir));
	const options = (await resolveConfig(filepath)) ?? {};
	writeFileSync(filepath, await format(JSON.stringify(schema), { ...options, filepath }));
	process.stdout.write(`schemas/${name}.schema.json\n`);
}
