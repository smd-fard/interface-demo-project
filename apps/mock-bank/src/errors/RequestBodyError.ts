import { MockBankError } from './MockBankError.js';

/** A request body is too large or cannot be parsed. `status` is the HTTP status to answer with. */
export class RequestBodyError extends MockBankError {
	readonly code = 'MOCKBANK_BAD_REQUEST_BODY';

	constructor(
		message: string,
		readonly status: 400 | 413,
	) {
		super(message);
	}
}
