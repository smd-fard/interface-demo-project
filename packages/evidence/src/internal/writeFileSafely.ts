import { rename, writeFile } from 'node:fs/promises';
import { EvidenceWriteError } from '../errors/EvidenceWriteError.js';

/**
 * Writes `data` to `target`. `exclusive` fails if the file exists (evidence is never overwritten); otherwise
 * the write is atomic (temp file + rename), for documents that are rewritten such as manifest.json.
 */
export async function writeFileSafely(
	target: string,
	data: Uint8Array | string,
	{ exclusive }: { readonly exclusive: boolean },
): Promise<void> {
	try {
		if (exclusive) {
			await writeFile(target, data, { flag: 'wx' });
		} else {
			const temp = `${target}.${process.pid}.tmp`;
			await writeFile(temp, data);
			await rename(temp, target);
		}
	} catch (cause) {
		throw new EvidenceWriteError(`cannot write ${target}`, { cause });
	}
}
