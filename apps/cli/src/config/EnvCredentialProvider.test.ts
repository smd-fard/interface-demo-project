import { CredentialNotFoundError } from '@idp/replay-engine';
import { describe, expect, it } from 'vitest';
import { credentialEnvKeys, EnvCredentialProvider } from './EnvCredentialProvider.js';

describe('credentialEnvKeys', () => {
	it('maps a credential ref to <REF>_USER / <REF>_PASSWORD in upper snake case', () => {
		expect(credentialEnvKeys('mockbank-operator')).toEqual({
			user: 'MOCKBANK_OPERATOR_USER',
			password: 'MOCKBANK_OPERATOR_PASSWORD',
		});
		expect(credentialEnvKeys('core_one.admin')).toEqual({
			user: 'CORE_ONE_ADMIN_USER',
			password: 'CORE_ONE_ADMIN_PASSWORD',
		});
	});
});

describe('EnvCredentialProvider', () => {
	it('resolves mockbank-operator from MOCKBANK_OPERATOR_USER / MOCKBANK_OPERATOR_PASSWORD', async () => {
		const provider = new EnvCredentialProvider({
			MOCKBANK_OPERATOR_USER: 'teller01',
			MOCKBANK_OPERATOR_PASSWORD: 'synthetic-pass-01',
		});
		await expect(provider.resolve('mockbank-operator')).resolves.toEqual({
			username: 'teller01',
			password: 'synthetic-pass-01',
		});
	});

	it('fails with a CredentialNotFoundError naming the env keys (never a value) when one is missing', async () => {
		const provider = new EnvCredentialProvider({ MOCKBANK_OPERATOR_USER: 'teller01', MOCKBANK_OPERATOR_PASSWORD: '' });
		const error = await provider.resolve('mockbank-operator').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(CredentialNotFoundError);
		expect(error).toMatchObject({ code: 'CREDENTIAL_NOT_FOUND', ref: 'mockbank-operator' });
		const message = (error as Error).message;
		expect(message).toContain('MOCKBANK_OPERATOR_USER');
		expect(message).toContain('MOCKBANK_OPERATOR_PASSWORD');
		expect(message).not.toContain('teller01');
	});

	it('fails for an unknown ref whose keys are unset', async () => {
		await expect(new EnvCredentialProvider({}).resolve('other-app')).rejects.toThrow(/OTHER_APP_USER/);
	});

	it('lists the values it holds, so a redactor can be seeded with them', () => {
		const provider = new EnvCredentialProvider({
			MOCKBANK_OPERATOR_USER: 'teller01',
			MOCKBANK_OPERATOR_PASSWORD: 'synthetic-pass-01',
		});
		expect(provider.knownValues('mockbank-operator')).toEqual(['teller01', 'synthetic-pass-01']);
		expect(new EnvCredentialProvider({}).knownValues('mockbank-operator')).toEqual([]);
	});
});
