/** The engine was used out of order (a programming error, never a run outcome). */
export class ReplayStateError extends Error {
	readonly code = 'REPLAY_STATE' as const;

	constructor(message: string) {
		super(message);
		this.name = 'ReplayStateError';
	}
}
