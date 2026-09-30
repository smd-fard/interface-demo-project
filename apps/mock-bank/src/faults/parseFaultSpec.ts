import { FaultSpecError } from '../errors/FaultSpecError.js';
import { FAULT_CODES, FAULT_DEFAULTS, isFaultCode, type FaultCode, type FaultMode } from './faultCodes.js';

/** A requested fault. `route` absent = the code's default routes. `delayMs` applies to `slow_load`. */
export interface FaultSpec {
	readonly code: FaultCode;
	readonly mode: FaultMode;
	readonly route?: string;
	readonly delayMs?: number;
}

/** Validates an admin JSON body `{ code, mode?, route?, delayMs? }`. */
export function parseFaultSpec(input: unknown): FaultSpec {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		throw new FaultSpecError('fault must be a JSON object { code, mode?, route?, delayMs? }');
	}
	const { code, mode, route, delayMs } = input as Record<string, unknown>;
	if (!isFaultCode(code)) {
		throw new FaultSpecError(`unknown fault code ${JSON.stringify(code)}; expected one of ${FAULT_CODES.join(', ')}`);
	}
	if (mode !== undefined && mode !== 'once' && mode !== 'always') {
		throw new FaultSpecError(`fault mode must be "once" or "always", got ${JSON.stringify(mode)}`);
	}
	if (route !== undefined && (typeof route !== 'string' || !route.startsWith('/'))) {
		throw new FaultSpecError(`fault route must be a path starting with "/", got ${JSON.stringify(route)}`);
	}
	if (delayMs !== undefined && (typeof delayMs !== 'number' || !Number.isInteger(delayMs) || delayMs < 0)) {
		throw new FaultSpecError(`fault delayMs must be a non-negative integer, got ${JSON.stringify(delayMs)}`);
	}
	return {
		code,
		mode: mode ?? FAULT_DEFAULTS[code].mode,
		...(route === undefined ? {} : { route }),
		...(delayMs === undefined ? {} : { delayMs }),
	};
}

/**
 * Parses `MOCKBANK_FAULTS`: a comma-separated list of `code[:mode][@route]`, e.g.
 * `app_error@/member/detail,known_dialog:always`. Empty or absent = no faults.
 */
export function parseFaultList(raw: string | undefined): FaultSpec[] {
	if (raw === undefined || raw.trim() === '') return [];
	return raw
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '')
		.map((entry) => {
			const match = /^([a-z_]+)(?::([a-z]+))?(?:@(\S+))?$/.exec(entry);
			if (!match) throw new FaultSpecError(`MOCKBANK_FAULTS entry "${entry}" is not code[:mode][@route]`);
			const [, code, mode, route] = match;
			return parseFaultSpec({ code, mode, route });
		});
}
