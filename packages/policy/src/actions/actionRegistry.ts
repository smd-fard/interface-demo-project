import { ACTION_KINDS, type ActionKind, type RiskClass } from '@idp/artifact-schema';

/** How the payload of an action is treated before it reaches any sink (invariant 3). */
export type PayloadRedaction =
	/** The action carries no free-form payload (a click, a key from a fixed allowlist, a route). */
	| 'none'
	/** The typed value is redacted in every sink (e.g. `fill`). */
	| 'value'
	/** The extracted value is redacted according to the output's `sensitive` flag (e.g. `extract`). */
	| 'extracted';

/** The policy entry of one action kind: the single source of its risk and allowlist handling (invariant 2). */
export interface ActionPolicyEntry {
	/** Risk class by effect on the bank system (not by UI gesture). It is the floor: rules only raise it. */
	readonly risk: RiskClass;
	/** The key checked against `allow.actions` of the policy config. */
	readonly allowlistKey: ActionKind;
	/** Whether the target (its accessible name, the route it acts on) can raise the risk, e.g. a "Confirm" click. */
	readonly raisableByTarget: boolean;
	/** How the payload is redacted before any sink. */
	readonly payloadRedaction: PayloadRedaction;
	/** Why the kind has this classification — for reviewers. */
	readonly rationale: string;
}

/**
 * The action registry: one entry per member of `ACTION_KINDS`. The `satisfies` clause makes a kind without an
 * entry a compile error (invariant 2). An `irreversible` classification is always handled conservatively:
 * `evaluateAction` returns `require_approval`, which the session turns into an intervention.
 */
export const ACTION_REGISTRY = Object.freeze({
	navigate: Object.freeze({
		risk: 'read',
		allowlistKey: 'navigate',
		raisableByTarget: false,
		payloadRedaction: 'none',
		rationale: 'Loads a route. The target route is allowlisted and irreversible routes raise it.',
	}),
	click: Object.freeze({
		risk: 'reversible',
		allowlistKey: 'click',
		raisableByTarget: true,
		payloadRedaction: 'none',
		rationale: 'Changes the screen. Raised to irreversible when the control commits a business change.',
	}),
	fill: Object.freeze({
		risk: 'reversible',
		allowlistKey: 'fill',
		raisableByTarget: false,
		payloadRedaction: 'value',
		rationale: 'Types into a field; nothing is committed until a submit. The typed value is redacted.',
	}),
	select: Object.freeze({
		risk: 'reversible',
		allowlistKey: 'select',
		raisableByTarget: false,
		payloadRedaction: 'none',
		rationale: 'Chooses an option; nothing is committed until a submit.',
	}),
	press: Object.freeze({
		risk: 'reversible',
		allowlistKey: 'press',
		raisableByTarget: true,
		payloadRedaction: 'none',
		rationale: 'Enter can submit a form, so the focused control can raise it like a click.',
	}),
	extract: Object.freeze({
		risk: 'read',
		allowlistKey: 'extract',
		raisableByTarget: false,
		payloadRedaction: 'extracted',
		rationale: 'Reads text only. The extracted value is redacted per the output sensitivity.',
	}),
	wait: Object.freeze({
		risk: 'read',
		allowlistKey: 'wait',
		raisableByTarget: false,
		payloadRedaction: 'none',
		rationale: 'Observes only.',
	}),
	dismiss_dialog: Object.freeze({
		risk: 'reversible',
		allowlistKey: 'dismiss_dialog',
		raisableByTarget: true,
		payloadRedaction: 'none',
		rationale: 'Closes a native dialog. Accepting a "Confirm transfer?" dialog commits, so its message can raise it.',
	}),
} as const satisfies Record<ActionKind, ActionPolicyEntry>);

const KINDS: ReadonlySet<string> = new Set(ACTION_KINDS);

/** Whether an arbitrary string (e.g. a tool name from the model) is a registered action kind. */
export function isActionKind(value: string): value is ActionKind {
	return KINDS.has(value);
}
