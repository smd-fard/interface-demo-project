import type { InterventionRequest } from '@idp/artifact-schema';
import type { Redacted, Redactor } from '@idp/policy';

/**
 * Redacts an intervention request before it reaches any sink (invariant 3): every free-text field — the
 * reason text, the discovery goal, the step description, the page URL and title — passes through the
 * redactor. Structural fields (ids, enums, timestamps, evidence refs, the operator actor) are kept verbatim:
 * the schema pins their formats, and masking would corrupt them (a sha256 may contain a 5-digit run).
 */
export function redactInterventionRequest(
	request: InterventionRequest,
	redactor: Redactor,
): Redacted<InterventionRequest> {
	const text = (value: string) => redactor.redactString(value) as string;
	const redacted: InterventionRequest = {
		...request,
		reason: { code: request.reason.code, text: text(request.reason.text) },
		subject: request.subject.kind === 'goal' ? { kind: 'goal', goal: text(request.subject.goal) } : request.subject,
		currentStep: { ...request.currentStep, description: text(request.currentStep.description) },
		state: { ...request.state, url: text(request.state.url), title: text(request.state.title) },
	};
	// Every free-text field above went through the redactor; the rest is structural.
	return redacted as Redacted<InterventionRequest>;
}
