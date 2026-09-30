import { createRedactor, FULL_MASK } from '@idp/policy';
import { describe, expect, it } from 'vitest';
import { ReplayError } from '../errors/ReplayError.js';
import { CredentialNotFoundError } from './CredentialNotFoundError.js';
import { InMemoryCredentialProvider } from './InMemoryCredentialProvider.js';
import { createValueBinder, paramBindings } from './bindValues.js';

const credentials = () =>
	new InMemoryCredentialProvider({ 'mockbank-operator': { username: 'teller01', password: 'synthetic-pass-01' } });

describe('bindValues', () => {
	it('binds a param value as a string', async () => {
		const binder = createValueBinder({
			params: { memberId: '12345', term: 12 },
			credentials: credentials(),
			redactor: createRedactor({ sensitiveValues: [] }),
		});
		expect(await binder.value({ kind: 'param', name: 'memberId' })).toBe('12345');
		expect(await binder.value({ kind: 'param', name: 'term' })).toBe('12');
	});

	it('uses a literal as-is', async () => {
		const binder = createValueBinder({
			params: {},
			credentials: credentials(),
			redactor: createRedactor({ sensitiveValues: [] }),
		});
		expect(await binder.value({ kind: 'literal', value: 'Vacation Savings' })).toBe('Vacation Savings');
	});

	it('resolves a credential through the provider and seeds the redactor with it at once', async () => {
		const redactor = createRedactor({ sensitiveValues: [] });
		const provider = credentials();
		const binder = createValueBinder({ params: {}, credentials: provider, redactor });
		expect(redactor.redactString('pwd synthetic-pass-01')).toBe('pwd synthetic-pass-01');
		expect(await binder.value({ kind: 'credential', ref: 'mockbank-operator', field: 'password' })).toBe(
			'synthetic-pass-01',
		);
		// Both fields are known to the redactor as soon as the credential is resolved.
		expect(redactor.redactString('pwd synthetic-pass-01 user teller01')).toBe(`pwd ${FULL_MASK} user ${FULL_MASK}`);
		expect(await binder.value({ kind: 'credential', ref: 'mockbank-operator', field: 'username' })).toBe('teller01');
		expect(provider.resolveCalls).toBe(1);
	});

	it('an unknown credential ref fails with a typed error from the provider', async () => {
		const binder = createValueBinder({
			params: {},
			credentials: credentials(),
			redactor: createRedactor({ sensitiveValues: [] }),
		});
		const error = await binder.value({ kind: 'credential', ref: 'other-operator', field: 'password' }).catch((e) => e);
		expect(error).toBeInstanceOf(CredentialNotFoundError);
		expect(error).toMatchObject({ code: 'CREDENTIAL_NOT_FOUND', ref: 'other-operator' });
	});

	it('a param that was not supplied is an invalid_params ReplayError', async () => {
		const binder = createValueBinder({
			params: {},
			credentials: credentials(),
			redactor: createRedactor({ sensitiveValues: [] }),
		});
		const error = await binder.value({ kind: 'param', name: 'nickname' }).catch((e) => e);
		expect(error).toBeInstanceOf(ReplayError);
		expect(error).toMatchObject({ code: 'invalid_params' });
	});

	it('template bindings are the params as strings', () => {
		expect(paramBindings({ memberId: '12345', term: 12, joint: true })).toEqual({
			memberId: '12345',
			term: '12',
			joint: 'true',
		});
		const binder = createValueBinder({
			params: { memberId: '12345' },
			credentials: credentials(),
			redactor: createRedactor({ sensitiveValues: [] }),
		});
		expect(binder.bindings).toEqual({ memberId: '12345' });
	});
});
