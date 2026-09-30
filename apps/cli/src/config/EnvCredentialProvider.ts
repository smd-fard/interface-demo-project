import { CredentialNotFoundError, type Credential, type CredentialProvider } from '@idp/replay-engine';

/** The env keys holding a credential ref: `mockbank-operator` → `MOCKBANK_OPERATOR_USER` / `_PASSWORD`. */
export function credentialEnvKeys(ref: string): { readonly user: string; readonly password: string } {
	const base = ref.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
	return { user: `${base}_USER`, password: `${base}_PASSWORD` };
}

/** A credential ref whose env keys are unset. Names the keys, never a value. */
class EnvCredentialMissingError extends CredentialNotFoundError {
	constructor(ref: string) {
		super(ref);
		const keys = credentialEnvKeys(ref);
		this.message = `no credential is configured for "${ref}": set ${keys.user} and ${keys.password} (in .env or the environment)`;
		this.name = 'EnvCredentialMissingError';
	}
}

/**
 * The CLI's credential store: a credential ref resolves from two env variables (see `credentialEnvKeys`), loaded
 * from `.env` or the shell. Artifacts only hold the ref (`credentialRef: "mockbank-operator"`).
 */
export class EnvCredentialProvider implements CredentialProvider {
	constructor(private readonly env: Readonly<Record<string, string | undefined>>) {}

	resolve(ref: string): Promise<Credential> {
		const keys = credentialEnvKeys(ref);
		const username = this.env[keys.user] ?? '';
		const password = this.env[keys.password] ?? '';
		if (username === '' || password === '') return Promise.reject(new EnvCredentialMissingError(ref));
		return Promise.resolve({ username, password });
	}

	/** The values set for `ref` (to seed a redactor before anything is printed). */
	knownValues(ref: string): string[] {
		const keys = credentialEnvKeys(ref);
		return [this.env[keys.user], this.env[keys.password]].filter(
			(value): value is string => value !== undefined && value !== '',
		);
	}
}
