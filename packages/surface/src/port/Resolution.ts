import type { LocatorRungKind } from '@idp/artifact-schema';
import type { ElementFingerprint } from './ElementFingerprint.js';

/** Which ladder rung resolved a target. `rungIndex > 0` means the target drifted from its primary rung. */
export interface Resolution {
	readonly rungIndex: number;
	readonly rungKind: LocatorRungKind;
	readonly fingerprint?: ElementFingerprint;
}
