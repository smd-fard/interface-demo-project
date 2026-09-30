import type { KnownDialog } from '@idp/artifact-schema';
import type { ResolvedRule } from './resolveRules.js';

/**
 * The app profile's known dialogs as condition rules (recoverable; a `dialog_text` signature; a `dismiss_dialog`
 * recovery with the configured action), evaluated after the artifact's and the profile's own rules. They are a
 * list, not one rule per code, so an artifact rule with the same code does not remove them.
 */
export function knownDialogRules(knownDialogs: readonly KnownDialog[]): ResolvedRule[] {
	return knownDialogs.map((dialog) => ({
		code: dialog.code,
		class: 'recoverable',
		description: dialog.description,
		signature: { kind: 'dialog_text', text: dialog.text },
		recovery: { kind: 'dismiss_dialog', action: dialog.action },
		source: 'profile',
	}));
}
