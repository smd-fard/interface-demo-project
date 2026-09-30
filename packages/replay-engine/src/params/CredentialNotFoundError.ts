/** The credential provider has no credential for the reference. The message names the ref, never a value. */
export class CredentialNotFoundError extends Error {
	readonly code = 'CREDENTIAL_NOT_FOUND' as const;

	constructor(readonly ref: string) {
		super(`no credential is configured for "${ref}"`);
		this.name = 'CredentialNotFoundError';
	}
}
