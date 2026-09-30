import { z } from 'zod';
import { TargetRefSchema } from '../locator/TargetRef.js';

const DismissDialogRecoverySchema = z
	.strictObject({
		kind: z.literal('dismiss_dialog'),
		action: z.enum(['accept', 'dismiss']).describe('accept: OK. dismiss: Cancel/close.'),
	})
	.describe('Close the recognised native dialog, then continue the current step.');

const ClickThroughRecoverySchema = z
	.strictObject({
		kind: z.literal('click_through'),
		target: TargetRefSchema.describe('The control that closes the interstitial, e.g. a "Continue" link.'),
	})
	.describe('Click past an HTML interstitial (notice page, banner), then re-verify the current step.');

const RetryRecoverySchema = z
	.strictObject({
		kind: z.literal('retry'),
		max: z.int().min(1).max(5).describe('Maximum number of retries of the current step. Always bounded.'),
		backoffMs: z.int().min(0).max(60_000).describe('Delay before each retry, in milliseconds.'),
	})
	.describe('Re-run the current step (e.g. after a failed load). Never used for an irreversible step.');

const ReauthRecoverySchema = z
	.strictObject({ kind: z.literal('reauth') })
	.describe(
		'Sign on again: re-run the login-phase steps once, then the main steps up to the current one. Refused (session_lost) if an irreversible step already ran.',
	);

export const RecoverySchema = z
	.discriminatedUnion('kind', [
		DismissDialogRecoverySchema,
		ClickThroughRecoverySchema,
		RetryRecoverySchema,
		ReauthRecoverySchema,
	])
	.describe(
		'The deterministic, bounded response to a recoverable condition. Recovery is attempted at most once per step unless stated; exhausting it fails the run with recovery_exhausted.',
	);
export type Recovery = z.infer<typeof RecoverySchema>;
