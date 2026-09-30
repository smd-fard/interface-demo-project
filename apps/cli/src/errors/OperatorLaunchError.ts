/** Stable codes of {@link OperatorLaunchError}. */
export type OperatorLaunchErrorCode = 'operator_not_built' | 'no_attended_session' | 'token_file_unreadable';

/** `idp operator` cannot start the operator console. The message never contains the control token. */
export class OperatorLaunchError extends Error {
	constructor(
		readonly code: OperatorLaunchErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'OperatorLaunchError';
	}
}
