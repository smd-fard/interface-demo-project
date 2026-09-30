/** Whether a checkpoint held. `observed` says what was on screen instead (never a raw value on purpose). */
export type CheckResult =
	| { readonly kind: 'held' }
	| {
			readonly kind: 'not_held';
			/** What was seen instead, e.g. `text "Member Inquiry" not present in frame content`. */
			readonly observed: string;
	  };
