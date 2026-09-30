import { z } from 'zod';
import { OriginSchema } from '../common/Origin.js';
import { SemverSchema } from '../common/Semver.js';
import { isValidRegExp } from '../common/isValidRegExp.js';
import { ActionKindSchema } from '../step/ActionKind.js';

const RouteGlobSchema = z
	.string()
	.max(300)
	.regex(/^\/\S*$/)
	.describe(
		'A path glob relative to an origin, starting with "/": "*" matches within one segment, "**" across segments, e.g. "/member/**". No whitespace, no host.',
	);

const RegexSourceSchema = z
	.string()
	.min(1)
	.max(500)
	.refine(isValidRegExp, { message: 'must be a valid ECMAScript regular expression' });

const RouteRuleSchema = z
	.strictObject({
		origin: OriginSchema.describe('The allowed origin this rule applies to; must be listed in allow.origins.'),
		include: z.array(RouteGlobSchema).min(1).max(100).describe('Globs of routes the system may visit on this origin.'),
		exclude: z
			.array(RouteGlobSchema)
			.max(100)
			.describe(
				'Globs that are denied even when included, e.g. "/__admin/**". Required (may be empty) so a denial is always explicit.',
			),
	})
	.describe('Route allowlist for one origin. A route is allowed when it matches an include glob and no exclude glob.');

const RedactionPatternSchema = z
	.strictObject({
		name: z
			.string()
			.max(64)
			.regex(/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/)
			.describe('Pattern name, e.g. "ssn" or "member-number"; unique.'),
		regex: RegexSourceSchema.refine((source) => !isValidRegExp(source) || !new RegExp(source).test(''), {
			message: 'must not match the empty string',
		}).describe('ECMAScript regex source of values to mask (the redactor adds the "g" flag). Must not match "".'),
		mask: z
			.enum(['full', 'keep_last_2', 'keep_last_4'])
			.describe('full: replace the whole match. keep_last_2 / keep_last_4: mask all but the last 2 / 4 characters.'),
	})
	.describe('A redaction rule for a class of sensitive values (SSN-like, account-number-like, member-number-like).');

type Path = (string | number)[];

function flagDuplicates(values: readonly string[], path: (index: number) => Path, what: string, ctx: z.RefinementCtx) {
	const seen = new Set<string>();
	values.forEach((value, index) => {
		if (seen.has(value)) ctx.addIssue({ code: 'custom', path: path(index), message: `duplicate ${what} "${value}"` });
		seen.add(value);
	});
}

export const PolicyConfigSchema = z
	.strictObject({
		version: SemverSchema.describe('Version of this policy configuration.'),
		allow: z
			.strictObject({
				origins: z
					.array(OriginSchema)
					.min(1)
					.max(20)
					.describe(
						'Exact origins the system may act on. ${ENV} tokens are expanded by the loader, not by the schema. Anything else is denied.',
					),
				routes: z.array(RouteRuleSchema).max(20).describe('Route allowlist per origin.'),
				actions: z
					.array(ActionKindSchema)
					.min(1)
					.max(50)
					.describe('Action kinds that may run at all. An action kind not listed is denied.'),
			})
			.describe('The allowlist (R6.1): origins, routes and action kinds.'),
		irreversible: z
			.strictObject({
				controlNamePatterns: z
					.array(RegexSourceSchema.describe('Regex source matched against the target control name.'))
					.max(50)
					.describe(
						'Controls whose accessible name matches are irreversible (e.g. Confirm, Submit), whatever the declared risk.',
					),
				routes: z
					.array(RouteGlobSchema)
					.max(50)
					.describe('Routes on which any screen-changing action is irreversible, e.g. "/subaccount/confirm".'),
			})
			.describe('How the policy recognises irreversible actions. Risk is only ever raised by these, never lowered.'),
		redaction: z
			.strictObject({
				patterns: z.array(RedactionPatternSchema).max(50).describe('Regex rules; names are unique.'),
				terms: z
					.array(z.string().min(2).max(200))
					.max(500)
					.describe('Literal terms to mask wherever they appear, e.g. the synthetic member names of the mock bank.'),
			})
			.describe('Redaction rules applied before any sink (invariant 3), in addition to known sensitive values.'),
		approval: z
			.strictObject({
				expiresMs: z
					.int()
					.min(1)
					.max(86_400_000)
					.describe('How long an approval request stays answerable, in milliseconds (at most 24 h).'),
			})
			.describe('Approval settings for irreversible actions.'),
	})
	.superRefine((config, ctx) => {
		flagDuplicates(config.allow.origins, (index) => ['allow', 'origins', index], 'origin', ctx);
		flagDuplicates(config.allow.actions, (index) => ['allow', 'actions', index], 'action', ctx);
		const origins = new Set(config.allow.origins);
		config.allow.routes.forEach((rule, index) => {
			if (!origins.has(rule.origin)) {
				ctx.addIssue({
					code: 'custom',
					path: ['allow', 'routes', index, 'origin'],
					message: `origin "${rule.origin}" is not in allow.origins`,
				});
			}
		});
		flagDuplicates(
			config.redaction.patterns.map((pattern) => pattern.name),
			(index) => ['redaction', 'patterns', index, 'name'],
			'pattern name',
			ctx,
		);
	})
	.describe(
		'The action policy (R6): what the system may touch, which actions are irreversible, and what must be redacted. Every agent, replay and human action is checked against it (invariant 2).',
	);
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
