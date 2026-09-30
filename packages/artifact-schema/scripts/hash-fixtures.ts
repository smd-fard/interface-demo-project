// Recomputes `contentHash` for the valid fixtures (fixtures/*.artifact.json) after a hand edit.
// Run with `pnpm --filter @idp/artifact-schema fixtures:hash`, then `pnpm format`. Never run at test time:
// the tests verify the committed hashes, so a stale hash fails the build instead of being silently fixed.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CapabilityArtifactSchema } from '../src/artifact/CapabilityArtifact.js';
import { computeContentHash } from '../src/common/contentHash.js';

const fixtures = new URL('../fixtures/', import.meta.url);

for (const file of readdirSync(fixtures).filter((name) => name.endsWith('.artifact.json'))) {
	const url = new URL(file, fixtures);
	const artifact = JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
	const parsed = CapabilityArtifactSchema.safeParse(artifact);
	if (!parsed.success) {
		process.stderr.write(
			`${file}: not a valid artifact, refusing to hash\n${JSON.stringify(parsed.error.issues, null, 2)}\n`,
		);
		process.exitCode = 1;
		continue;
	}
	const contentHash = await computeContentHash(artifact);
	writeFileSync(url, `${JSON.stringify({ ...artifact, contentHash }, null, '\t')}\n`);
	process.stdout.write(`${file}: ${contentHash}\n`);
}
