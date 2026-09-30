import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppProfileSchema, PolicyConfigSchema, type AppProfile, type PolicyConfig } from '@idp/artifact-schema';
import { resolvePolicy, type ResolvedPolicy } from '@idp/policy';
import { ConfigError } from '../errors/ConfigError.js';
import type { PathContext } from '../paths/resolveRunsRoot.js';
import { expandEnvTokens } from './expandEnvTokens.js';
import { mockBankOrigin } from './mockBankOrigin.js';
import { DEFAULT_PROFILE, resolveProfilePath } from './resolveProfilePath.js';

/** Input of `loadConfig`: repo/invocation paths, the env used for `${VAR}` expansion, and the profile. */
export interface LoadConfigInput extends PathContext {
	readonly env: Readonly<Record<string, string | undefined>>;
	/** A profile name or path (default `mock-bank`). */
	readonly profile?: string;
}

/** The validated policy and app profile, with the resolved policy and the files they came from. */
export interface LoadedConfig {
	readonly policyConfig: PolicyConfig;
	readonly policy: ResolvedPolicy;
	readonly profile: AppProfile;
	/** The app origin (the profile's, expanded). */
	readonly origin: string;
	readonly policyPath: string;
	readonly profilePath: string;
}

async function readJson(file: string): Promise<unknown> {
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (error) {
		throw new ConfigError('config_not_found', `config file ${file} cannot be read`, { cause: error });
	}
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new ConfigError('config_invalid', `config file ${file} is not valid JSON`, { cause: error });
	}
}

/** Schema issue paths and codes only: never the offending values. */
interface SafeParser<T> {
	safeParse(
		value: unknown,
	):
		| { readonly success: true; readonly data: T }
		| { readonly success: false; readonly error: { readonly issues: readonly SchemaIssue[] } };
}
interface SchemaIssue {
	readonly path: readonly PropertyKey[];
	readonly code: string;
}

function parseWith<T>(schema: SafeParser<T>, document: unknown, file: string): T {
	const parsed = schema.safeParse(document);
	if (parsed.success) return parsed.data;
	const issues = parsed.error.issues
		.slice(0, 5)
		.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.code}`)
		.join('; ');
	throw new ConfigError('config_invalid', `config file ${file} is invalid (${issues})`);
}

/**
 * Loads `<repo>/config/policy.json` and the app profile, expands `${MOCKBANK_ORIGIN}` (see `mockBankOrigin`)
 * and any other `${VAR}` from the env, validates both and resolves the policy. It never prints or logs a value.
 */
export async function loadConfig(input: LoadConfigInput): Promise<LoadedConfig> {
	const vars = { ...input.env, MOCKBANK_ORIGIN: mockBankOrigin(input.env) };
	const policyPath = path.join(input.repoRoot, 'config', 'policy.json');
	const policyConfig = parseWith(
		PolicyConfigSchema,
		expandEnvTokens(await readJson(policyPath), vars, policyPath),
		policyPath,
	);
	const policy = resolvePolicy(policyConfig);
	const profilePath = resolveProfilePath(input.profile ?? DEFAULT_PROFILE, input);
	const profile = parseWith(
		AppProfileSchema,
		expandEnvTokens(await readJson(profilePath), vars, profilePath),
		profilePath,
	);
	return { policyConfig, policy, profile, origin: profile.origin, policyPath, profilePath };
}
