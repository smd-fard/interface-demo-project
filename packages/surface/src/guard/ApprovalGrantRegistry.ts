import type { Clock } from '@idp/evidence';
import { ApprovalGrantError } from '../errors/ApprovalGrantError.js';
import type { GrantRejection } from '../errors/ApprovalRequiredError.js';
import type { ApprovalGrant } from './ApprovalGrant.js';

/** What the session asks for when an operator approves an intervention. */
export interface MintGrantRequest {
	readonly requestId: string;
	readonly stepId?: string;
	readonly fingerprintKey?: string;
	readonly grantedBy: string;
	/** Lifetime; default: the registry's `defaultTtlMs` (the policy's `approval.expiresMs`). */
	readonly ttlMs?: number;
}

/** The action a grant is presented with: its step and the key of its resolved target. */
export interface GrantBinding {
	readonly stepId?: string;
	readonly fingerprintKey?: string;
}

/** The outcome of presenting a grant. */
export type GrantCheck = { readonly kind: 'accepted' } | { readonly kind: 'rejected'; readonly reason: GrantRejection };

/** Options for `ApprovalGrantRegistry`: the clock that expiry is judged by and the default grant lifetime. */
export interface ApprovalGrantRegistryOptions {
	readonly clock: Clock;
	/** Default grant lifetime in ms (default 300 000, the policy default). */
	readonly defaultTtlMs?: number;
}

const DEFAULT_TTL_MS = 300_000;

const sameGrant = (a: ApprovalGrant, b: ApprovalGrant) =>
	a.requestId === b.requestId &&
	a.stepId === b.stepId &&
	a.fingerprintKey === b.fingerprintKey &&
	a.issuedAt === b.issuedAt &&
	a.expiresAt === b.expiresAt &&
	a.grantedBy === b.grantedBy;

/**
 * The grants a session has minted, shared by the session (which mints) and the policy-guarded surface (which
 * consumes). A grant is accepted once: it must be one this registry minted (a forged or altered grant is
 * `unknown`), unused (`reused`), unexpired (`expired`) and bound to the same stepId or target (`mismatch`).
 * A mismatched presentation does not consume it. In memory only.
 */
export class ApprovalGrantRegistry {
	private readonly issued = new Map<string, { readonly grant: ApprovalGrant; consumed: boolean }>();

	constructor(private readonly options: ApprovalGrantRegistryOptions) {}

	mint(request: MintGrantRequest): ApprovalGrant {
		if (request.stepId === undefined && request.fingerprintKey === undefined) {
			throw new ApprovalGrantError('unbound', request.requestId);
		}
		if (this.issued.has(request.requestId)) throw new ApprovalGrantError('duplicate_request', request.requestId);
		const now = this.options.clock.now();
		const ttl = request.ttlMs ?? this.options.defaultTtlMs ?? DEFAULT_TTL_MS;
		const grant: ApprovalGrant = Object.freeze({
			requestId: request.requestId,
			...(request.stepId === undefined ? {} : { stepId: request.stepId }),
			...(request.fingerprintKey === undefined ? {} : { fingerprintKey: request.fingerprintKey }),
			issuedAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + ttl).toISOString(),
			grantedBy: request.grantedBy,
		});
		this.issued.set(grant.requestId, { grant, consumed: false });
		return grant;
	}

	/** Checks a presented grant against the action and, when accepted, marks it used. */
	consume(grant: ApprovalGrant, binding: GrantBinding): GrantCheck {
		const entry = this.issued.get(grant.requestId);
		if (entry === undefined || !sameGrant(entry.grant, grant)) return { kind: 'rejected', reason: 'unknown' };
		if (entry.consumed) return { kind: 'rejected', reason: 'reused' };
		if (this.options.clock.now().getTime() >= Date.parse(entry.grant.expiresAt)) {
			return { kind: 'rejected', reason: 'expired' };
		}
		const byStep = entry.grant.stepId !== undefined && entry.grant.stepId === binding.stepId;
		const byTarget = entry.grant.fingerprintKey !== undefined && entry.grant.fingerprintKey === binding.fingerprintKey;
		if (!byStep && !byTarget) return { kind: 'rejected', reason: 'mismatch' };
		entry.consumed = true;
		return { kind: 'accepted' };
	}
}

/** Mints a single-use grant in `registry` (the helper the session calls on an approval). */
export function mintApprovalGrant(registry: ApprovalGrantRegistry, request: MintGrantRequest): ApprovalGrant {
	return registry.mint(request);
}

/** Presents `grant` for an action; see `ApprovalGrantRegistry.consume`. */
export function consumeGrant(registry: ApprovalGrantRegistry, grant: ApprovalGrant, binding: GrantBinding): GrantCheck {
	return registry.consume(grant, binding);
}
