/** Base class for every error mock-bank throws. `code` is stable and safe to match on. */
export abstract class MockBankError extends Error {
	abstract readonly code: string;

	constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}
