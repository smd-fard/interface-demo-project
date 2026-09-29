import { readFileSync } from 'node:fs';

import { LayersConfigError } from './LayersConfigError.js';

/** A rule that the transitive dependency closure of `from` must never contain `to`. */
export interface ForbiddenReach {
	readonly from: string;
	readonly to: string;
}

/** The parsed, validated `layers.json`: the machine-readable dependency direction of the repo. */
export interface LayerModel {
	/** Ordered rank groups, left → right. A package may depend only on packages in a strictly lower rank. */
	readonly layers: readonly (readonly string[])[];
	/** Workspaces that must not depend on, or be depended on by, any other `@idp/*` workspace. */
	readonly isolated: readonly string[];
	/** Tooling workspaces: allowed as devDependencies anywhere, never as runtime dependencies. */
	readonly tooling: readonly string[];
	/** Third-party package → the only `@idp/*` workspace allowed to declare it. */
	readonly owners: Readonly<Record<string, string>>;
	/** `@idp/*` workspace → the only packages allowed in its `dependencies`. */
	readonly runtimeAllowlist: Readonly<Record<string, readonly string[]>>;
	/** Transitive reach rules. */
	readonly forbiddenReach: readonly ForbiddenReach[];
}

const SCOPE = '@idp/';
const KNOWN_KEYS = new Set([
	'$comment',
	'layers',
	'isolated',
	'tooling',
	'owners',
	'runtimeAllowlist',
	'forbiddenReach',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scopedName(value: unknown, key: string): string {
	if (typeof value !== 'string' || !value.startsWith(SCOPE) || value.length === SCOPE.length) {
		throw new LayersConfigError(key, `expected an "${SCOPE}*" workspace name, got ${JSON.stringify(value)}`);
	}
	return value;
}

function nonEmptyString(value: unknown, key: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new LayersConfigError(key, `expected a non-empty string, got ${JSON.stringify(value)}`);
	}
	return value;
}

function nameList(value: unknown, key: string): string[] {
	if (!Array.isArray(value)) {
		throw new LayersConfigError(key, 'expected an array of workspace names');
	}
	return value.map((item, index) => scopedName(item, `${key}[${index}]`));
}

/**
 * Validates an already-parsed `layers.json` value (pure; a top-level `$comment` string is accepted and ignored).
 *
 * @throws {@link LayersConfigError} (`LAYERS_CONFIG_INVALID`) naming the offending key on any shape error.
 */
export function parseLayerModel(raw: unknown): LayerModel {
	if (!isRecord(raw)) {
		throw new LayersConfigError('(root)', 'expected a JSON object');
	}
	for (const key of Object.keys(raw)) {
		if (!KNOWN_KEYS.has(key)) {
			throw new LayersConfigError(key, 'unknown key');
		}
	}
	if ('$comment' in raw && typeof raw['$comment'] !== 'string') {
		throw new LayersConfigError('$comment', 'expected a string');
	}

	const rawLayers = raw['layers'];
	if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
		throw new LayersConfigError('layers', 'expected a non-empty array of rank groups');
	}
	const layers = rawLayers.map((group, rank) => {
		const names = nameList(group, `layers[${rank}]`);
		if (names.length === 0) {
			throw new LayersConfigError(`layers[${rank}]`, 'a rank group must not be empty');
		}
		return names;
	});
	const isolated = nameList(raw['isolated'], 'isolated');
	const tooling = nameList(raw['tooling'], 'tooling');

	// Every name appears exactly once across layers, isolated and tooling.
	const seen = new Map<string, string>();
	const claim = (name: string, where: string): void => {
		const previous = seen.get(name);
		if (previous !== undefined) {
			throw new LayersConfigError(where, `"${name}" is already listed at ${previous}`);
		}
		seen.set(name, where);
	};
	layers.forEach((group, rank) => group.forEach((name, i) => claim(name, `layers[${rank}][${i}]`)));
	isolated.forEach((name, i) => claim(name, `isolated[${i}]`));
	tooling.forEach((name, i) => claim(name, `tooling[${i}]`));
	const known = (name: string, key: string): string => {
		if (!seen.has(name)) {
			throw new LayersConfigError(key, `"${name}" is not a workspace listed in layers, isolated or tooling`);
		}
		return name;
	};

	const rawOwners = raw['owners'];
	if (!isRecord(rawOwners)) {
		throw new LayersConfigError('owners', 'expected an object of package → owner workspace');
	}
	const owners: Record<string, string> = {};
	for (const [pkg, owner] of Object.entries(rawOwners)) {
		const key = `owners.${pkg}`;
		owners[nonEmptyString(pkg, key)] = known(scopedName(owner, key), key);
	}

	const rawAllowlist = raw['runtimeAllowlist'];
	if (!isRecord(rawAllowlist)) {
		throw new LayersConfigError('runtimeAllowlist', 'expected an object of workspace → allowed dependencies');
	}
	const runtimeAllowlist: Record<string, string[]> = {};
	for (const [name, allowed] of Object.entries(rawAllowlist)) {
		const key = `runtimeAllowlist.${name}`;
		known(scopedName(name, key), key);
		if (!Array.isArray(allowed)) {
			throw new LayersConfigError(key, 'expected an array of package names');
		}
		runtimeAllowlist[name] = allowed.map((pkg, i) => nonEmptyString(pkg, `${key}[${i}]`));
	}

	const rawReach = raw['forbiddenReach'];
	if (!Array.isArray(rawReach)) {
		throw new LayersConfigError('forbiddenReach', 'expected an array of { from, to }');
	}
	const forbiddenReach = rawReach.map((rule, i): ForbiddenReach => {
		const key = `forbiddenReach[${i}]`;
		if (!isRecord(rule)) {
			throw new LayersConfigError(key, 'expected an object { from, to }');
		}
		const from = known(scopedName(rule['from'], `${key}.from`), `${key}.from`);
		const to = nonEmptyString(rule['to'], `${key}.to`);
		return { from, to };
	});

	return { layers, isolated, tooling, owners, runtimeAllowlist, forbiddenReach };
}

/**
 * Reads and validates `layers.json` from disk.
 *
 * @throws {@link LayersConfigError} (`LAYERS_CONFIG_INVALID`) on read, JSON parse or shape errors.
 */
export function loadLayerModel(path: string): LayerModel {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (error) {
		throw new LayersConfigError('(file)', `cannot read ${path}`, { cause: error });
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		throw new LayersConfigError('(file)', `invalid JSON in ${path}`, { cause: error });
	}
	return parseLayerModel(raw);
}
