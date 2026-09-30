import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppProfileSchema, type AppProfile, type ParamSpec } from '@idp/artifact-schema';
import { resolvePolicy, type ResolvedPolicy } from '@idp/policy';
import { mockBankPolicyConfig } from '@idp/surface/testing';

/** The synthetic values of the member-lookup discovery (tenant A). None may reach an artifact or a prompt. */
export const MEMBER_ID = '12345';
export const CREDENTIALS = Object.freeze({ username: 'teller01', password: 'synthetic-pass-01' });
export const CONCRETE_VALUES = ['12345', 'teller01', 'synthetic-pass-01', 'Jane Sample', '1523.47'] as const;

export const MEMBER_LOOKUP_GOAL = `Look up member ${MEMBER_ID} and return the Share Savings balance and the member name`;

export const MEMBER_ID_PARAM: ParamSpec = {
	name: 'memberId',
	description: 'The 5-digit member number to look up.',
	type: { kind: 'string', pattern: '^\\d{5}$' },
	required: true,
	sensitive: true,
};

const repoFile = (relative: string) => new URL(`../../../../${relative}`, import.meta.url);

/** The tenant-A mock-bank profile with its origin expanded. */
export async function mockBankProfile(origin: string): Promise<AppProfile> {
	const raw = (await readFile(repoFile('config/apps/mock-bank.profile.json'), 'utf8')).replace(
		'${MOCKBANK_ORIGIN}',
		origin,
	);
	return AppProfileSchema.parse(JSON.parse(raw));
}

export function mockBankPolicy(origin: string): ResolvedPolicy {
	return resolvePolicy(mockBankPolicyConfig(origin));
}

/** Absolute path of a scripted-model file in `packages/agent/scripts/`. */
export function scriptPath(name: string): string {
	return new URL(`../../scripts/${name}`, import.meta.url).pathname;
}

/** Every file of a run directory, as text, keyed by its path relative to the run directory (PNGs skipped). */
export async function runFiles(runDir: string): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	for (const entry of await readdir(runDir, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || entry.name.endsWith('.png')) continue;
		const absolute = path.join(entry.parentPath, entry.name);
		files.set(path.relative(runDir, absolute), await readFile(absolute, 'utf8'));
	}
	return files;
}
