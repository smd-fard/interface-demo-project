/** Every fault code mock-bank can inject. */
export const FAULT_CODES = [
	'member_not_found',
	'validation_error',
	'permission_denied',
	'known_dialog',
	'unknown_dialog',
	'session_timeout',
	'slow_load',
	'failed_load',
	'failed_load_persistent',
	'app_error',
	'control_missing',
] as const;

/** One of `FAULT_CODES`. */
export type FaultCode = (typeof FAULT_CODES)[number];

/** `once` disarms after firing; `always` fires until cleared. */
export type FaultMode = 'once' | 'always';

/** Signed-in content pages: every route under `/member/` and `/subaccount/`. */
const CONTENT_PAGES = ['/member/*', '/subaccount/*'] as const;

/**
 * Where each fault applies when no `route` is given (glob patterns on the path), and its default mode.
 * A fault with an explicit `route` applies to any non-admin path that matches it instead.
 */
export const FAULT_DEFAULTS: Record<FaultCode, { readonly routes: readonly string[]; readonly mode: FaultMode }> = {
	member_not_found: { routes: ['/member/detail'], mode: 'once' },
	validation_error: { routes: ['/member/detail'], mode: 'once' },
	permission_denied: { routes: ['/member/detail', '/subaccount/*'], mode: 'once' },
	known_dialog: { routes: ['/member/detail'], mode: 'once' },
	unknown_dialog: { routes: ['/member/detail'], mode: 'once' },
	session_timeout: { routes: CONTENT_PAGES, mode: 'once' },
	slow_load: { routes: CONTENT_PAGES, mode: 'once' },
	failed_load: { routes: CONTENT_PAGES, mode: 'once' },
	failed_load_persistent: { routes: CONTENT_PAGES, mode: 'always' },
	app_error: { routes: CONTENT_PAGES, mode: 'once' },
	control_missing: { routes: ['/member/search'], mode: 'once' },
};

/** Type guard for a known fault code. */
export function isFaultCode(value: unknown): value is FaultCode {
	return typeof value === 'string' && (FAULT_CODES as readonly string[]).includes(value);
}
