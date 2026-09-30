import {
	InterventionIdSchema,
	OperatorActorSchema,
	type Actor,
	type InterventionId,
	type LeaseState,
	type LeaseTransition,
	type OperatorActor,
} from '@idp/artifact-schema';
import { systemClock, type Clock } from '@idp/evidence';
import { IllegalLeaseTransitionError, type LeaseOperation } from '../errors/IllegalLeaseTransitionError.js';
import { SessionValidationError } from '../errors/SessionValidationError.js';

/** Who holds the live session: the automation (agent or replay), a human operator, or nobody. */
export type LeaseHolder = 'agent' | 'human' | 'none';

/** The automation actor of a run: `agent` for discovery, `replay` for replay. */
export type AutomationActor = 'agent' | 'replay';

/** Receives each applied transition, synchronously, after the state changed. */
export type LeaseListener = (transition: LeaseTransition) => void;

/** Configures a `ControlLease`: whose automation it guards, and the clock stamping each transition. */
export interface ControlLeaseOptions {
	/** The automation's actor: it pauses and reacquires. */
	readonly automationActor: AutomationActor;
	readonly clock?: Clock;
}

const MAX_REASON = 500;

/** The one state each operation is legal from, and where it leads (`close` is handled apart). */
const EDGES: Record<Exclude<LeaseOperation, 'close'>, { readonly from: LeaseState; readonly to: LeaseState }> = {
	pause: { from: 'AGENT', to: 'PAUSED' },
	cede: { from: 'PAUSED', to: 'HUMAN' },
	approve: { from: 'PAUSED', to: 'RESUMING' },
	reject: { from: 'PAUSED', to: 'CLOSED' },
	resume: { from: 'HUMAN', to: 'RESUMING' },
	reacquire: { from: 'RESUMING', to: 'AGENT' },
};

interface Request {
	readonly operation: LeaseOperation;
	readonly actor: Actor;
	readonly reason: string;
	readonly requestId?: InterventionId;
}

function checkOperator(operator: OperatorActor): OperatorActor {
	if (!OperatorActorSchema.safeParse(operator).success) {
		throw new SessionValidationError('operator', 'must be "operator:<handle>" (lowercase handle)');
	}
	return operator;
}

function checkReason(reason: string): string {
	const trimmed = reason.trim();
	if (trimmed.length === 0) throw new SessionValidationError('reason', 'must not be empty');
	return trimmed.slice(0, MAX_REASON);
}

/**
 * The control lease of a live session (FR20): an explicit state machine that says who is, or should be, in
 * control. One holder at a time — `AGENT` (the automation), `HUMAN` (an operator) — and nobody in `PAUSED`,
 * `RESUMING` and `CLOSED`.
 *
 * Legal transitions: `pause` AGENT → PAUSED, `cede` PAUSED → HUMAN, `approve` PAUSED → RESUMING, `reject`
 * PAUSED → CLOSED, `resume` HUMAN → RESUMING, `reacquire` RESUMING → AGENT (only after the caller re-verified
 * its checkpoint), `close` from any state. Transitions run through a promise queue, so concurrent calls apply
 * in call order. A duplicate of the transition just applied (a second `resume`, a second `reacquire`) is
 * idempotent: it resolves to the current state without recording anything. Any other illegal operation
 * rejects with `IllegalLeaseTransitionError` and changes nothing. Every applied transition is appended to
 * `history()` and sent to the `onChange` listeners (the live session logs them as `lease_change`).
 *
 * The lease itself holds no free text beyond the reasons it is given: callers pass redacted reasons, and the
 * run log redacts them again.
 */
export class ControlLease {
	private current: LeaseState = 'AGENT';
	private readonly transitions: LeaseTransition[] = [];
	private readonly listeners = new Set<LeaseListener>();
	private queue: Promise<unknown> = Promise.resolve();
	private requestId: InterventionId | undefined;
	private currentOperator: OperatorActor | null = null;
	private readonly clock: Clock;

	constructor(private readonly options: ControlLeaseOptions) {
		this.clock = options.clock ?? systemClock;
	}

	/** The automation actor (`agent` or `replay`). */
	get automationActor(): AutomationActor {
		return this.options.automationActor;
	}

	/** The current lease state. */
	state(): LeaseState {
		return this.current;
	}

	/** Who holds the lease now: `agent` in `AGENT`, `human` in `HUMAN`, otherwise `none`. */
	holder(): LeaseHolder {
		if (this.current === 'AGENT') return 'agent';
		if (this.current === 'HUMAN') return 'human';
		return 'none';
	}

	/** The operator holding the lease while `HUMAN`; otherwise null. */
	operator(): OperatorActor | null {
		return this.current === 'HUMAN' ? this.currentOperator : null;
	}

	/** Every applied transition, oldest first (a copy). */
	history(): readonly LeaseTransition[] {
		return [...this.transitions];
	}

