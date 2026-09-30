/** Stable codes of {@link PolicyConfigError}. */
export type PolicyConfigErrorCode = 'unexpanded_env_token' | 'invalid_origin' | 'invalid_regex' | 'invalid_route_glob';

/** Thrown by `resolvePolicy` when a policy config cannot be compiled into matchers. */
export class PolicyConfigError extends Error {
	constructor(
		readonly code: PolicyConfigErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'PolicyConfigError';
	}
}
