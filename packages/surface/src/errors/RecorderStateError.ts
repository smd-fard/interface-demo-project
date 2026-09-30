/** The recorder was used out of order: started twice, or asked to settle a dialog while not recording. */
export class RecorderStateError extends Error {
	readonly code = 'RECORDER_STATE' as const;

	constructor(readonly problem: 'already_recording' | 'not_recording') {
		super(problem === 'already_recording' ? 'the recorder is already recording' : 'the recorder is not recording');
		this.name = 'RecorderStateError';
	}
}
