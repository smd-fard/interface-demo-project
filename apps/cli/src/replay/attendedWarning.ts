/**
 * The warning for `--attended` without `--headed`: the browser runs headless, so nobody can take it over. The
 * operator console still approves, rejects or aborts; a takeover needs the visible window. Null when not needed.
 */
export function attendedWarning(flags: { readonly attended: boolean; readonly headed: boolean }): string | null {
	if (!flags.attended || flags.headed) return null;
	return (
		'warning: --attended without --headed runs the browser headless: the operator can approve, reject or abort ' +
		'from the console, but cannot take over the browser. Add --headed for a takeover.'
	);
}
