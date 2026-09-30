import {
	InterventionRequestSchema,
	type EvidenceRef,
	type InterventionDecision,
	type InterventionId,
	type InterventionRequest,
	type OperatorActor,
	type RunId,
	type RunKind,
} from '@idp/artifact-schema';
import {
	newInterventionId,
	systemClock,
	systemRandom,
	type Clock,
	type EvidenceStore,
	type Random,
	type RunLog,
} from '@idp/evidence';
import type { Redactor } from '@idp/policy';
import type { ApprovalGrant, ApprovalGrantRegistry, EvidenceCapture, Surface } from '@idp/surface';
import { IllegalLeaseTransitionError } from '../errors/IllegalLeaseTransitionError.js';
import { InterventionConflictError } from '../errors/InterventionConflictError.js';
import { InterventionNotFoundError } from '../errors/InterventionNotFoundError.js';
import { InterventionTimeoutError } from '../errors/InterventionTimeoutError.js';
import { SessionValidationError } from '../errors/SessionValidationError.js';
import type { ControlLease } from '../lease/ControlLease.js';
import { redactInterventionRequest } from './redactInterventionRequest.js';

/** What the run is doing: a capability (replay) or a goal (discovery). */
export type InterventionSubject = InterventionRequest['subject'];
/** The step or action the run paused before. */
export type InterventionStep = InterventionRequest['currentStep'];

/** What a grant minted on approval is bound to: the replayed step, or the resolved target (agent). */
export interface GrantBindingInput {
	readonly stepId?: string;
	readonly fingerprintKey?: string;
}

/** What `InterventionService.raise` needs: the request kind, why, what the run is doing and where it stopped. */
export interface RaiseInterventionInput {
	readonly kind: InterventionRequest['kind'];
	/** `code`: stable snake_case. `text`: free text, redacted before it is stored. */
	readonly reason: InterventionRequest['reason'];
	readonly subject: InterventionSubject;
	readonly currentStep: InterventionStep;
	/**
	 * Approval only: what the grant binds to. Default: `{ stepId: currentStep.id }`. An approval with neither a
	 * stepId nor a fingerprintKey is refused (a grant must be bound).
	 */
	readonly grantBinding?: GrantBindingInput;
}

/** How a request was resolved; `grant` is present on an approval (in memory only, never persisted). */
export interface InterventionResolution {
	readonly decision: InterventionDecision;
	readonly by: OperatorActor;
	readonly at: string;
	readonly grant?: ApprovalGrant;
}

/** The collaborators of an `InterventionService`: the run identity, surface, redactor, sinks, lease and grants. */
export interface InterventionServiceOptions {
	readonly runId: RunId;
	readonly runKind: RunKind;
	/** The live session's surface, for the masked evidence at pause time (observation only). */
	readonly surface: Surface;
	readonly redactor: Redactor;
	readonly evidence: EvidenceStore;
	readonly runLog: RunLog;
	readonly lease: ControlLease;
	/** The session's grants: an approval mints one here; the policy-guarded surface consumes it. */
	readonly grants: ApprovalGrantRegistry;
	readonly clock?: Clock;
	readonly random?: Random;
}

interface Waiter {
	readonly resolve: (resolution: InterventionResolution) => void;
}

interface Entry {
	request: InterventionRequest;
	version: number;
	ref: EvidenceRef;
	resolution?: InterventionResolution;
	readonly binding?: GrantBindingInput;
	readonly waiters: Set<Waiter>;
}

const OPTIONS: Record<InterventionRequest['kind'], InterventionDecision[]> = {
	approval: ['approve', 'reject', 'aborted'],
	takeover: ['resumed', 'aborted'],
};

function typedCode(error: unknown): string | undefined {
	const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
	return typeof code === 'string' ? code : undefined;
}

