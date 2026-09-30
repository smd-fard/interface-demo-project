import type { ActionKind, RiskClass } from '@idp/artifact-schema';

/** Who is about to act. The same intent gets the same verdict whoever the actor is (AC9). */
export type PolicyActor = 'agent' | 'replay' | 'human';

/**
 * What an actor is about to do, built by the guarded surface before it acts. `kind` is a plain string because
 * it can come straight from the model; an unregistered kind is denied, never thrown on.
 */
export interface ActionIntent {
	readonly actor: PolicyActor;
	readonly kind: string;
	/** The URL of the page the action happens on (top document). */
	readonly currentUrl: string;
	/** For `navigate`: the URL to load, absolute or relative to `currentUrl`. */
	readonly targetUrl?: string;
	/**
	 * For a click or press on a link or form control: where activating it would navigate (the link's `href`, the
	 * form's `action`), absolute or relative to `currentUrl`. An irreversible route here raises the risk, so an
	 * innocuous-named submit that posts to a commit endpoint still needs approval. May carry a query: redact
	 * before any sink.
	 */
	readonly destinationUrl?: string;
	/** The accessible name of the resolved target control, or the message of a native dialog. */
	readonly targetName?: string;
	/** The risk recorded on the step. It can only raise the classification, never lower it. */
	readonly declaredRisk?: RiskClass;
	/** The step being replayed, when there is one. */
	readonly stepId?: string;
}

/** An intent whose kind is a registered action kind. */
export type KnownActionIntent = ActionIntent & { readonly kind: ActionKind };
