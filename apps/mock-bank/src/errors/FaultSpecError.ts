import { MockBankError } from './MockBankError.js';

/** A fault request (admin JSON body or `MOCKBANK_FAULTS` entry) is malformed or names an unknown code. */
export class FaultSpecError extends MockBankError {
	readonly code = 'MOCKBANK_FAULT_INVALID';
}
