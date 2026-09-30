import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Creates a fresh temp directory for one test; call the returned cleanup in afterEach. */
export async function tempRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
	const root = await mkdtemp(path.join(tmpdir(), 'idp-evidence-'));
	return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
