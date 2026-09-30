import type { Clock } from '@idp/evidence';
import type { Frame, Page, Request } from 'playwright';
import type { NavigationInfo } from '../port/Observation.js';
import { framePathOf } from '../locators/FrameResolver.js';

interface Load {
	readonly url: string;
	readonly status: number | null;
	readonly durationMs: number;
	readonly frame: Frame;
}

function frameOf(request: Request): Frame | null {
	try {
		return request.frame();
	} catch {
		return null; // a service-worker request has no frame
	}
}

/**
 * Records every document load (top document and frames): its HTTP status and duration, for the
 * `http_status` condition signatures and for `Observation.lastNavigation`. It also tracks navigations in
 * flight (request sent, document not yet committed), so an action can wait for the loads it started: a
 * legacy form submit navigates a frame, and Playwright does not wait for that after a click.
 */
export class NavigationTracker {
	private readonly started = new WeakMap<Request, number>();
	private readonly byFrame = new WeakMap<Frame, Load>();
	private last: Load | null = null;
	private count = 0;
	private readonly inFlight = new Set<Frame>();
	private lastActivity: number;

	constructor(
		page: Page,
		private readonly clock: Clock,
	) {
		this.lastActivity = clock.now().getTime();
		page.on('request', (request) => {
			if (!request.isNavigationRequest()) return;
			this.started.set(request, this.clock.now().getTime());
			const frame = frameOf(request);
			if (frame !== null) this.inFlight.add(frame);
			this.touch();
		});
		page.on('response', (response) => {
			const request = response.request();
			if (!request.isNavigationRequest()) return;
			this.record(request, response.status());
			// 204/205 never commit a document: the navigation ends here.
			const frame = frameOf(request);
			if (frame !== null && (response.status() === 204 || response.status() === 205)) this.inFlight.delete(frame);
			this.touch();
		});
		page.on('requestfailed', (request) => {
			if (!request.isNavigationRequest()) return;
			this.record(request, null);
			const frame = frameOf(request);
			if (frame !== null) this.inFlight.delete(frame);
			this.touch();
		});
		page.on('framenavigated', (frame) => {
			this.inFlight.delete(frame);
			this.touch();
		});
		page.on('framedetached', (frame) => {
			this.inFlight.delete(frame);
			this.touch();
		});
	}

	private touch(): void {
		this.lastActivity = this.clock.now().getTime();
	}

	/**
	 * True when no navigation is in flight and none started, answered or committed in the last `quietMs`
	 * (counted from `since` at the earliest, e.g. the end of the gesture).
	 */
	isQuiet(quietMs: number, since: number): boolean {
		return this.inFlight.size === 0 && this.clock.now().getTime() - Math.max(this.lastActivity, since) >= quietMs;
	}

	/** Now, on the tracker's clock. */
	now(): number {
		return this.clock.now().getTime();
	}

	private record(request: Request, status: number | null): void {
		// Redirect hops are recorded as the final response arrives; the last one wins.
		const start = this.started.get(request) ?? this.clock.now().getTime();
		const frame = frameOf(request);
		if (frame === null) return;
		const load: Load = { url: request.url(), status, durationMs: this.clock.now().getTime() - start, frame };
		this.byFrame.set(frame, load);
		this.last = load;
		this.count += 1;
	}

	/** How many document loads (any frame) have been recorded; an action compares it before and after. */
	loadCount(): number {
		return this.count;
	}

	/** The HTTP status of the frame's latest document load, when one was seen. */
	statusOf(frame: Frame): number | null {
		return this.byFrame.get(frame)?.status ?? null;
	}

	/** The latest document load in any frame. */
	lastNavigation(): NavigationInfo | null {
		const last = this.last;
		if (last === null) return null;
		let framePath: readonly string[];
		try {
			framePath = last.frame.isDetached() ? [] : framePathOf(last.frame);
		} catch {
			framePath = [];
		}
		return { framePath, url: last.url, status: last.status, durationMs: last.durationMs };
	}
}
