/** A navigation or request went to an origin (or scheme) outside the allowlist and was aborted. */
export class NavigationBlockedError extends Error {
	readonly code = 'NAVIGATION_BLOCKED' as const;

	constructor(
		/** The blocked origin (or scheme), never the full URL: paths and queries can carry sensitive values. */
		readonly blockedOrigin: string,
	) {
		super(`navigation to ${blockedOrigin} is not allowed`);
		this.name = 'NavigationBlockedError';
	}
}
