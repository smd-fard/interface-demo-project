import type { CapabilityArtifact } from '@idp/artifact-schema';
import { createRedactor, type RedactionConfig } from '@idp/policy';
import { ConcreteValueLeakError } from '../errors/ConcreteValueLeakError.js';
import { containsValue } from './TextGuard.js';

/** The concrete values of a discovery run that must never appear in its artifact. */
export interface ConcreteValues {
	/** The example inputs (param values). */
	readonly exampleInputs: readonly string[];
	/** The sign-on credential values. */
	readonly credentials: readonly string[];
	/** The values extracted during discovery. */
	readonly extracted: readonly string[];
}

/** Options of `assertNoConcreteValues`. */
export interface AssertNoConcreteValuesOptions {
	/**
	 * The redaction rules (the policy's `redaction` section: patterns and terms). When set, every free-text
	 * string of the artifact must pass through them unchanged: a string the redactor would mask is a leak.
	 */
	readonly redaction?: RedactionConfig;
}

/** The `valueKind` of a string that the redaction rules would mask. */
export const REDACTION_RULE_MATCH = 'value matching a redaction rule';

const MIN_LENGTH = 2;

interface Scanned {
	readonly path: string;
	readonly text: string;
	/** A string VALUE of a free-text or literal field (not a key, not a structural identifier). */
	readonly freeText: boolean;
}

/**
 * Structural string fields: identifiers, versions, provenance and the caller-declared types. They carry no run
 * data and may legitimately hold digit runs (a run id, a semver, an enum of branch codes), so the redaction
 * rules are not applied to them. The concrete-value scan still covers them (except the param types).
 */
const STRUCTURAL: readonly RegExp[] = [
	/^(schemaVersion|id|version|credentialRef)$/,
	/^provenance(\.|$)/,
	/^steps\[\d+\]\.id$/,
	/^(params|outputs)\[\d+\]\.(name|type(\.|\[|$))/,
];

function isStructural(path: string): boolean {
	return STRUCTURAL.some((pattern) => pattern.test(path));
}

/**
 * The declared `example` of a NON-sensitive param is the author's chosen sample (e.g. a deposit amount
 * `250.00`), not run data, so the redaction rules skip it. A sensitive param's example, and any literal step
 * value (an amount must be a param reference), still go through the rules; the concrete-value scan covers all.
 */
function isNonSensitiveExample(parent: object, path: string, key: string): boolean {
	return key === 'example' && /^params\[\d+\]$/.test(path) && (parent as { sensitive?: unknown }).sensitive === false;
}

function paths(value: unknown, path: string, out: Scanned[], structural = false): void {
	if (typeof value === 'string') out.push({ path, text: value, freeText: !structural && !isStructural(path) });
	else if (Array.isArray(value)) value.forEach((item, index) => paths(item, `${path}[${index}]`, out));
	else if (value !== null && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			const childPath = path === '' ? key : `${path}.${key}`;
			// The content hash is hex over the canonical JSON: it carries no data and may contain any digit run.
			if (path === '' && key === 'contentHash') continue;
			// A param's type is the caller's declared contract (an enum lists its allowed values), not run data.
			if (key === 'type' && /^params\[\d+\]$/.test(path)) continue;
			out.push({ path: `${childPath} (key)`, text: key, freeText: false });
			paths(child, childPath, out, isNonSensitiveExample(value, path, key));
		}
	}
}

/**
 * Scans every string (and object key) of a compiled artifact for every example input, credential and
 * extracted value of at least 2 characters — case-insensitive, and at digit boundaries for values with digit
 * edges (as the redactor matches them). With `options.redaction`, it also runs every free-text string value
 * (titles, summary, descriptions, literal values, checkpoint and locator texts, outcome-rule texts, examples)
 * through the redaction patterns and terms: a string they would change holds data that looks sensitive (an
 * SSN, an account or member number, a configured name). Structural fields (the content hash, ids, versions,
 * provenance, param and output names and types, and the declared example of a non-sensitive param) are not
 * run through the rules. Any hit throws
 * `ConcreteValueLeakError`, naming the JSON path and the kind of value, never the value (invariant 3). The
 * last guard before `artifact.json` is written.
 */
export function assertNoConcreteValues(
	artifact: CapabilityArtifact,
	values: ConcreteValues,
	options: AssertNoConcreteValuesOptions = {},
): void {
	const strings: Scanned[] = [];
	paths(artifact, '', strings);
	const groups: [string, readonly string[]][] = [
		['example input', values.exampleInputs],
		['credential', values.credentials],
		['extracted value', values.extracted],
	];
	for (const { path, text } of strings) {
		for (const [kind, group] of groups) {
			for (const value of group) {
				const trimmed = value.trim();
				if (trimmed.length >= MIN_LENGTH && containsValue(text, trimmed)) throw new ConcreteValueLeakError(path, kind);
			}
		}
	}
	if (options.redaction === undefined) return;
	const redactor = createRedactor({ config: { redaction: options.redaction }, sensitiveValues: [] });
	for (const { path, text, freeText } of strings) {
		if (freeText && redactor.redactString(text) !== text) throw new ConcreteValueLeakError(path, REDACTION_RULE_MATCH);
	}
}
