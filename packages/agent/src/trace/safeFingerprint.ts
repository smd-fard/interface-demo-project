import type { Redactor } from '@idp/policy';
import type { ElementFingerprint } from '@idp/surface';

/**
 * A copy of a fingerprint whose text fields are placeholderized (`{{memberId}}`) and masked, for the trace.
 * Structure (frame path, container kind and index, tag) is kept as is.
 */
export function safeFingerprint(fingerprint: ElementFingerprint, redactor: Redactor): ElementFingerprint {
	const text = (value: string) => redactor.placeholderize(value) as string;
	const nullable = (value: string | null) => (value === null ? null : text(value));
	return {
		...fingerprint,
		name: text(fingerprint.name),
		nameAttribute: nullable(fingerprint.nameAttribute),
		labelCellText: nullable(fingerprint.labelCellText),
		rowHeaderText: nullable(fingerprint.rowHeaderText),
		columnHeaderText: nullable(fingerprint.columnHeaderText),
		navigatesTo: nullable(fingerprint.navigatesTo),
		visibleText: text(fingerprint.visibleText),
		container:
			fingerprint.container === null
				? null
				: { ...fingerprint.container, containerText: nullable(fingerprint.container.containerText) },
	};
}