/**
 * Intervention requests of one live session (R6.1): raising them with redacted context, persisting every
 * version, and resolving them for the control API.
 *
 * `raise` (1) captures masked evidence through the surface (a masked screenshot and the redacted a11y tree;
 * a typed capture failure — e.g. a native dialog blocking the page — leaves the refs null), (2) builds the
 * request from redacted text only and validates it against `InterventionRequestSchema`, (3) persists it as
 * `interventions/<id>.json`, (4) logs an `intervention` `raised` entry and (5) pauses the lease (AGENT →
 * PAUSED). Every status change is persisted again as a new version (`<id>-v2`, `<id>-v3`, …: evidence files
 * are never overwritten) and logged.
 *
 * Resolution: `claim` (takeover, open → claimed, lease PAUSED → HUMAN), `approve` (approval: mints a
 * single-use grant, lease PAUSED → RESUMING), `reject` (approval, lease PAUSED → CLOSED), `resume` (the claimed
 * takeover, lease HUMAN → RESUMING), `abort` (lease → CLOSED, every unresolved request aborted). The lease
 * transition runs first: when it is illegal, the request does not change. Operations are serialized.
 */
export class InterventionService {
	private readonly entries = new Map<string, Entry>();
	private queue: Promise<unknown> = Promise.resolve();
	private readonly clock: Clock;
	private readonly random: Random;

	constructor(private readonly options: InterventionServiceOptions) {
		this.clock = options.clock ?? systemClock;
		this.random = options.random ?? systemRandom;
	}

	/** Every request, in raise order (the latest version of each; redacted). */
	list(): readonly InterventionRequest[] {
		return [...this.entries.values()].map((entry) => entry.request);
	}

	/** The latest (redacted) version of one request, or undefined for an unknown id. */
	get(id: string): InterventionRequest | undefined {
		return this.entries.get(id)?.request;
	}

	/** The ref of the latest persisted version of a request. */
	refOf(id: string): EvidenceRef | undefined {
		return this.entries.get(id)?.ref;
	}

	/**
	 * Raises a request: masked evidence, redacted + validated request, persisted, logged, lease AGENT → PAUSED.
	 *
	 * @throws IllegalLeaseTransitionError when the lease is not `AGENT`.
	 * @throws SessionValidationError when the request does not match `InterventionRequestSchema` or an approval
	 *   has no grant binding.
	 */
	raise(input: RaiseInterventionInput): Promise<InterventionRequest> {
		return this.serialize(() => this.doRaise(input));
	}

	/**
	 * Resolves with the request's resolution (immediately if already resolved). Rejects with
	 * `InterventionTimeoutError` after `timeoutMs` (default: wait indefinitely), `InterventionNotFoundError` for
	 * an unknown id.
	 */
	awaitResolution(id: string, options: { readonly timeoutMs?: number } = {}): Promise<InterventionResolution> {
		const entry = this.entries.get(id);
		if (entry === undefined) return Promise.reject(new InterventionNotFoundError(id));
		if (entry.resolution !== undefined) return Promise.resolve(entry.resolution);
		return new Promise<InterventionResolution>((resolve, reject) => {
			let timer: NodeJS.Timeout | undefined;
			const waiter: Waiter = {
				resolve: (resolution) => {
					if (timer !== undefined) clearTimeout(timer);
					resolve(resolution);
				},
			};
			entry.waiters.add(waiter);
			const timeoutMs = options.timeoutMs;
			if (timeoutMs !== undefined) {
				timer = setTimeout(() => {
					entry.waiters.delete(waiter);
					reject(new InterventionTimeoutError(id, timeoutMs));
				}, timeoutMs);
			}
		});
	}

	/** Takeover: the operator takes control of the same live session (lease PAUSED → HUMAN). */
	claim(id: string, operator: OperatorActor): Promise<InterventionRequest> {
		return this.serialize(async () => {
			const entry = this.expect(id, 'claim', 'takeover', 'open');
			await this.options.lease.cede(operator);
			return this.update(entry, { ...entry.request, status: 'claimed' }, operator, 'claimed');
		});
	}

