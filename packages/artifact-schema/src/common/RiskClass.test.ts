import { describe, expect, it } from 'vitest';
import { maxRisk, RISK_ORDER, RiskClassSchema } from './RiskClass.js';

describe('RiskClass', () => {
	it('orders read < reversible < irreversible', () => {
		expect(RISK_ORDER).toEqual(['read', 'reversible', 'irreversible']);
	});

	it('parses the three classes and rejects others', () => {
		for (const risk of RISK_ORDER) expect(RiskClassSchema.parse(risk)).toBe(risk);
		expect(RiskClassSchema.safeParse('write').success).toBe(false);
	});

	it('maxRisk never lowers the risk', () => {
		expect(maxRisk('read')).toBe('read');
		expect(maxRisk('read', 'reversible')).toBe('reversible');
		expect(maxRisk('irreversible', 'read')).toBe('irreversible');
		expect(maxRisk('reversible', 'read', 'irreversible', 'read')).toBe('irreversible');
	});
});
