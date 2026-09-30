import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { computeContentHash } from '../common/contentHash.js';
import { CapabilityArtifactSchema } from './CapabilityArtifact.js';

const FIXTURES = new URL('../../fixtures/', import.meta.url);
const INVALID = new URL('invalid/', FIXTURES);

const readJson = (url: URL): Record<string, unknown> =>
	JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
const validFiles = readdirSync(FIXTURES).filter((file) => file.endsWith('.artifact.json'));
const invalidFiles = readdirSync(INVALID).filter((file) => file.endsWith('.json'));

/** Each invalid fixture is member-lookup with one defect; this is the path the rejection must point at. */
const EXPECTED_PATH: Record<string, (string | number)[]> = {
	'concrete-member-number-literal.json': ['steps', 4, 'value'],
	'missing-checkpoint.json': ['steps', 5, 'checkpoint'],
	'undeclared-param.json': ['steps', 4, 'value', 'name'],
	'undeclared-placeholder.json': ['successCondition', 'text'],
	'wrong-schema-version.json': ['schemaVersion'],
	'raw-password-literal.json': ['steps', 2, 'value'],
	'raw-password-in-credential-ref.json': ['steps', 2, 'value'],
	'credential-ref-mismatch.json': ['steps', 1, 'value', 'ref'],
	'undeclared-output.json': ['steps', 7, 'output'],
	'duplicate-step-id.json': ['steps', 7, 'id'],
	'unknown-scope-step.json': ['outcomeRules', 0, 'scope', 0],
};

const memberLookup = () => structuredClone(readJson(new URL('member-lookup.artifact.json', FIXTURES)));
type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function issuePaths(input: unknown): PropertyKey[][] {
	const result = CapabilityArtifactSchema.safeParse(input);
	expect(result.success).toBe(false);
	return result.error?.issues.map((issue) => issue.path) ?? [];
}

describe('CapabilityArtifactSchema — fixtures', () => {
	it('has the two valid fixtures and one expectation per invalid fixture', () => {
		expect(validFiles.sort()).toEqual(['member-lookup.artifact.json', 'open-sub-account.artifact.json']);
		expect(invalidFiles.sort()).toEqual(Object.keys(EXPECTED_PATH).sort());
	});

	it.each(validFiles)('parses %s unchanged (every default is written out, so the hash is stable)', (file) => {
		const raw = readJson(new URL(file, FIXTURES));
		expect(CapabilityArtifactSchema.parse(raw)).toEqual(raw);
	});

	it.each(validFiles)('%s carries the correct contentHash', async (file) => {
		const raw = readJson(new URL(file, FIXTURES));
		expect(raw.contentHash).toBe(await computeContentHash(raw));
	});

	it('marks the Confirm click of open-sub-account irreversible', () => {
		const artifact = CapabilityArtifactSchema.parse(readJson(new URL('open-sub-account.artifact.json', FIXTURES)));
		const confirm = artifact.steps.find((step) => step.id === 's12-click-confirm');
		expect(confirm?.risk).toBe('irreversible');
	});

	it.each(invalidFiles)('rejects invalid/%s at the defect path', (file) => {
		const paths = issuePaths(readJson(new URL(file, INVALID)));
		const expected = EXPECTED_PATH[file] ?? [];
		expect(paths.some((path) => expected.every((key, index) => path[index] === key))).toBe(true);
	});
});

describe('CapabilityArtifactSchema — refinements', () => {
	it('accepts a declared param used as a route placeholder', () => {
		const artifact: Mutable = memberLookup();
		artifact.steps[0].route = '/member/detail?m={{memberId}}';
		expect(CapabilityArtifactSchema.safeParse(artifact).success).toBe(true);
	});

	it('rejects an output extracted twice and an output never extracted', () => {
		const twice: Mutable = memberLookup();
		twice.steps[7].output = 'savingsBalance';
		const paths = issuePaths(twice);
		expect(paths).toContainEqual(['steps', 7, 'output']);
		expect(paths).toContainEqual(['outputs', 1, 'name']);
	});

	it('rejects a sensitive param typed into a fill that is not marked sensitive', () => {
		const artifact: Mutable = memberLookup();
		artifact.steps[4].sensitive = false;
		expect(issuePaths(artifact)).toContainEqual(['steps', 4, 'sensitive']);
	});

	it('rejects a login step after a main step', () => {
		const artifact: Mutable = memberLookup();
		artifact.steps[5].phase = 'login';
		expect(issuePaths(artifact)).toContainEqual(['steps', 5, 'phase']);
	});

	it('rejects a credential step when the artifact declares no credentialRef', () => {
		const artifact: Mutable = memberLookup();
		delete artifact.credentialRef;
		expect(issuePaths(artifact)).toContainEqual(['steps', 1, 'value', 'ref']);
	});

	it('rejects unknown humanStepIds, duplicate params/outputs/outcome codes', () => {
		const human: Mutable = memberLookup();
		human.provenance.humanStepIds = ['s42-click-nowhere'];
		expect(issuePaths(human)).toContainEqual(['provenance', 'humanStepIds', 0]);

		const params: Mutable = memberLookup();
		params.params.push(params.params[0]);
		expect(issuePaths(params)).toContainEqual(['params', 1, 'name']);

		const rules: Mutable = memberLookup();
		rules.outcomeRules.push(rules.outcomeRules[0]);
		expect(issuePaths(rules)).toContainEqual(['outcomeRules', 6, 'code']);
	});

	it('rejects a replay run id as discovery provenance and a model id with spaces', () => {
		const run: Mutable = memberLookup();
		run.provenance.discoveryRunId = 'replay-20260929T101500-a1b2';
		expect(issuePaths(run)).toContainEqual(['provenance', 'discoveryRunId']);
		const model: Mutable = memberLookup();
		model.provenance.model = 'my prompt text';
		expect(issuePaths(model)).toContainEqual(['provenance', 'model']);
	});

	it('accepts an extends reference and rejects an empty steps list and unknown top-level keys', () => {
		const extended: Mutable = memberLookup();
		extended.extends = { baseId: 'member-lookup', baseVersion: '1.0.0' };
		expect(CapabilityArtifactSchema.safeParse(extended).success).toBe(true);

		const empty: Mutable = memberLookup();
		empty.steps = [];
		empty.outputs = [];
		empty.outcomeRules = [];
		expect(issuePaths(empty)).toContainEqual(['steps']);

		expect(issuePaths({ ...memberLookup(), origin: 'http://127.0.0.1:4010' })).toContainEqual([]);
	});

	it('exports to JSON Schema', () => {
		expect(() => z.toJSONSchema(CapabilityArtifactSchema)).not.toThrow();
	});
});
