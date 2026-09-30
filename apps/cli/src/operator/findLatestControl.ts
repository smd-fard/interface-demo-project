import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ControlFiles } from './ControlFiles.js';
import { CONTROL_JSON } from './writeControlFiles.js';

function isMissing(error: unknown): boolean {
	return error instanceof Error && (error as { code?: unknown }).code === 'ENOENT';
}

/**
 * The `control.json` most recently written under the runs root by a running attended session (`idp replay
 * --attended`), or `null` when there is none. A finished session removes its control files.
 */
export async function findLatestControl(runsRoot: string): Promise<ControlFiles | null> {
	let entries;
	try {
		entries = await readdir(runsRoot, { withFileTypes: true });
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
	let latest: { readonly file: string; readonly mtimeMs: number } | null = null;
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const file = path.join(runsRoot, entry.name, CONTROL_JSON);
		let mtimeMs: number;
		try {
			mtimeMs = (await stat(file)).mtimeMs;
		} catch (error) {
			if (isMissing(error)) continue;
			throw error;
		}
		if (latest === null || mtimeMs > latest.mtimeMs) latest = { file, mtimeMs };
	}
	if (latest === null) return null;
	const parsed = JSON.parse(await readFile(latest.file, 'utf8')) as Partial<ControlFiles>;
	if (typeof parsed.controlUrl !== 'string' || typeof parsed.tokenFile !== 'string') return null;
	return { controlUrl: parsed.controlUrl, tokenFile: parsed.tokenFile };
}
