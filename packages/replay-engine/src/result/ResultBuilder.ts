import type { ArtifactRef, EvidenceRef, FailureReason, RunId, RunResult } from '@idp/artifact-schema';
import type { Clock, EvidenceStore } from '@idp/evidence';
import type { Redactor } from '@idp/policy';
import { DialogPendingError, type Observation, type Surface } from '@idp/surface';
import type { ReplayErrorStep } from '../errors/ReplayError.js';
import { ReplayStateError } from '../errors/ReplayStateError.js';

type Success = Extract<RunResult, { kind: 'success' }>;

/** The run identity, redactor and evidence sinks a `ResultBuilder` builds results with. */
export interface ResultBuilderOptions {
	readonly runId: RunId;
	/** The artifact that ran; `null` until it has been validated (then `setArtifact`). */
	readonly artifact: ArtifactRef | null;
	readonly redactor: Redactor;
	readonly surface: Pick<Surface, 'captureEvidence' | 'observe'>;
	readonly evidence: Pick<EvidenceStore, 'putScreenshot' | 'putA11ySnapshot'>;
	readonly clock: Clock;
	readonly startedAt: Date;
}

/** The fields of a `failure` result, before redaction and evidence capture. */
export interface FailureInput {
	readonly reason: FailureReason;
	readonly step: ReplayErrorStep | null;
	readonly expected: string;
	readonly observed: string;
	readonly interventionRequestId?: string;
	/** Capture masked evidence of the screen (default true). False before any surface call (AC8). */
	readonly captureEvidence?: boolean;
}

const MAX_TEXT = 2000;
const LABEL_MAX = 60;

/** A screenshot label from a step id: lowercase kebab-case, at most 60 characters. */
function labelFor(step: ReplayErrorStep | null): string {
	const base = `failure-${step?.id ?? 'run'}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
	return base.slice(0, LABEL_MAX).replace(/-+$/, '');
}

/**
 * What can be recorded while a native dialog blocks the page: the frame structure (paths, names, urls, titles,
 * statuses), the observation tree (no DOM content is readable) and the dialog itself. Redacted before storing.
 */
function blockedPageSnapshot(observation: Observation) {
	return {
		pendingDialog: observation.pendingDialog,
		frames: observation.frames.map(({ path, name, url, title, status }) => ({ path, name, url, title, status })),
		tree: observation.tree,
	};
}

function codeOf(error: unknown): string {
	if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
	return error instanceof Error ? error.name : 'unknown error';
}

/**
 * Builds the three result kinds (invariant 4). Free text (`message`, `expected`, `observed`) is redacted here, so
 * the returned result is safe to show; outputs stay typed and raw for the caller (redact with
 * `redactResultForSink` before writing). A failure captures masked evidence — a masked screenshot and the redacted
 * a11y snapshot — and attaches the refs (AC13). If capture fails (e.g. a pending native dialog) the run still ends
 * with its failure: no ref, and `observed` says why (never swallowed silently).
 */
export class ResultBuilder {
	private artifact: ArtifactRef | null;

	constructor(private readonly options: ResultBuilderOptions) {
		this.artifact = options.artifact;
	}

	setArtifact(artifact: ArtifactRef | null): void {
		this.artifact = artifact;
	}

	durationMs(): number {
		return Math.max(0, this.options.clock.now().getTime() - this.options.startedAt.getTime());
	}

	success(input: Pick<Success, 'outputs' | 'drift' | 'recoveries'>): RunResult {
		return {
			kind: 'success',
			runId: this.options.runId,
			artifact: this.requireArtifact(),
			outputs: input.outputs,
			durationMs: this.durationMs(),
			drift: input.drift,
			recoveries: input.recoveries,
		};
	}

	businessOutcome(input: { readonly code: string; readonly message: string; readonly stepId: string }): RunResult {
		return {
			kind: 'business_outcome',
			runId: this.options.runId,
			artifact: this.requireArtifact(),
			code: input.code,
			message: this.text(input.message),
			stepId: input.stepId,
		};
	}

	async failure(input: FailureInput): Promise<RunResult> {
		const evidence: EvidenceRef[] = [];
		let observed = input.observed;
		if (input.captureEvidence ?? true) {
			try {
				const capture = await this.options.surface.captureEvidence(this.options.redactor);
				evidence.push(await this.options.evidence.putScreenshot(capture.screenshot, { label: labelFor(input.step) }));
				evidence.push(await this.options.evidence.putA11ySnapshot(capture.a11yTree));
			} catch (error) {
				observed =
					error instanceof DialogPendingError
						? `${observed}; ${await this.dialogEvidence(evidence)}`
						: `${observed}; evidence not captured (${codeOf(error)})`;
			}
		}
		return {
			kind: 'failure',
			runId: this.options.runId,
			artifact: this.artifact,
			reason: input.reason,
			step: input.step,
			expected: this.text(input.expected),
			observed: this.text(observed),
			evidence,
			...(input.interventionRequestId === undefined ? {} : { interventionRequestId: input.interventionRequestId }),
		};
	}

	/**
	 * A pending native dialog blocks page rendering: Chromium can neither screenshot nor read the DOM until it is
	 * settled, and the run never settles a dialog it was not told to. So no screenshot is taken (and no ref is
	 * faked); the redacted blocked-page snapshot is stored instead. Returns the note for `observed`.
	 */
	private async dialogEvidence(evidence: EvidenceRef[]): Promise<string> {
		const note = 'screenshot not captured (DIALOG_PENDING: a pending native dialog blocks page rendering)';
		try {
			const observation = await this.options.surface.observe();
			const snapshot = this.options.redactor.redact(blockedPageSnapshot(observation));
			evidence.push(await this.options.evidence.putA11ySnapshot(snapshot));
			return `${note}; the a11y snapshot holds the frame structure and the dialog only`;
		} catch (error) {
			return `${note}; a11y snapshot not captured (${codeOf(error)})`;
		}
	}

	private text(value: string): string {
		const redacted = this.options.redactor.redactString(value);
		return redacted.length <= MAX_TEXT ? redacted : `${redacted.slice(0, MAX_TEXT - 1)}…`;
	}

	private requireArtifact(): ArtifactRef {
		if (this.artifact === null) throw new ReplayStateError('a success or business outcome needs a validated artifact');
		return this.artifact;
	}
}
