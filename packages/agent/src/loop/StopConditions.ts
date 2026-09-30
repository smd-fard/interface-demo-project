import { systemClock, type Clock } from '@idp/evidence';
import { DiscoveryConfigError } from '../errors/DiscoveryConfigError.js';
import type { StopReason } from './DiscoveryOutcome.js';

/** The budgets and thresholds of a discovery run. */
export interface StopOptions {
	/** Model turns allowed (every turn counts, refused and failed ones too). Default 25. */
	readonly maxSteps: number;
	/** Wall-clock budget, on the injected clock. Default 300 000 ms. */
	readonly timeoutMs: number;
	/** This many consecutive no-progress turns (an action that left the screen unchanged) is a dead end. Default 3. */
	readonly deadEndRepeats: number;
	/** This many policy denials in a row stop the run. Default 3. */
	readonly policyBlockedLimit: number;
	/** This many finishes whose checkpoint did not hold stop the run. Default 2. */
	readonly unverifiedFinishLimit: number;
}

/** The default budgets: 25 turns, 300 s, 3 repeats, 3 denials, 2 unverified finishes. */
export const DEFAULT_STOP_OPTIONS: StopOptions = Object.freeze({
	maxSteps: 25,
	timeoutMs: 300_000,
	deadEndRepeats: 3,
	policyBlockedLimit: 3,
	unverifiedFinishLimit: 2,
});

/** One performed action, as the stop conditions see it. */
export interface ActionRecord {
	/** Digest of the observation before the action. */
	readonly before: string;
	/** Digest of the observation after it. */
	readonly after: string;
	/** True when the action moved the run forward without changing the screen (an extract). */
	readonly progress: boolean;
	/**
	 * True for an action that legitimately changes only a field value (a fill or select): an unchanged digest is
	 * expected, so it neither counts as a no-progress turn nor resets the count.
	 */
	readonly valueOnly?: boolean;
}

/**
 * The stop conditions of the discovery loop (AC2), as a small state machine. The loop calls `beforeTurn`
 * before each model call (budgets) and reports what each turn did; a method returns the stop reason when a
 * condition trips, else `null`.
 *
 * - `max_steps` / `timeout`: checked before a model call; the loop also bounds each call by `remainingMs()`.
 * - `dead_end`: one entry per performed action (turn). `deadEndRepeats` consecutive no-progress turns — actions
 *   whose post-action digest equals the pre-action digest, a value-only fill/select excepted — or an A-B-A-B
 *   oscillation over the screens visited. A screen change resets the no-progress count. Refused and failed
 *   actions are not in the window (they count toward the step budget and, for denials, `policy_blocked`);
 *   progress resets it.
 * - `policy_blocked`: `policyBlockedLimit` denials with no performed action in between.
 * - `goal_unverified`: `unverifiedFinishLimit` finishes whose checkpoint did not hold (not necessarily in a row).
 */
export class StopConditions {
	readonly options: StopOptions;
	readonly #clock: Clock;
	readonly #startedAt: number;
	#turns = 0;
	#window: string[] = [];
	#noProgress = 0;
	#denials = 0;
	#unverified = 0;

	constructor(options: Partial<StopOptions> & { readonly clock?: Clock } = {}) {
		const { clock, ...rest } = options;
		const merged = { ...DEFAULT_STOP_OPTIONS };
		for (const [name, value] of Object.entries(rest) as [keyof StopOptions, number | undefined][]) {
			if (value === undefined) continue;
			if (!Number.isInteger(value) || value < 1) throw new DiscoveryConfigError(name, 'must be a positive integer');
			merged[name] = value;
		}
		this.options = Object.freeze(merged);
		this.#clock = clock ?? systemClock;
		this.#startedAt = this.#clock.now().getTime();
	}

	/** Model turns counted so far. */
	get turns(): number {
		return this.#turns;
	}

	/** Milliseconds since the conditions were created, on the injected clock. */
	elapsedMs(): number {
		return this.#clock.now().getTime() - this.#startedAt;
	}

	/** Milliseconds left of the time budget (at least 1): the bound of the next model call. */
	remainingMs(): number {
		return Math.max(1, this.options.timeoutMs - this.elapsedMs());
	}

	/** Checked before each model call: `max_steps`, then `timeout`. */
	beforeTurn(): StopReason | null {
		if (this.#turns >= this.options.maxSteps) return 'max_steps';
		if (this.elapsedMs() >= this.options.timeoutMs) return 'timeout';
		return null;
	}

	/** Counts one model turn against the budget. */
	countTurn(): void {
		this.#turns += 1;
	}

	/** A performed action: resets the denial count, then checks for a dead end. */
	recordAction(record: ActionRecord): StopReason | null {
		this.#denials = 0;
		if (record.progress) {
			this.#window = [record.after];
			this.#noProgress = 0;
			return null;
		}
		// The window holds the distinct screens visited in order (no consecutive duplicates), for oscillation.
		if (this.#window.at(-1) !== record.before) this.#window.push(record.before);
		if (this.#window.at(-1) !== record.after) this.#window.push(record.after);
		if (record.after !== record.before) this.#noProgress = 0;
		else if (record.valueOnly !== true) this.#noProgress += 1;
		return this.#deadEnd() ? 'dead_end' : null;
	}

	/** Progress without an action (a declared output): resets the dead-end window. */
	recordProgress(): void {
		this.#window = [];
		this.#noProgress = 0;
	}

	/** A policy denial (or an unapproved irreversible action). */
	recordDenial(): StopReason | null {
		this.#denials += 1;
		return this.#denials >= this.options.policyBlockedLimit ? 'policy_blocked' : null;
	}

	/** A finish whose checkpoint did not hold. */
	recordUnverifiedFinish(): StopReason | null {
		this.#unverified += 1;
		return this.#unverified >= this.options.unverifiedFinishLimit ? 'goal_unverified' : null;
	}

	/** After a human handoff the screen is new ground: clears the dead-end window and the denial count. */
	resetAfterHandoff(): void {
		this.#window = [];
		this.#noProgress = 0;
		this.#denials = 0;
	}

	#deadEnd(): boolean {
		if (this.#noProgress >= this.options.deadEndRepeats) return true;
		const window = this.#window;
		const [a, b, c, d] = window.slice(-4);
		return window.length >= 4 && a !== b && a === c && b === d;
	}
}
