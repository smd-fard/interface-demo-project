import { z } from 'zod';
import {
	CapabilityIdSchema,
	ContentHashSchema,
	CredentialRefSchema,
	RunIdSchema,
	StepIdSchema,
	TenantIdSchema,
	VendorAppIdSchema,
} from '../common/Identifiers.js';
import { SemverSchema } from '../common/Semver.js';
import { templatePlaceholders } from '../common/TemplateString.js';
import { CheckpointSchema } from '../checkpoint/Checkpoint.js';
import { OutputSpecSchema } from '../io/OutputSpec.js';
import { ParamSpecSchema } from '../io/ParamSpec.js';
import { OutcomeRuleSchema } from '../outcome/OutcomeRule.js';
import { StepSchema } from '../step/Step.js';
import { SchemaVersionSchema } from '../version.js';

const prose = (what: string) => z.string().min(1).max(2000).describe(what);

const SummarySchema = z
	.strictObject({
		does: prose('What the capability does in the target app, in one or two sentences, including its side effects.'),
		needs: prose('What the caller must supply (params) and what is resolved at run time (credentials).'),
		returns: prose('What a success returns, and which business outcomes the caller should expect.'),
	})
	.describe('Plain-language contract for a reviewer and a calling agent (R2.7).');

const AppSchema = z
	.strictObject({
		vendorApp: VendorAppIdSchema,
		variant: TenantIdSchema,
		appVersion: z
			.string()
			.min(1)
			.max(100)
			.optional()
			.describe('The app version observed during discovery, e.g. "CoreOne 7.4".'),
	})
	.describe(
		'The app and tenant this capability was discovered against. Deliberately no origin: routes are relative, and the origin comes from the app profile/CLI at run time, so the artifact never pins an environment.',
	);

const ExtendsSchema = z
	.strictObject({
		baseId: CapabilityIdSchema.describe('Id of the base capability this one overrides.'),
		baseVersion: SemverSchema.describe('Version of the base capability.'),
	})
	.describe(
		'Reserved for a base-plus-tenant-overrides design (R7.2/S5): this artifact is a variant of the named base. Recorded only; no v1 engine reads it.',
	);

const ProvenanceSchema = z
	.strictObject({
		discoveryRunId: RunIdSchema.refine((id) => id.startsWith('discovery-'), {
			message: 'must be a discovery run id',
		})
			.nullable()
			.describe('The discovery run this artifact was compiled from (its evidence directory); null = hand-written.'),
		compiledAt: z.iso.datetime().describe('When the artifact was compiled (ISO 8601, UTC).'),
		compilerVersion: SemverSchema.describe('Version of the compiler that produced the artifact.'),
		model: z
			.string()
			.max(100)
			.regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/)
			.nullable()
			.describe(
				'Id of the model that drove discovery, e.g. "claude-sonnet-4-5" — the id only, never a prompt or transcript. null = no model (hand-written).',
			),
		humanStepIds: z
			.array(StepIdSchema)
			.max(200)
			.describe('Steps recorded from a human operator during a handoff rather than chosen by the model.'),
	})
	.describe('Where the artifact came from. Kept separate from the model transcript, which is never stored here.');

type Path = (string | number)[];

/** Every string under `value` with its path, for placeholder checks. */
function collectStrings(value: unknown, path: Path, out: { path: Path; text: string }[]): void {
	if (typeof value === 'string') out.push({ path, text: value });
	else if (Array.isArray(value)) value.forEach((item, index) => collectStrings(item, [...path, index], out));
	else if (value !== null && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) collectStrings(child, [...path, key], out);
	}
}

