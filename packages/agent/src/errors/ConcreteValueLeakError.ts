/**
 * A compiled artifact contains a concrete value used or seen during discovery (an example input, a credential,
 * an extracted value). The artifact is not written (invariant 3). The message names where, never the value.
 */
export class ConcreteValueLeakError extends Error {
	readonly code = 'CONCRETE_VALUE_LEAK' as const;

	constructor(
		/** JSON path of the first string that holds the value, e.g. `steps[4].description`. */
		readonly path: string,
		/** Which kind of value leaked, e.g. `example input`. */
		readonly valueKind: string,
	) {
		super(`the artifact contains a concrete ${valueKind} at ${path}; artifacts store references only`);
		this.name = 'ConcreteValueLeakError';
	}
}