	/** Approval: mints a single-use grant for the pending action, then lease PAUSED → RESUMING. */
	approve(id: string, operator: OperatorActor): Promise<InterventionRequest> {
		return this.serialize(async () => {
			const entry = this.expect(id, 'approve', 'approval', 'open');
			const { lease, grants } = this.options;
			if (lease.state() !== 'PAUSED') throw new IllegalLeaseTransitionError(lease.state(), 'approve');
			const binding = entry.binding ?? {};
			const grant = grants.mint({
				requestId: id,
				...(binding.stepId === undefined ? {} : { stepId: binding.stepId }),
				...(binding.fingerprintKey === undefined ? {} : { fingerprintKey: binding.fingerprintKey }),
				grantedBy: operator,
			});
			await lease.approve(operator, entry.request.id);
			return this.resolveEntry(entry, 'approve', operator, grant);
		});
	}

	/** Approval: the operator refuses the pending action; lease PAUSED → CLOSED. */
	reject(id: string, operator: OperatorActor): Promise<InterventionRequest> {
		return this.serialize(async () => {
			const entry = this.expect(id, 'reject', 'approval', 'open');
			await this.options.lease.reject(operator);
			return this.resolveEntry(entry, 'reject', operator);
		});
	}

	/**
	 * The operator hands control back (lease HUMAN → RESUMING) and the claimed takeover is resolved `resumed`.
	 * A repeated resume is idempotent and returns null (nothing left to resolve).
	 */
	resume(operator: OperatorActor): Promise<InterventionRequest | null> {
		return this.serialize(async () => {
			await this.options.lease.resume(operator);
			const claimed = [...this.entries.values()].find(
				(entry) => entry.request.kind === 'takeover' && entry.request.status === 'claimed',
			);
			return claimed === undefined ? null : this.resolveEntry(claimed, 'resumed', operator);
		});
	}

	/** The operator ends the run: lease → CLOSED, every unresolved request resolved `aborted`. */
	abort(operator: OperatorActor): Promise<void> {
		return this.serialize(async () => {
			await this.options.lease.close(operator, 'operator aborted');
			for (const entry of this.entries.values()) {
				if (entry.request.status !== 'resolved') await this.resolveEntry(entry, 'aborted', operator);
			}
		});
	}

	private serialize<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queue.then(task);
		this.queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private expect(
		id: string,
		operation: string,
		kind: InterventionRequest['kind'],
		status: InterventionRequest['status'],
	): Entry {
		const entry = this.entries.get(id);
		if (entry === undefined) throw new InterventionNotFoundError(id);
		if (entry.request.kind !== kind) throw new InterventionConflictError(id, operation, 'wrong_kind');
		if (entry.request.status !== status) throw new InterventionConflictError(id, operation, 'wrong_status');
		return entry;
	}

	private newId(): InterventionId {
		for (let attempt = 0; attempt < 16; attempt += 1) {
			const id = newInterventionId(this.clock, this.random);
			if (!this.entries.has(id)) return id;
		}
		throw new SessionValidationError('id', 'could not allocate a unique intervention id');
	}

	private async doRaise(input: RaiseInterventionInput): Promise<InterventionRequest> {
		const { lease, redactor, evidence, runLog } = this.options;
		if (lease.state() !== 'AGENT') throw new IllegalLeaseTransitionError(lease.state(), 'pause');
		const binding: GrantBindingInput | undefined =
			input.kind === 'approval'
				? (input.grantBinding ?? (input.currentStep.id === undefined ? {} : { stepId: input.currentStep.id }))
				: undefined;
		if (binding !== undefined && binding.stepId === undefined && binding.fingerprintKey === undefined) {
			throw new SessionValidationError('grantBinding', 'an approval must bind its grant to a stepId or fingerprintKey');
		}

		const id = this.newId();
		const draft = await this.draft(id, input, null);
		this.validate(draft); // fail before any evidence is written

		const capture = await this.capture();
		const screenshotRef =
			capture === null ? null : await evidence.putScreenshot(capture.screenshot, { label: 'intervention' });
		const a11ySnapshotRef = capture === null ? null : await evidence.putA11ySnapshot(capture.a11yTree);
		const request = this.validate(await this.draft(id, input, { screenshotRef, a11ySnapshotRef }));

		const redacted = redactInterventionRequest(request, redactor);
		const ref = await evidence.putJson(id, redacted, 'interventions');
		const stored: InterventionRequest = redacted;
		this.entries.set(id, {
			request: stored,
			version: 1,
			ref,
			...(binding === undefined ? {} : { binding }),
			waiters: new Set(),
		});
		runLog.log({
			kind: 'intervention',
			at: this.clock.now().toISOString(),
			runId: this.options.runId,
			actor: lease.automationActor,
			requestId: id,
			interventionKind: input.kind,
			event: 'raised',
			requestRef: ref,
		});
		const why = `${input.reason.code}${input.currentStep.id === undefined ? '' : ` before ${input.currentStep.id}`}`;
		await lease.pause(why, id);
		return stored;
	}