export const CapabilityArtifactSchema = z
	.strictObject({
		schemaVersion: SchemaVersionSchema,
		id: CapabilityIdSchema,
		version: SemverSchema.describe(
			'Version of this capability. Bump major when params/outputs change incompatibly, minor for new optional params/outputs, patch for locator or checkpoint fixes.',
		),
		title: z.string().min(1).max(200).describe('Short human-readable name, e.g. "Member lookup".'),
		summary: SummarySchema,
		app: AppSchema,
		extends: ExtendsSchema.optional(),
		provenance: ProvenanceSchema,
		credentialRef: CredentialRefSchema.optional().describe(
			'The one credential this capability signs on with. Every credential value in the steps must reference it; omitted = the capability uses no credential.',
		),
		params: z.array(ParamSpecSchema).max(50).describe('Typed inputs; names are unique.'),
		outputs: z
			.array(OutputSpecSchema)
			.max(50)
			.describe('Typed outputs returned on success; names are unique and each is extracted exactly once.'),
		steps: z
			.array(StepSchema)
			.min(1)
			.max(200)
			.describe('The deterministic steps, in order: login-phase steps first, then main steps. Ids are unique.'),
		successCondition: CheckpointSchema.describe(
			'Verified after the last step; the run is a success only if it holds (and every output validated).',
		),
		outcomeRules: z
			.array(OutcomeRuleSchema)
			.max(100)
			.describe('Runtime conditions specific to this capability; they override app-profile defaults by code.'),
		contentHash: ContentHashSchema,
	})
	.superRefine((artifact, ctx) => {
		const issue = (path: Path, message: string) => ctx.addIssue({ code: 'custom', path, message });

		const params = new Map<string, boolean>();
		artifact.params.forEach((param, index) => {
			if (params.has(param.name)) issue(['params', index, 'name'], `duplicate param "${param.name}"`);
			params.set(param.name, param.sensitive);
		});
		const outputs = new Set<string>();
		artifact.outputs.forEach((output, index) => {
			if (outputs.has(output.name)) issue(['outputs', index, 'name'], `duplicate output "${output.name}"`);
			outputs.add(output.name);
		});

		const stepIds = new Set<string>();
		const extracted = new Set<string>();
		let seenMain = false;
		artifact.steps.forEach((step, index) => {
			const at = (...rest: Path): Path => ['steps', index, ...rest];
			if (stepIds.has(step.id)) issue(at('id'), `duplicate step id "${step.id}"`);
			stepIds.add(step.id);

			if (step.phase === 'main') seenMain = true;
			else if (seenMain) issue(at('phase'), 'login-phase steps must all come before the first main step');

			const values =
				step.kind === 'fill'
					? [{ expr: step.value, key: 'value' }]
					: step.kind === 'select'
						? [{ expr: step.option, key: 'option' }]
						: [];
			for (const { expr, key } of values) {
				if (expr.kind === 'param') {
					const sensitive = params.get(expr.name);
					if (sensitive === undefined) issue(at(key, 'name'), `undeclared param "${expr.name}"`);
					else if (sensitive && step.kind === 'fill' && !step.sensitive) {
						issue(at('sensitive'), `param "${expr.name}" is sensitive, so this fill must be marked sensitive`);
					}
				}
				if (expr.kind === 'credential' && expr.ref !== artifact.credentialRef) {
					issue(
						at(key, 'ref'),
						artifact.credentialRef === undefined
							? 'the artifact declares no credentialRef'
							: `credential ref must be the artifact credentialRef "${artifact.credentialRef}"`,
					);
				}
			}

			if (step.kind === 'extract') {
				if (!outputs.has(step.output)) issue(at('output'), `undeclared output "${step.output}"`);
				else if (extracted.has(step.output)) issue(at('output'), `output "${step.output}" is extracted twice`);
				extracted.add(step.output);
			}
		});
		artifact.outputs.forEach((output, index) => {
			if (!extracted.has(output.name)) issue(['outputs', index, 'name'], `output "${output.name}" is never extracted`);
		});

		const strings: { path: Path; text: string }[] = [];
		collectStrings(artifact.steps, ['steps'], strings);
		collectStrings(artifact.successCondition, ['successCondition'], strings);
		collectStrings(artifact.outcomeRules, ['outcomeRules'], strings);
		for (const { path, text } of strings) {
			for (const name of templatePlaceholders(text)) {
				if (!params.has(name)) issue(path, `placeholder {{${name}}} names an undeclared param`);
			}
		}

		const codes = new Set<string>();
		artifact.outcomeRules.forEach((rule, index) => {
			if (codes.has(rule.code)) issue(['outcomeRules', index, 'code'], `duplicate outcome code "${rule.code}"`);
			codes.add(rule.code);
			if (rule.scope === 'any_step') return;
			rule.scope.forEach((id, scopeIndex) => {
				if (!stepIds.has(id)) issue(['outcomeRules', index, 'scope', scopeIndex], `unknown step id "${id}"`);
			});
		});

		artifact.provenance.humanStepIds.forEach((id, index) => {
			if (!stepIds.has(id)) issue(['provenance', 'humanStepIds', index], `unknown step id "${id}"`);
		});
	})
	.describe(
		'A capability artifact: a typed, versioned, deterministic program compiled from a successful discovery run and replayed with no model in the loop. Stores parameter references, never the concrete values used during discovery.',
	);
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;
