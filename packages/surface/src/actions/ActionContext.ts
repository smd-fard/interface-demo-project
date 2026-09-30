import type { Frame, Locator, Page } from 'playwright';
import type { DialogMonitor } from '../dialogs/DialogMonitor.js';
import type { NavigationTracker } from '../playwright/NavigationTracker.js';
import type { Bindings } from '../port/Bindings.js';
import type { CheckResult } from '../port/CheckResult.js';
import type { Checkpoint } from '@idp/artifact-schema';
import type { Resolution } from '../port/Resolution.js';
import type { ActionTarget } from '../port/SurfaceAction.js';

/** A resolved action target: the element's frame and strict locator, and (for a ladder) the winning rung. */
export interface ResolvedTarget {
	readonly frame: Frame;
	readonly locator: Locator;
	/** Present for a TargetRef ladder; absent for an observation ref. */
	readonly resolution?: Resolution;
}

/** What an action executor gets from the web surface (internal: holds Playwright objects). */
export interface ActionContext {
	readonly page: Page;
	/** Base for relative routes, e.g. `http://127.0.0.1:4010`. */
	readonly origin: string;
	readonly dialogs: DialogMonitor;
	readonly navigation: Pick<NavigationTracker, 'lastNavigation' | 'loadCount' | 'isQuiet' | 'now'>;
	/** Resolves a TargetRef (ladder) or an observation ref to one element. */
	resolveTarget(target: ActionTarget, bindings: Bindings): Promise<ResolvedTarget>;
	/** Polls a checkpoint until it holds or the timeout passes (for `wait`). */
	check(checkpoint: Checkpoint, bindings: Bindings, timeoutMs: number): Promise<CheckResult>;
}
