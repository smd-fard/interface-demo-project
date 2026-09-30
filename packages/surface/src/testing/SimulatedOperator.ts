import type { FrameScope, TargetRef } from '@idp/artifact-schema';
import type { Frame, Locator } from 'playwright';
import { resolveFrameScope } from '../locators/FrameResolver.js';
import { LadderResolver } from '../locators/LadderResolver.js';
import { rungToLocator } from '../locators/rungToLocator.js';
import { browserInternals } from '../playwright/BrowserHandle.js';
import type { BrowserHandle } from '../port/BrowserHandle.js';
import type { Bindings } from '../port/Bindings.js';

/** What the simulated person points at: a TargetRef ladder, or exact visible text in a frame. */
export type OperatorTarget = TargetRef | { readonly text: string; readonly frame?: FrameScope };

/**
 * Performs "human" gestures with real input events (`page.mouse`, `page.keyboard`) at an element's
 * on-screen position, the way a person would, so in-page listeners (the recorder's capture script) see
 * genuine events. Test-only: it bypasses the surface and its policy on purpose, like a human at the keyboard.
 */
export class SimulatedOperator {
	private readonly ladder: LadderResolver<Frame, Locator>;

	constructor(private readonly handle: BrowserHandle) {
		this.ladder = new LadderResolver<Frame, Locator>({
			root: () => browserInternals(this.handle).page.mainFrame(),
			toLocator: rungToLocator,
		});
	}

	private get page() {
		return browserInternals(this.handle).page;
	}

	private async locate(target: OperatorTarget, bindings: Bindings): Promise<Locator> {
		if ('ladder' in target) return (await this.ladder.resolve(target, bindings)).locator;
		const frame = await resolveFrameScope(this.page.mainFrame(), target.frame ?? []);
		return frame.getByText(target.text, { exact: true });
	}

	/** Opens a URL in the page, as a person typing it into the address bar (the network guard still applies). */
	async open(url: string): Promise<void> {
		await this.page.goto(url);
	}

	/** Moves the mouse to the centre of the element and clicks. */
	async click(target: OperatorTarget, bindings: Bindings = {}): Promise<void> {
		const locator = await this.locate(target, bindings);
		await locator.scrollIntoViewIfNeeded();
		const box = await locator.boundingBox();
		if (box === null) throw new Error('the element is not visible, so a person could not click it');
		await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	}

	/** Clicks into a field, selects its content and types `text` key by key (replacing it). */
	async type(target: OperatorTarget, text: string, bindings: Bindings = {}): Promise<void> {
		await this.click(target, bindings);
		await this.page.keyboard.press('ControlOrMeta+A');
		await this.page.keyboard.type(text);
	}

	/** Presses one key on whatever has focus. */
	async press(key: string): Promise<void> {
		await this.page.keyboard.press(key);
	}
}
