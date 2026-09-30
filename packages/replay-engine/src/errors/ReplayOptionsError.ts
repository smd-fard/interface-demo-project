/** A replay option is outside its bounds. A caller (programming) error: thrown before the run starts. */
export class ReplayOptionsError extends Error {
	readonly code = 'REPLAY_OPTIONS_INVALID' as const;

	constructor(
		readonly option: string,
		readonly bounds: string,
	) {
		super(`replay option ${option} must be ${bounds}`);
		this.name = 'ReplayOptionsError';
	}
}
