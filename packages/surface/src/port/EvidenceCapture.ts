import type { MaskedScreenshot, Redacted } from '@idp/policy';
import type { A11yNode } from './Observation.js';

/** Evidence ready for a sink: a masked screenshot and the redacted accessibility tree (invariant 3). */
export interface EvidenceCapture {
	readonly screenshot: MaskedScreenshot;
	readonly a11yTree: Redacted<A11yNode>;
	readonly url: Redacted<string>;
}
