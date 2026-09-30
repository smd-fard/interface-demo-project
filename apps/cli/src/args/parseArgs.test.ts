import { describe, expect, it } from 'vitest';
import { CliUsageError } from '../errors/CliUsageError.js';
import type { CommandSpec } from './CommandSpec.js';
import { formatHelp } from './formatHelp.js';
import { parseCommandArgs } from './parseCommandArgs.js';
import { parseKeyValues } from './parseKeyValues.js';
import { parseOutputFlag } from './parseOutputFlag.js';

const SPEC = {
	name: 'replay',
	summary: 'Replay an artifact.',
	usage: 'idp replay --artifact <file> [--param k=v ...]',
	options: {
		artifact: { type: 'string', valueName: 'file', description: 'The artifact file.' },
		param: { type: 'string', multiple: true, valueName: 'k=v', description: 'A param (repeatable).' },
		attended: { type: 'boolean', description: 'Attended run.' },
		'verify-replay': { type: 'boolean', default: true, negatable: true, description: 'Verify by replay.' },
	},
	examples: ['idp replay --artifact artifacts/member-lookup.json --param memberId=<id>'],
} as const satisfies CommandSpec;

describe('parseCommandArgs', () => {
	it('parses strings, repeatable strings, booleans and defaults', () => {
		const values = parseCommandArgs(SPEC, ['--artifact', 'a.json', '--param', 'x=1', '--param', 'y=2', '--attended']);
		expect(values).toMatchObject({
			artifact: 'a.json',
			param: ['x=1', 'y=2'],
			attended: true,
			'verify-replay': true,
		});
	});

	it('supports --no-<flag> for a negatable boolean', () => {
		expect(parseCommandArgs(SPEC, ['--no-verify-replay'])['verify-replay']).toBe(false);
	});

	it('rejects an unknown flag with a usage error (exit 64) naming the command', () => {
		const error = captureError(() => parseCommandArgs(SPEC, ['--nope']));
		expect(error).toBeInstanceOf(CliUsageError);
		expect(error).toMatchObject({ code: 'usage', command: 'replay' });
	});

	it('rejects positionals and a missing value', () => {
		expect(() => parseCommandArgs(SPEC, ['stray'])).toThrow(CliUsageError);
		expect(() => parseCommandArgs(SPEC, ['--artifact'])).toThrow(CliUsageError);
	});

	it('never echoes a flag value in the usage error message', () => {
		const error = captureError(() => parseCommandArgs(SPEC, ['--attended=12345']));
		expect(error).toBeInstanceOf(CliUsageError);
		expect((error as Error).message).not.toContain('12345');
	});
});

describe('parseKeyValues', () => {
	it('builds a record from k=v pairs, splitting at the first "="', () => {
		expect(parseKeyValues(['memberId=12345', 'note=a=b'], '--param')).toEqual({ memberId: '12345', note: 'a=b' });
	});

	it('accepts an empty list and an empty value', () => {
		expect(parseKeyValues(undefined, '--param')).toEqual({});
		expect(parseKeyValues(['k='], '--param')).toEqual({ k: '' });
	});

	it('rejects a pair without "=" or with an empty key, without echoing the value', () => {
		const error = captureError(() => parseKeyValues(['12345'], '--param'));
		expect(error).toBeInstanceOf(CliUsageError);
		expect((error as Error).message).toContain('--param');
		expect((error as Error).message).not.toContain('12345');
		expect(() => parseKeyValues(['=v'], '--param')).toThrow(CliUsageError);
	});

	it('rejects a duplicate key', () => {
		expect(() => parseKeyValues(['a=1', 'a=2'], '--input')).toThrow(/duplicate/);
	});
});

describe('parseOutputFlag', () => {
	it('parses string, integer, boolean and decimal (default scale 2)', () => {
		expect(parseOutputFlag('memberName:string')).toMatchObject({ name: 'memberName', type: { kind: 'string' } });
		expect(parseOutputFlag('count:integer').type).toEqual({ kind: 'integer' });
		expect(parseOutputFlag('open:boolean').type).toEqual({ kind: 'boolean' });
		expect(parseOutputFlag('savingsBalance:decimal').type).toEqual({ kind: 'decimal', scale: 2 });
		expect(parseOutputFlag('rate:decimal:4').type).toEqual({ kind: 'decimal', scale: 4 });
	});

	it('declares every CLI output sensitive, with a description', () => {
		const spec = parseOutputFlag('savingsBalance:decimal:2');
		expect(spec.sensitive).toBe(true);
		expect(spec.description.length).toBeGreaterThan(0);
	});

	it.each(['savingsBalance', 'savingsBalance:money', 'Bad-Name:string', 'x:decimal:abc', 'x:string:2'])(
		'rejects %s',
		(flag) => {
			expect(() => parseOutputFlag(flag)).toThrow(CliUsageError);
		},
	);
});

describe('formatHelp', () => {
	it('prints the usage, every flag with its value name, and the examples', () => {
		const help = formatHelp(SPEC);
		expect(help).toContain('idp replay --artifact <file>');
		expect(help).toContain('--artifact <file>');
		expect(help).toContain('--param <k=v>');
		expect(help).toContain('--attended');
		expect(help).toContain('--[no-]verify-replay');
		expect(help).toContain('(default: on)');
		expect(help).toContain('idp replay --artifact artifacts/member-lookup.json');
	});
});

function captureError(fn: () => unknown): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	throw new Error('expected an error');
}