	private async draft(
		id: InterventionId,
		input: RaiseInterventionInput,
		refs: Pick<InterventionRequest['state'], 'screenshotRef' | 'a11ySnapshotRef'> | null,
	): Promise<InterventionRequest> {
		const location = refs === null ? { url: 'about:blank', title: '' } : await this.options.surface.location();
		return redactInterventionRequest(
			{
				id,
				runId: this.options.runId,
				runKind: this.options.runKind,
				kind: input.kind,
				reason: input.reason,
				subject: input.subject,
				currentStep: input.currentStep,
				state: {
					url: location.url === '' ? 'about:blank' : location.url,
					title: location.title.slice(0, 500),
					screenshotRef: refs?.screenshotRef ?? null,
					a11ySnapshotRef: refs?.a11ySnapshotRef ?? null,
				},
				options: OPTIONS[input.kind],
				status: 'open',
				createdAt: this.clock.now().toISOString(),
			},
			this.options.redactor,
		);
	}

	private validate(request: InterventionRequest): InterventionRequest {
		const parsed = InterventionRequestSchema.safeParse(request);
		if (!parsed.success) {
			const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'))];
			throw new SessionValidationError(fields.join(', '), 'invalid intervention request');
		}
		return parsed.data;
	}

	/** Masked evidence at pause time, or null when the surface refuses with a typed error (e.g. a dialog). */
	private async capture(): Promise<EvidenceCapture | null> {
		try {
			return await this.options.surface.captureEvidence(this.options.redactor);
		} catch (error) {
			if (typedCode(error) === undefined) throw error;
			return null;
		}
	}

	private async update(
		entry: Entry,
		next: InterventionRequest,
		actor: OperatorActor,
		event: 'claimed' | 'resolved',
	): Promise<InterventionRequest> {
		const request = this.validate(next);
		const redacted = redactInterventionRequest(request, this.options.redactor);
		entry.version += 1;
		entry.ref = await this.options.evidence.putJson(`${request.id}-v${entry.version}`, redacted, 'interventions');
		entry.request = redacted;
		this.options.runLog.log({
			kind: 'intervention',
			at: this.clock.now().toISOString(),
			runId: this.options.runId,
			actor,
			requestId: request.id,
			interventionKind: request.kind,
			event,
			...(request.resolution === undefined ? {} : { decision: request.resolution.decision }),
			requestRef: entry.ref,
		});
		return entry.request;
	}

	private async resolveEntry(
		entry: Entry,
		decision: InterventionDecision,
		by: OperatorActor,
		grant?: ApprovalGrant,
	): Promise<InterventionRequest> {
		const at = this.clock.now().toISOString();
		const request = await this.update(
			entry,
			{ ...entry.request, status: 'resolved', resolution: { decision, by, at } },
			by,
			'resolved',
		);
		const resolution: InterventionResolution = { decision, by, at, ...(grant === undefined ? {} : { grant }) };
		entry.resolution = resolution;
		for (const waiter of entry.waiters) waiter.resolve(resolution);
		entry.waiters.clear();
		return request;
	}
}
