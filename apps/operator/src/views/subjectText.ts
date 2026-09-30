import type { InterventionRequest } from '@idp/artifact-schema';

/** What the run is doing, as one line: `member-lookup@1.0.0` (replay) or the redacted goal (discovery). */
export function subjectText(request: InterventionRequest): string {
	const { subject } = request;
	return subject.kind === 'capability' ? `${subject.id}@${subject.version}` : subject.goal;
}
