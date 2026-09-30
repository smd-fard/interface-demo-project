import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JSON_SCHEMAS, toJsonSchemas } from './jsonSchema.js';
import { TargetRefSchema } from './locator/TargetRef.js';

const schemasDir = new URL('../schemas/', import.meta.url);

describe('JSON Schema export', () => {
	it('registers every public document contract', () => {
		expect(Object.keys(JSON_SCHEMAS).sort()).toEqual([
			'app-profile',
			'capability-artifact',
			'intervention-request',
			'policy-config',
			'run-log-entry',
			'run-manifest',
			'run-result',
		]);
	});

	it('matches the committed schemas/*.schema.json (run `pnpm --filter @idp/artifact-schema schemas:export` after a contract change)', () => {
		const generated = toJsonSchemas();
		const committed = readdirSync(schemasDir).filter((file) => file.endsWith('.schema.json'));
		expect(committed.sort()).toEqual(
			Object.keys(generated)
				.map((name) => `${name}.schema.json`)
				.sort(),
		);
		for (const [name, schema] of Object.entries(generated)) {
			const onDisk: unknown = JSON.parse(readFileSync(new URL(`${name}.schema.json`, schemasDir), 'utf8'));
			expect(onDisk, name).toEqual(schema);
		}
	});

	it('exports input shapes: defaulted fields (ParamSpec.required/sensitive) are optional', () => {
		const artifact = toJsonSchemas()['capability-artifact'] as {
			properties: { params: { items: { required: string[]; properties: Record<string, unknown> } } };
		};
		const param = artifact.properties.params.items;
		expect(param.properties).toHaveProperty('sensitive');
		expect(param.required).not.toContain('sensitive');
		expect(param.required).not.toContain('required');
		expect(param.required).toContain('name');
	});

	it('carries descriptions and closes objects (additionalProperties: false)', () => {
		const result = toJsonSchemas()['run-result'] as { description?: string };
		expect(result.description).toMatch(/success \| business_outcome \| failure/);
		expect(JSON.stringify(toJsonSchemas()['policy-config'])).toContain('"additionalProperties":false');
	});
});

describe('toJsonSchemas side effects', () => {
	it('leaves no ids in the global registry and keeps descriptions', () => {
		const before = z.globalRegistry.get(TargetRefSchema);
		toJsonSchemas();
		expect(z.globalRegistry.get(TargetRefSchema)).toEqual(before);
		expect(z.globalRegistry.get(TargetRefSchema)).not.toHaveProperty('id');
		const artifact = toJsonSchemas()['capability-artifact'] as { $defs: Record<string, { description?: string }> };
		expect(Object.keys(artifact.$defs)).toContain('TargetRef');
		expect(artifact.$defs['TargetRef']?.description).toBeTruthy();
	});
});
