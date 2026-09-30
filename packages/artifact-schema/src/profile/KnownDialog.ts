import { z } from 'zod';
import { OutcomeCodeSchema } from '../common/Identifiers.js';

export const KnownDialogSchema = z
	.strictObject({
		code: OutcomeCodeSchema.describe('Condition code logged when the dialog is handled, e.g. "known_dialog".'),
		description: z.string().min(1).max(500).describe('What the dialog is and why it is safe to handle it this way.'),
		text: z
			.string()
			.min(1)
			.max(500)
			.describe('Text the native dialog message contains (normalized substring), e.g. "Scheduled maintenance".'),
		action: z.enum(['accept', 'dismiss']).describe('accept: OK. dismiss: Cancel/close.'),
	})
	.describe(
		'A native dialog the app is known to raise at unpredictable points. Replay handles it as a recoverable condition (a dialog_text signature with a dismiss_dialog recovery); any other dialog is a failure.',
	);
export type KnownDialog = z.infer<typeof KnownDialogSchema>;
