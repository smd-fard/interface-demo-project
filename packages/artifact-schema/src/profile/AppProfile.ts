import { z } from 'zod';
import { CredentialRefSchema, TenantIdSchema, VendorAppIdSchema } from '../common/Identifiers.js';
import { OriginSchema } from '../common/Origin.js';
import { RouteSchema } from '../common/Route.js';
import { OutcomeRuleSchema } from '../outcome/OutcomeRule.js';
import { KnownDialogSchema } from './KnownDialog.js';

export const AppProfileSchema = z
	.strictObject({
		app: z
			.strictObject({
				vendorApp: VendorAppIdSchema,
				appVersion: z
					.string()
					.min(1)
					.max(100)
					.optional()
					.describe('The version string the app reports, e.g. "CoreOne 7.4".'),
			})
			.describe('Which vendor application this profile describes.'),
		variant: TenantIdSchema,
		origin: OriginSchema.describe(
			'Where the app is served: a URL origin such as "http://127.0.0.1:4010", or an environment token such as "${MOCKBANK_ORIGIN}" expanded by the loader. Artifact routes are resolved against it.',
		),
		loginRoute: RouteSchema.describe('Route that shows the sign-on screen, e.g. "/".'),
		credentialRef: CredentialRefSchema,
		conditions: z
			.array(OutcomeRuleSchema)
			.max(100)
			.describe(
				'Default outcome rules for every capability of this app. An artifact rule with the same code overrides the default. Scope must be "any_step": a profile has no steps.',
			),
		knownDialogs: z
			.array(KnownDialogSchema)
			.max(50)
			.describe('Native dialogs this app is known to raise that replay may handle.'),
	})
	.superRefine((profile, ctx) => {
		const seen = new Set<string>();
		profile.conditions.forEach((rule, index) => {
			if (rule.scope !== 'any_step') {
				ctx.addIssue({
					code: 'custom',
					path: ['conditions', index, 'scope'],
					message: 'a profile default condition must be scoped to "any_step"',
				});
			}
			if (seen.has(rule.code)) {
				ctx.addIssue({
					code: 'custom',
					path: ['conditions', index, 'code'],
					message: `duplicate condition code "${rule.code}"`,
				});
			}
			seen.add(rule.code);
		});
	})
	.describe(
		'Per-app, per-tenant configuration read by the compiler and replay: where the app lives, how to sign on, and how its runtime conditions look. Holds a credential reference, never a secret.',
	);
export type AppProfile = z.infer<typeof AppProfileSchema>;
