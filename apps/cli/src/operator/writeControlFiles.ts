import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ControlFiles } from './ControlFiles.js';

/** The run-dir file naming the control URL and token file of an attended session (never the token). */
export const CONTROL_JSON = 'control.json';
/** The run-dir file (mode 0600) holding the control token of an attended session. */
export const CONTROL_TOKEN = 'control.token';

/**
 * Writes the control token of an attended session to `<runDir>/control.token` (mode 0600; the token is never
 * printed) and `<runDir>/control.json` (URL + token file path, no token), which `idp operator` reads.
 */
export async function writeControlFiles(
	runDir: string,
	session: { readonly controlUrl: string; readonly controlToken: string },
): Promise<ControlFiles & { readonly controlFile: string }> {
	const tokenFile = path.join(runDir, CONTROL_TOKEN);
	const controlFile = path.join(runDir, CONTROL_JSON);
	await writeFile(tokenFile, session.controlToken, { mode: 0o600, flag: 'wx' });
	const files: ControlFiles = { controlUrl: session.controlUrl, tokenFile };
	await writeFile(controlFile, `${JSON.stringify(files, null, 2)}\n`, { mode: 0o600 });
	return { ...files, controlFile };
}

/** Removes both files once the session has closed (the token is dead; it must not linger in the run dir). */
export async function removeControlFiles(runDir: string): Promise<void> {
	await rm(path.join(runDir, CONTROL_TOKEN), { force: true });
	await rm(path.join(runDir, CONTROL_JSON), { force: true });
}
