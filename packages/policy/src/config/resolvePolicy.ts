import type { PolicyConfig } from '@idp/artifact-schema';
import { PolicyConfigError } from '../errors/PolicyConfigError.js';
import { compileRouteGlob, type RouteMatcher } from './matchRouteGlob.js';
import type { ControlNameRule, ResolvedPolicy } from './ResolvedPolicy.js';

const ENV_TOKEN = /\$\{[^}]*\}/;

function normalizeOrigin(origin: string): string {
	if (ENV_TOKEN.test(origin)) {
		throw new PolicyConfigError(
			'unexpanded_env_token',
			`origin "${origin}" still contains an \${ENV} token; the loader must expand it first`,
		);
	}
	if (!URL.canParse(origin)) {
		throw new PolicyConfigError('invalid_origin', `origin "${origin}" is not a URL origin`);
	}
	const parsed = new URL(origin);
	if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin === 'null') {
		throw new PolicyConfigError('invalid_origin', `origin "${origin}" must be http(s)`);
	}
	return parsed.origin;
}

function compileControlName(source: string): ControlNameRule {
	try {
		// Case-insensitive: a rule can only raise the risk, so matching more is the conservative side.
		return Object.freeze({ source, regex: new RegExp(source, 'iu') });
	} catch (error) {
		throw new PolicyConfigError('invalid_regex', `irreversible control-name pattern "${source}" is not a valid regex`, {
			cause: error,
		});
	}
}

interface OriginRoutes {
	include: RouteMatcher[];
	exclude: RouteMatcher[];
}

/**
 * Compiles a parsed, env-expanded `PolicyConfig` into a frozen {@link ResolvedPolicy}. Pure.
 * @throws PolicyConfigError when an origin is not expanded or invalid, or a regex/glob does not compile.
 */
export function resolvePolicy(config: PolicyConfig): ResolvedPolicy {
	const origins = new Set(config.allow.origins.map(normalizeOrigin));
	const routes = new Map<string, OriginRoutes>();
	for (const rule of config.allow.routes) {
		const origin = normalizeOrigin(rule.origin);
		const entry = routes.get(origin) ?? { include: [], exclude: [] };
		entry.include.push(...rule.include.map(compileRouteGlob));
		entry.exclude.push(...rule.exclude.map(compileRouteGlob));
		routes.set(origin, entry);
	}
	return Object.freeze({
		version: config.version,
		origins,
		actions: new Set(config.allow.actions),
		irreversibleControlNames: Object.freeze(config.irreversible.controlNamePatterns.map(compileControlName)),
		irreversibleRoutes: Object.freeze(
			config.irreversible.routes.map((glob) => Object.freeze({ glob, matches: compileRouteGlob(glob) })),
		),
		redaction: config.redaction,
		approvalExpiresMs: config.approval.expiresMs,
		isRouteAllowed(origin: string, path: string): boolean {
			const entry = routes.get(origin);
			if (entry === undefined) return false;
			if (entry.exclude.some((matches) => matches(path))) return false;
			return entry.include.some((matches) => matches(path));
		},
	});
}
