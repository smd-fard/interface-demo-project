import { describe, expect, it } from 'vitest';
import { OriginSchema } from './Origin.js';

describe('OriginSchema', () => {
	it.each(['http://127.0.0.1:4010', 'https://coreone.example.test', '${MOCKBANK_ORIGIN}'])('accepts %s', (origin) => {
		expect(OriginSchema.safeParse(origin).success).toBe(true);
	});
	it.each(['127.0.0.1:4010', 'http://127.0.0.1:4010/', 'http://host/path', '${lowercase}', '$MOCKBANK_ORIGIN', ''])(
		'rejects %j',
		(origin) => {
			expect(OriginSchema.safeParse(origin).success).toBe(false);
		},
	);
});
