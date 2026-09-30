import {
	CapabilityArtifactSchema,
	computeContentHash,
	maxRisk,
	ParamSpecSchema,
	SCHEMA_VERSION,
	SCREEN_CHANGING_KINDS,
	type ActionKind,
	type AppProfile,
	type CapabilityArtifact,
	type Checkpoint,
	type OutputSpec,
	type ParamSpec,
	type RiskClass,
	type RunId,
	type Step,
	type TargetRef,
	type ValueExpr,
} from '@idp/artifact-schema';
import { systemClock, type Clock } from '@idp/evidence';
import { classifyRisk, type ResolvedPolicy } from '@idp/policy';
import { fingerprintKey } from '@idp/surface';
import type { z } from 'zod';
import { ArtifactCompileError } from '../errors/ArtifactCompileError.js';
import { UnparameterizedSensitiveValueError } from '../errors/UnparameterizedSensitiveValueError.js';
import type { DiscoveryTrace, TraceStep, TraceValue } from '../trace/DiscoveryTrace.js';
import { assertNoConcreteValues } from './assertNoConcreteValues.js';
import { buildLocatorLadder } from './buildLocatorLadder.js';
import { deriveCheckpoint } from './deriveCheckpoint.js';
import { createTextGuard, type TextGuard } from './TextGuard.js';

/** The inputs of `ArtifactCompiler.compile` besides the trace: goal, params, profile, policy and provenance. */
export interface CompileOptions {
	/** The discovery goal with `{{param}}` placeholders (the runner placeholderizes it). */
	readonly goal: string;
	/** The capability's params (defaults such as `required` / `sensitive` are filled in). */
	readonly params: readonly z.input<typeof ParamSpecSchema>[];
	/** The outputs; default: the outputs the model declared. Only extracted outputs are kept. */
	readonly outputs?: readonly OutputSpec[];
	/** The app profile: app identity, credential ref and the outcome rules copied into the artifact. */
	readonly profile: AppProfile;
	/** Each step's risk is classified against it (`classifyRisk`). */
	readonly policy: ResolvedPolicy;
	/** The discovery run (provenance); `null` when compiled from a recorded trace outside a run. */
	readonly runId: RunId | null;
	/** The id of the model that drove discovery, e.g. `scripted:member-lookup`. */
	readonly modelId: string | null;
	readonly clock?: Clock;
	/** Default: a kebab-case slug of the goal. */
	readonly id?: string;
	/** Default: the goal's first sentence. */
	readonly title?: string;
	/** Default `1.0.0`. */
	readonly version?: string;
	/**
	 * Concrete values of the run (example inputs, credentials, extracted values). Text containing one is never
	 * used as a locator or checkpoint; `assertNoConcreteValues` checks the result independently.
	 */
	readonly sensitiveValues?: readonly string[];
}

const SCREEN_CHANGING: ReadonlySet<ActionKind> = new Set(SCREEN_CHANGING_KINDS);
const PLACEHOLDER_HASH = `sha256:${'0'.repeat(64)}`;
const MAX_PROSE = 2000;
/**
 * Output types an extract parse can produce: `decimal` and `integer` have their own parse, and `text` yields a
 * string that `string`, `enum` and `date` validate. There is no boolean parse, so a `boolean` output would always
 * fail output validation at replay (`output_invalid`): the compiler refuses it instead.
 */
const EXTRACTABLE_OUTPUT_TYPES: ReadonlySet<string> = new Set(['string', 'integer', 'decimal', 'enum', 'date']);

/** A trace step that survived filtering, with its compiled target. */
interface Kept {
	readonly step: TraceStep;
	readonly target?: TargetRef;
}

function slug(text: string, maxWords = 4): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter((word) => word !== '')
		.slice(0, maxWords)
		.join('-');
}