	/** Subscribes to applied transitions; returns the unsubscribe function. */
	onChange(listener: LeaseListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** AGENT → PAUSED: the automation stops and an intervention request is open. */
	pause(reason: string, requestId?: InterventionId): Promise<LeaseState> {
		return this.enqueue(() => ({
			operation: 'pause',
			actor: this.options.automationActor,
			reason: checkReason(reason),
			...(requestId === undefined ? {} : { requestId: checkRequestId(requestId) }),
		}));
	}

	/** PAUSED → HUMAN: an operator takes control of the same live session. */
	cede(operator: OperatorActor, reason = 'operator took control'): Promise<LeaseState> {
		return this.enqueue(() => ({ operation: 'cede', actor: checkOperator(operator), reason: checkReason(reason) }));
	}

	/** PAUSED → RESUMING: an operator approved the pending irreversible action. */
	approve(operator: OperatorActor, requestId?: InterventionId, reason = 'operator approved'): Promise<LeaseState> {
		return this.enqueue(() => ({
			operation: 'approve',
			actor: checkOperator(operator),
			reason: checkReason(reason),
			...(requestId === undefined ? {} : { requestId: checkRequestId(requestId) }),
		}));
	}

	/** PAUSED → CLOSED: an operator rejected the pending irreversible action; the run ends. */
	reject(operator: OperatorActor, reason = 'operator rejected'): Promise<LeaseState> {
		return this.enqueue(() => ({ operation: 'reject', actor: checkOperator(operator), reason: checkReason(reason) }));
	}

	/** HUMAN → RESUMING: the operator hands control back. */
	resume(operator: OperatorActor, reason = 'operator resumed'): Promise<LeaseState> {
		return this.enqueue(() => ({ operation: 'resume', actor: checkOperator(operator), reason: checkReason(reason) }));
	}

	/** RESUMING → AGENT: call only after re-verifying the current checkpoint on the live screen. */
	reacquire(reason = 'checkpoint re-verified'): Promise<LeaseState> {
		return this.enqueue(() => ({
			operation: 'reacquire',
			actor: this.options.automationActor,
			reason: checkReason(reason),
		}));
	}

	/** Any state → CLOSED (a no-op when already closed). */
	close(actor: Actor, reason = 'session closed'): Promise<LeaseState> {
		return this.enqueue(() => ({
			operation: 'close',
			actor: actor === 'agent' || actor === 'replay' ? actor : checkOperator(actor),
			reason: checkReason(reason),
		}));
	}

	/** Resolves once every transition queued so far has been applied or refused. */
	async settled(): Promise<void> {
		await this.queue.then(
			() => undefined,
			() => undefined,
		);
	}

	private enqueue(build: () => Request): Promise<LeaseState> {
		const task = this.queue.then(() => this.apply(build()));
		// The queue continues whatever this task's outcome; the caller receives the outcome itself.
		this.queue = task.then(
			() => undefined,
			() => undefined,
		);
		return task;
	}

	private apply(request: Request): LeaseState {
		const from = this.current;
		let to: LeaseState;
		if (request.operation === 'close') {
			if (from === 'CLOSED') return from;
			to = 'CLOSED';
		} else {
			const edge = EDGES[request.operation];
			if (from !== edge.from) {
				const last = this.transitions.at(-1);
				if (last !== undefined && last.from === edge.from && last.to === edge.to && from === edge.to) return from;
				throw new IllegalLeaseTransitionError(from, request.operation);
			}
			to = edge.to;
		}

		if (request.operation === 'pause') this.requestId = request.requestId;
		else if (request.requestId !== undefined) this.requestId = request.requestId;
		if (request.operation === 'cede') this.currentOperator = request.actor as OperatorActor;

		const transition: LeaseTransition = {
			from,
			to,
			actor: request.actor,
			reason: request.reason,
			at: this.clock.now().toISOString(),
			...(this.requestId === undefined ? {} : { requestId: this.requestId }),
		};
		this.current = to;
		this.transitions.push(transition);
		if (to === 'AGENT' || to === 'CLOSED') this.requestId = undefined;
		if (to !== 'HUMAN') this.currentOperator = null;
		this.notify(transition);
		return to;
	}

	private notify(transition: LeaseTransition): void {
		const errors: unknown[] = [];
		for (const listener of [...this.listeners]) {
			try {
				listener(transition);
			} catch (error) {
				errors.push(error);
			}
		}
		// The transition is applied either way; listener failures reach the caller of the transition.
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, 'lease listeners failed');
	}
}

function checkRequestId(requestId: InterventionId): InterventionId {
	if (!InterventionIdSchema.safeParse(requestId).success) {
		throw new SessionValidationError('requestId', 'must be an intervention id "ir-<yyyymmddThhmmss>-<4hex>"');
	}
	return requestId;
}
