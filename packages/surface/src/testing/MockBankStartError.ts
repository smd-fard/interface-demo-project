/** The mock-bank process could not be started (not built, crashed, or never reported/answered health). */
export class MockBankStartError extends Error {
	readonly code = 'MOCKBANK_START_FAILED' as const;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'MockBankStartError';
	}
}
