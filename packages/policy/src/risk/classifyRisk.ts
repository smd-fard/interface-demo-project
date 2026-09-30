import { maxRisk, SCREEN_CHANGING_KINDS, type ActionKind, type RiskClass } from '@idp/artifact-schema';
import { ACTION_REGISTRY } from '../actions/actionRegistry.js';
import type { ResolvedPolicy } from '../config/ResolvedPolicy.js';
import { urlParts } from '../config/urlParts.js';
import type { KnownActionIntent } from '../intent/ActionIntent.js';

/** The classified risk of an intent and the rules that raised it (pattern sources and globs, never values). */
export interface RiskClassification {
	readonly risk: RiskClass;
	readonly reasons: readonly string[];
}

const SCREEN_CHANGING: ReadonlySet<ActionKind> = new Set(SCREEN_CHANGING_KINDS);

const normalizeName = (name: string) => name.replace(/\s+/g, ' ').trim();

/**
 * The risk of an intent: the max of the registry risk, the declared step risk and the irreversible rules
 * (control-name patterns for kinds the target can raise; irreversible routes for screen-changing kinds — the
 * navigate target, or the page acted on, and also the `destinationUrl` of a click/press, i.e. the link href or
 * form action it would load). It never lowers the registry risk. Pure.
 */
export function classifyRisk(intent: KnownActionIntent, policy: ResolvedPolicy): RiskClassification {
	const entry = ACTION_REGISTRY[intent.kind];
	let risk: RiskClass = entry.risk;
	const reasons: string[] = [`registry: ${intent.kind} is ${entry.risk}`];

	if (intent.declaredRisk !== undefined && maxRisk(risk, intent.declaredRisk) !== risk) {
		risk = intent.declaredRisk;
		reasons.push(`declared step risk ${intent.declaredRisk}`);
	}

	if (entry.raisableByTarget && typeof intent.targetName === 'string') {
		const name = normalizeName(intent.targetName);
		for (const rule of policy.irreversibleControlNames) {
			if (rule.regex.test(name)) {
				risk = 'irreversible';
				reasons.push(`control name matches irreversible pattern /${rule.source}/`);
			}
		}
	}

	if (SCREEN_CHANGING.has(intent.kind)) {
		const parts =
			intent.kind === 'navigate' && typeof intent.targetUrl === 'string'
				? urlParts(intent.targetUrl, intent.currentUrl)
				: urlParts(intent.currentUrl);
		if (parts !== undefined) {
			for (const rule of policy.irreversibleRoutes) {
				if (rule.matches(parts.path)) {
					risk = 'irreversible';
					reasons.push(`route matches irreversible route ${rule.glob}`);
				}
			}
		}
		// Where a click or press would navigate (link href / form action): only ever raises.
		const destination =
			intent.kind !== 'navigate' && typeof intent.destinationUrl === 'string'
				? urlParts(intent.destinationUrl, intent.currentUrl)
				: undefined;
		if (destination !== undefined) {
			for (const rule of policy.irreversibleRoutes) {
				if (rule.matches(destination.path)) {
					risk = 'irreversible';
					reasons.push(`destination matches irreversible route ${rule.glob}`);
				}
			}
		}
	}

	return { risk, reasons };
}
