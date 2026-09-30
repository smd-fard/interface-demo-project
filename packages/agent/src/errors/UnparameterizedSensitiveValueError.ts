/**
 * A trace step fills a sensitive value that is neither a declared param nor a credential — typically an operator
 * typing during a discovery takeover. It cannot compile to a literal (invariant 3), so the artifact is not
 * produced. The message names the step, never the value.
 */
export class UnparameterizedSensitiveValueError extends Error {
	readonly code = 'UNPARAMETERIZED_SENSITIVE_VALUE' as const;

	constructor(
		/** The index of the trace step. */
		readonly stepIndex: number,
		/** Who typed the value. */
		readonly actor: 'agent' | 'human',
	) {
		super(
			`trace step ${stepIndex} (${actor}) typed a sensitive value that is not a declared param or credential; ` +
				'declare a param whose example input is that value and run discovery again (artifacts store references only)',
		);
		this.name = 'UnparameterizedSensitiveValueError';
	}
}
