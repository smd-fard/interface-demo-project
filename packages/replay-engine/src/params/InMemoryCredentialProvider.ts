import type { Credential } from './Credential.js';
import { CredentialNotFoundError } from './CredentialNotFoundError.js';
import type { CredentialProvider } from './CredentialProvider.js';

/** A `CredentialProvider` over a fixed map, for tests and demos with synthetic credentials. */
export class InMemoryCredentialProvider implements CredentialProvider {
	private calls = 0;
	private readonly credentials: ReadonlyMap<string, Credential>;

	constructor(credentials: Readonly<Record<string, Credential>>) {
		this.credentials = new Map(Object.entries(credentials));
	}

	/** How many times `resolve` was called (a run resolves each ref once). */
	get resolveCalls(): number {
		return this.calls;
	}

	async resolve(ref: string): Promise<Credential> {
		this.calls += 1;
		const credential = this.credentials.get(ref);
		if (credential === undefined) throw new CredentialNotFoundError(ref);
		return credential;
	}
}
