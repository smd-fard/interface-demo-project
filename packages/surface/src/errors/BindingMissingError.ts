/** A template names a `{{placeholder}}` for which the caller supplied no binding. */
export class BindingMissingError extends Error {
	readonly code = 'BINDING_MISSING' as const;

	constructor(readonly placeholder: string) {
		super(`no binding for placeholder {{${placeholder}}}`);
		this.name = 'BindingMissingError';
	}
}
