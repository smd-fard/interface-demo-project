import type { Credential } from './Credential.js';

/**
 * The port through which replay resolves an artifact's `credentialRef` at run time; the artifact only ever
 * holds the reference. The CLI supplies an environment-backed implementation, tests an in-memory one.
 * `resolve` throws `CredentialNotFoundError` for an unknown ref.
 */
export interface CredentialProvider {
	resolve(ref: string): Promise<Credential>;
}
