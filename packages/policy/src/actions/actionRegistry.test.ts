import { ACTION_KINDS, RISK_ORDER } from '@idp/artifact-schema';
import { describe, expect, it } from 'vitest';
import { ACTION_REGISTRY, isActionKind } from './actionRegistry.js';

describe('ACTION_REGISTRY', () => {
	it('has exactly one entry per action kind (invariant 2)', () => {
		expect(Object.keys(ACTION_REGISTRY).sort()).toEqual([...ACTION_KINDS].sort());
	});

	it.each(ACTION_KINDS)('%s has a risk class, an allowlist key and a payload redaction mode', (kind) => {
		const entry = ACTION_REGISTRY[kind];
		expect(RISK_ORDER).toContain(entry.risk);
		expect(entry.allowlistKey).toBe(kind);
		expect(['none', 'value', 'extracted']).toContain(entry.payloadRedaction);
	});

	it('classifies each kind by its effect on the bank system', () => {
		const risks = Object.fromEntries(ACTION_KINDS.map((kind) => [kind, ACTION_REGISTRY[kind].risk]));
		expect(risks).toEqual({
			navigate: 'read',
			click: 'reversible',
			fill: 'reversible',
			select: 'reversible',
			press: 'reversible',
			extract: 'read',
			wait: 'read',
			dismiss_dialog: 'reversible',
		});
	});

	it('lets the target raise click and press (Enter can submit) and a dialog accept', () => {
		expect(ACTION_REGISTRY.click.raisableByTarget).toBe(true);
		expect(ACTION_REGISTRY.press.raisableByTarget).toBe(true);
		expect(ACTION_REGISTRY.dismiss_dialog.raisableByTarget).toBe(true);
		expect(ACTION_REGISTRY.extract.raisableByTarget).toBe(false);
		expect(ACTION_REGISTRY.wait.raisableByTarget).toBe(false);
	});

	it('marks typed values and extracted values for redaction', () => {
		expect(ACTION_REGISTRY.fill.payloadRedaction).toBe('value');
		expect(ACTION_REGISTRY.extract.payloadRedaction).toBe('extracted');
		expect(ACTION_REGISTRY.click.payloadRedaction).toBe('none');
	});

	it('is frozen', () => {
		expect(Object.isFrozen(ACTION_REGISTRY)).toBe(true);
		expect(Object.isFrozen(ACTION_REGISTRY.click)).toBe(true);
	});
});

describe('isActionKind', () => {
	it('accepts registered kinds and rejects anything else, including prototype keys', () => {
		expect(isActionKind('click')).toBe(true);
		expect(isActionKind('execute_js')).toBe(false);
		expect(isActionKind('toString')).toBe(false);
		expect(isActionKind('__proto__')).toBe(false);
	});
});
