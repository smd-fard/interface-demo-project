/**
 * The browser refused or timed out on an action (element detached, not editable, load never finished, …).
 * Wraps the underlying error as `cause`; `message` carries only the kind and the reason, because browser
 * error messages can echo selectors built from bound (possibly sensitive) values.
 */
export class ActionFailedError extends Error {
	readonly code = 'ACTION_FAILED' as const;

	constructor(
		readonly actionKind: string,
		readonly reason: 'timeout' | 'error',
		options?: ErrorOptions,
	) {
		super(`${actionKind} failed (${reason === 'timeout' ? 'timed out' : 'browser error'})`, options);
		this.name = 'ActionFailedError';
	}
}
