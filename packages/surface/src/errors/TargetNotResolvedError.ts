import type { LocatorRungKind } from '@idp/artifact-schema';

/** What one ladder rung matched: `0` (nothing) or more than one (ambiguous); `error` when counting failed. */
export interface RungObservation {
	readonly index: number;
	readonly kind: LocatorRungKind;
	readonly matches: number;
	readonly error?: string;
}

/** No rung of a target's ladder matched exactly one element (after one re-resolution of the frame). */
export class TargetNotResolvedError extends Error {
	readonly code = 'TARGET_UNRESOLVED' as const;

	constructor(
		/** The target's description (never a selector or a value). */
		readonly target: string,
		readonly rungs: readonly RungObservation[],
	) {
		const detail = rungs.map((rung) => `rung ${rung.index} ${rung.kind}: ${rung.matches} matches`).join('; ');
		super(`target "${target}" not resolved (${detail})`);
		this.name = 'TargetNotResolvedError';
	}
}
