import { FAULT_DEFAULTS, type FaultCode } from './faultCodes.js';
import type { FaultSpec } from './parseFaultSpec.js';
import { routeMatches } from './routeMatches.js';

/** An armed fault, as listed by `GET /__admin/faults`. */
export interface ArmedFault extends FaultSpec {
	/** How many times it has fired. */
	fired: number;
}

/**
 * The deterministic fault-injection switchboard. Faults fire only when armed (admin API or
 * `MOCKBANK_FAULTS`), never at random. A `once` fault disarms itself when it fires; an `always` fault stays
 * armed until cleared.
 */
export class FaultSwitch {
	private armed: ArmedFault[] = [];

	/** @param initial faults armed at start; `reset()` re-arms exactly these. */
	constructor(private readonly initial: readonly FaultSpec[] = []) {
		this.reset();
	}

	arm(spec: FaultSpec): void {
		this.armed.push({ ...spec, fired: 0 });
	}

	/** Disarms every fault. */
	clear(): void {
		this.armed = [];
	}

	/** Back to the start-up set (`MOCKBANK_FAULTS`). */
	reset(): void {
		this.armed = this.initial.map((spec) => ({ ...spec, fired: 0 }));
	}

	list(): readonly ArmedFault[] {
		return this.armed.map((fault) => ({ ...fault }));
	}

	/**
	 * Fires the first armed fault with `code` that applies to `path`, consuming it when its mode is `once`.
	 * Returns undefined when none applies.
	 */
	take(code: FaultCode, path: string): FaultSpec | undefined {
		const index = this.armed.findIndex((fault) => fault.code === code && appliesTo(fault, path));
		const fault = this.armed[index];
		if (!fault) return undefined;
		fault.fired += 1;
		if (fault.mode === 'once') this.armed.splice(index, 1);
		return toSpec(fault);
	}
}

function appliesTo(fault: FaultSpec, path: string): boolean {
	if (fault.route !== undefined) return routeMatches(fault.route, path);
	return FAULT_DEFAULTS[fault.code].routes.some((route) => routeMatches(route, path));
}

function toSpec(fault: ArmedFault): FaultSpec {
	return {
		code: fault.code,
		mode: fault.mode,
		...(fault.route === undefined ? {} : { route: fault.route }),
		...(fault.delayMs === undefined ? {} : { delayMs: fault.delayMs }),
	};
}
