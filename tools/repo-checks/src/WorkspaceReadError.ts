/** Thrown when a workspace `package.json` cannot be read or is not a valid manifest. */
export class WorkspaceReadError extends Error {
	readonly code = 'WORKSPACE_READ_FAILED' as const;

	/** Absolute path of the offending manifest (or directory). */
	readonly path: string;

	constructor(path: string, detail: string, options?: ErrorOptions) {
		super(`cannot read workspace manifest ${path}: ${detail}`, options);
		this.name = 'WorkspaceReadError';
		this.path = path;
	}
}