function kebab(name: string): string {
	return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function firstSentence(text: string): string {
	const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
	const trimmed = sentence.trim().replace(/[.!?]$/, '');
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Compiles a successful discovery trace into a capability artifact (FR6–FR8), deterministically and without a
 * model:
 * 1. keeps only performed steps (`ok`: no refused or failed step);
 * 2. collapses repeated fills of the same target (the last value wins) and repeated navigations to the same
 *    route with nothing in between;
 * 3. turns `{{param}}` values into `param` ValueExprs and credential fills into `credential` refs to the
 *    profile's credential;
 * 4. tags the steps up to the first checkpoint after the last credential fill as phase `login`;
 * 5. classifies each step's risk with `classifyRisk` (an approved step is at least irreversible);
 * 6. copies `outcomeRules` from the profile;
 * 7. writes `summary` from the goal, params, outputs and outcome rules (templates, not a model);
 * 8. assigns stable step ids `sNN-<verb>-<what>`;
 * 9. computes `contentHash` over the schema-parsed artifact, so `parse(raw)` equals `raw`.
 * Locators come from `buildLocatorLadder`, checkpoints from `deriveCheckpoint` (a screen-changing step
 * without a verifiable change throws `UncheckpointableStepError`), and the verified finish becomes
 * `successCondition`. Throws `ArtifactCompileError` for a trace that did not meet its goal,
 * `UnparameterizedSensitiveValueError` for a sensitive fill that is no param or credential reference, and
 * `ConcreteValueLeakError` when a free-text field would be changed by the policy's redaction rules.
 */
export class ArtifactCompiler {
	/** The compiler version recorded in provenance. */
	static readonly VERSION = '0.1.0';

	/**
	 * Compiles a `goal_met` trace into a schema-valid capability artifact.
	 * @throws ArtifactCompileError when the goal was not met, no step is left, or the result is schema-invalid.
	 * @throws UnparameterizedSensitiveValueError when a sensitive fill is no param or credential reference.
	 * @throws UncheckpointableStepError when a screen-changing step has no verifiable change.
	 * @throws UnlocatableTargetError when no safe locator identifies an element.
	 * @throws ConcreteValueLeakError when a free-text field would be changed by the policy's redaction rules.
	 */
	async compile(trace: DiscoveryTrace, options: CompileOptions): Promise<CapabilityArtifact> {
		if (trace.finish === null) {
			throw new ArtifactCompileError(
				'GOAL_NOT_MET',
				'only a discovery run that met its goal compiles into an artifact',
			);
		}
		const guard = createTextGuard(options.sensitiveValues ?? []);
		const params: ParamSpec[] = options.params.map((param) => ParamSpecSchema.parse(param));
		const sensitiveParams = new Set(params.filter((param) => param.sensitive).map((param) => param.name));

		const kept = this.#keep(trace.steps);
		const outputsDeclared = options.outputs ?? trace.outputs;
		const extractedNames = new Set(
			kept.flatMap(({ step }) => (step.action.kind === 'extract' ? [step.action.output] : [])),
		);
		const outputs: OutputSpec[] = outputsDeclared
			.filter((output) => extractedNames.has(output.name))
			.map((output) => ({ ...output }));
		const unparsable = outputs.filter((output) => !EXTRACTABLE_OUTPUT_TYPES.has(output.type.kind));
		if (unparsable.length > 0) {
			throw new ArtifactCompileError(
				'UNSUPPORTED_OUTPUT_TYPE',
				`no extract parse produces a ${unparsable.map((output) => `${output.type.kind} (output ${output.name})`).join(', ')}; declare it as a string`,
			);
		}
		const outputTypes = new Map(outputs.map((output) => [output.name, output.type.kind]));
		if (kept.length === 0) throw new ArtifactCompileError('NO_STEPS', 'no performed step is left to compile');

		const loginEnd = this.#loginEnd(kept);
		const usedIds = new Set<string>();
		const steps: Step[] = kept.map(({ step, target }, position) => {
			const number = String(position + 1).padStart(2, '0');
			let id = `s${number}-${this.#idSuffix(step, target, guard, options.profile.loginRoute)}`
				.slice(0, 64)
				.replace(/-+$/, '');
			if (usedIds.has(id)) id = `s${number}-${kebab(step.action.kind).replace(/_/g, '-')}`;
			usedIds.add(id);
			const checkpoint = deriveCheckpoint(
				{ index: step.index, kind: step.action.kind, diff: step.diff, ...(target === undefined ? {} : { target }) },
				{ guard },
			);
			return this.#step(step, {
				id,
				phase: position <= loginEnd ? 'login' : 'main',
				risk: this.#risk(step, options.policy),
				checkpoint,
				target,
				credentialRef: options.profile.credentialRef,
				sensitiveParams,
				outputType: step.action.kind === 'extract' ? outputTypes.get(step.action.output) : undefined,
			});
		});

		const humanStepIds = steps.filter((_, index) => kept[index]?.step.actor === 'human').map((step) => step.id);
		const usesCredential = steps.some((step) => step.kind === 'fill' && step.value.kind === 'credential');
		const goal = options.goal.trim();
		const title = clip(options.title ?? firstSentence(goal), 200);
		const draft = {
			schemaVersion: SCHEMA_VERSION,
			id:
				options.id ??
				(slug(goal.replace(/\{\{[^}]*\}\}/g, ' '), 6)
					.slice(0, 64)
					.replace(/-+$/, '') ||
					'discovered-capability'),
			version: options.version ?? '1.0.0',
			title,
			summary: this.#summary({ goal, title, steps, params, outputs, profile: options.profile, usesCredential }),
			app: {
				vendorApp: options.profile.app.vendorApp,
				variant: options.profile.variant,
				...(options.profile.app.appVersion === undefined ? {} : { appVersion: options.profile.app.appVersion }),
			},
			provenance: {
				discoveryRunId: options.runId,
				compiledAt: (options.clock ?? systemClock).now().toISOString(),
				compilerVersion: ArtifactCompiler.VERSION,
				model: options.modelId,
				humanStepIds,
			},
			...(usesCredential ? { credentialRef: options.profile.credentialRef } : {}),
			params,
			outputs,
			steps,
			successCondition: trace.finish.finalCheckpoint,
			outcomeRules: structuredClone(options.profile.conditions),
			contentHash: PLACEHOLDER_HASH,
		};
		const parsed = CapabilityArtifactSchema.safeParse(draft);
		if (!parsed.success) {
			const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
			throw new ArtifactCompileError('INVALID_ARTIFACT', `the compiled artifact is invalid: ${issues.join('; ')}`);
		}
		const artifact = parsed.data;
		// Defence in depth (invariant 3): no free text of the artifact may hold what the redaction rules would mask.
		assertNoConcreteValues(
			artifact,
			{ exampleInputs: [], credentials: [], extracted: [] },
			{ redaction: options.policy.redaction },
		);
		return { ...artifact, contentHash: await computeContentHash(artifact) };
	}

	/** Steps 1–2: performed steps only; repeated fills of a target and repeated navigations collapse. */
	#keep(steps: readonly TraceStep[]): Kept[] {
		const kept: TraceStep[] = [];
		let fillsSinceChange = new Map<string, number>();
		for (const step of steps) {
			if (step.verdict !== 'ok') continue;
			const previous = kept.at(-1);
			if (
				step.action.kind === 'navigate' &&
				previous?.action.kind === 'navigate' &&
				previous.action.route === step.action.route
			) {
				continue; // the page is already there: a repeated navigation adds nothing
			}
			if (step.action.kind === 'fill' && step.fingerprint !== null) {
				const key = fingerprintKey(step.fingerprint);
				const earlier = fillsSinceChange.get(key);
				if (earlier !== undefined) kept.splice(earlier, 1, step);
				else {
					fillsSinceChange.set(key, kept.length);
					kept.push(step);
				}
				continue;
			}
			kept.push(step);
			if (SCREEN_CHANGING.has(step.action.kind)) fillsSinceChange = new Map();
		}
		return kept.map((step) => ({ step, ...this.#target(step) }));
	}

	#target(step: TraceStep): { target?: TargetRef } {
		if (step.fingerprint === null || step.action.kind === 'navigate' || step.action.kind === 'wait') return {};
		if (step.action.kind === 'dismiss_dialog') return {};
		return {
			target: buildLocatorLadder(step.fingerprint, {
				purpose: step.action.kind === 'extract' ? 'extract' : 'act',
				guard: createTextGuard(),
			}),
		};
	}

	/** Step 4: the index of the last login step — the first screen-changing step after the last credential fill. */
	#loginEnd(kept: readonly Kept[]): number {
		const lastCredential = kept.findLastIndex(
			({ step }) => step.action.kind === 'fill' && step.action.value.kind === 'credential',
		);
		if (lastCredential === -1) return -1;
		const submit = kept.findIndex(({ step }, index) => index > lastCredential && SCREEN_CHANGING.has(step.action.kind));
		return submit === -1 ? lastCredential : submit;
	}

	/** Step 5. */
	#risk(step: TraceStep, policy: ResolvedPolicy): RiskClass {
		const currentUrl = new URL(step.pageRoute, 'http://app.invalid').toString();
		const { risk } = classifyRisk(
			{
				actor: step.actor === 'human' ? 'human' : 'agent',
				kind: step.action.kind,
				currentUrl,
				...(step.action.kind === 'navigate' ? { targetUrl: step.action.route } : {}),
				...(step.fingerprint === null ? {} : { targetName: step.fingerprint.name }),
			},
			policy,
		);
		return step.approved === true ? maxRisk(risk, 'irreversible') : risk;
	}

	/** Step 8: `<verb>-<what>` from safe text only. */
	#idSuffix(step: TraceStep, target: TargetRef | undefined, guard: TextGuard, loginRoute: string): string {
		const what = (() => {
			const fingerprint = step.fingerprint;
			switch (step.action.kind) {
				case 'navigate': {
					const route = step.action.route.split('?')[0] ?? '';
					return route === loginRoute || route === '/' ? 'app' : slug(route.replace(/\{\{[^}]*\}\}/g, ''));
				}
				case 'extract':
					return kebab(step.action.output);
				case 'wait':
					return 'for-screen';
				case 'dismiss_dialog':
					return 'dialog';
				case 'press':
					return step.action.key.toLowerCase();
				default: {
					const candidates = [fingerprint?.name, fingerprint?.labelCellText, fingerprint?.visibleText];
					const text = candidates.find(
						(candidate): candidate is string => typeof candidate === 'string' && candidate !== '' && guard(candidate),
					);
					return text === undefined ? slug(target?.description.replace(/"[^"]*"/g, '') ?? '') : slug(text);
				}
			}
		})();
		const verb = step.action.kind === 'navigate' ? 'open' : step.action.kind.replace(/_/g, '-');
		return what === '' ? verb : `${verb}-${what}`;
	}

	#valueExpr(value: TraceValue, credentialRef: string): ValueExpr {
		switch (value.kind) {
			case 'param':
				return { kind: 'param', name: value.name };
			case 'credential':
				return { kind: 'credential', ref: credentialRef, field: value.field };
			case 'literal':
				return { kind: 'literal', value: value.value };
		}
	}

	#describeValue(value: ValueExpr): string {
		switch (value.kind) {
			case 'param':
				return `the ${value.name} param`;
			case 'credential':
				return `the operator ${value.field === 'username' ? 'user id' : 'password'} from the credential store (${value.ref})`;
			case 'literal':
				return JSON.stringify(value.value);
		}
	}

	#step(
		step: TraceStep,
		context: {
			readonly id: string;
			readonly phase: 'login' | 'main';
			readonly risk: RiskClass;
			readonly checkpoint: Checkpoint | undefined;
			readonly target: TargetRef | undefined;
			readonly credentialRef: string;
			readonly sensitiveParams: ReadonlySet<string>;
			readonly outputType: string | undefined;
		},
	): Step {
		const { target } = context;
		const desc = target?.description ?? 'the focused element';
		const base = {
			id: context.id,
			phase: context.phase,
			risk: context.risk,
			...(context.checkpoint === undefined ? {} : { checkpoint: context.checkpoint }),
		};
		const described = (text: string) => ({
			...base,
			description: clip(step.actor === 'human' ? `${text} (recorded from the operator)` : text, 500),
		});
		const need = (): TargetRef => {
			if (target === undefined)
				throw new ArtifactCompileError('INVALID_ARTIFACT', `trace step ${step.index} has no target`);
			return target;
		};
		const action = step.action;
		switch (action.kind) {
			case 'navigate':
				return { ...described(`Open ${action.route}.`), kind: 'navigate', route: action.route };
			case 'click':
				return { ...described(`Click ${desc}.`), kind: 'click', target: need() };
			case 'fill': {
				const value = this.#valueExpr(action.value, context.credentialRef);
				const sensitive =
					action.sensitive ||
					value.kind === 'credential' ||
					(value.kind === 'param' && context.sensitiveParams.has(value.name));
				// A sensitive value that is no param or credential (e.g. typed by an operator during a takeover) never
				// becomes a literal: fail before it reaches the step, its description or an error message.
				if (sensitive && value.kind === 'literal') throw new UnparameterizedSensitiveValueError(step.index, step.actor);
				return {
					...described(`Type ${this.#describeValue(value)} into ${desc}.`),
					kind: 'fill',
					target: need(),
					value,
					sensitive,
				};
			}
			case 'select': {
				const option = this.#valueExpr(action.option, context.credentialRef);
				return {
					...described(`Choose ${this.#describeValue(option)} in ${desc}.`),
					kind: 'select',
					target: need(),
					option,
				};
			}
			case 'press':
				return {
					...described(`Press ${action.key}${target === undefined ? '' : ` on ${desc}`}.`),
					kind: 'press',
					key: action.key,
					...(target === undefined ? {} : { target }),
				};
			case 'extract': {
				const parse =
					context.outputType === 'decimal' ? 'decimal' : context.outputType === 'integer' ? 'integer' : 'text';
				return {
					...described(`Read ${desc} into the ${action.output} output.`),
					kind: 'extract',
					target: need(),
					output: action.output,
					parse: { kind: parse },
				};
			}
			case 'wait':
				return {
					...described(`Wait until the ${action.until.kind.replace(/_/g, ' ')} check holds.`),
					kind: 'wait',
					until: action.until,
					timeoutMs: action.timeoutMs,
				};
			case 'dismiss_dialog':
				return {
					...described(`${action.action === 'accept' ? 'Accept' : 'Dismiss'} the dialog that says "${action.match}".`),
					kind: 'dismiss_dialog',
					match: action.match,
					action: action.action,
				};
		}
	}

	/** Step 7: the plain-language contract, from templates. */
	#summary(input: {
		readonly goal: string;
		readonly title: string;
		readonly steps: readonly Step[];
		readonly params: readonly ParamSpec[];
		readonly outputs: readonly OutputSpec[];
		readonly profile: AppProfile;
		readonly usesCredential: boolean;
	}): CapabilityArtifact['summary'] {
		const { steps, profile } = input;
		const login = steps.filter((step) => step.phase === 'login').length;
		const irreversible = steps.filter((step) => step.risk === 'irreversible').map((step) => step.id);
		const effect =
			irreversible.length === 0
				? 'It commits no irreversible change in the core system.'
				: `Irreversible steps (${irreversible.join(', ')}) change the core system and need a human approval at run time.`;
		const does = `Discovered from the goal "${input.goal}" on ${profile.app.vendorApp} (${profile.variant}): ${steps.length} steps${
			login > 0 ? `, the first ${login} signing on` : ''
		}. ${effect}`;
		const paramText =
			input.params.length === 0
				? 'No params.'
				: input.params
						.map(
							(param) =>
								`${param.name} (${param.type.kind}${param.required ? '' : ', optional'}${param.sensitive ? ', sensitive' : ''}): ${param.description}`,
						)
						.join(' ');
		const needs = `${paramText}${
			input.usesCredential
				? ` The operator credential is resolved at run time from the credential store (${profile.credentialRef}).`
				: ''
		}`;
		const outcomes = profile.conditions.filter((rule) => rule.class === 'business_outcome').map((rule) => rule.code);
		const returns = `On success: ${
			input.outputs.length === 0
				? 'no outputs'
				: input.outputs
						.map((output) => `${output.name} (${output.type.kind}${output.sensitive ? ', sensitive' : ''})`)
						.join(', ')
		}.${outcomes.length === 0 ? '' : ` Business outcomes: ${outcomes.join(', ')}.`}`;
		return { does: clip(does, MAX_PROSE), needs: clip(needs, MAX_PROSE), returns: clip(returns, MAX_PROSE) };
	}
}
