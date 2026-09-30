import { asMaskedScreenshot, type MaskedScreenshot, type Redactor } from '@idp/policy';
import type { Page } from 'playwright';
import { markSensitiveElements, type MaskOptions } from './markSensitiveElements.js';

/**
 * A viewport screenshot with a Playwright `mask` over every sensitive element in every frame (see
 * `markSensitiveElements`), branded with `asMaskedScreenshot` only after masking (invariant 3). A frame that
 * cannot be inspected makes the capture fail rather than produce an unmasked image.
 */
export async function captureMaskedScreenshot(
	page: Page,
	redactor: Redactor,
	options: MaskOptions = {},
): Promise<MaskedScreenshot> {
	const marks = await markSensitiveElements(page, redactor, options);
	try {
		const bytes = await page.screenshot({
			type: 'png',
			mask: [...marks.masks],
			maskColor: '#000000',
			animations: 'disabled',
			caret: 'hide',
		});
		return asMaskedScreenshot(new Uint8Array(bytes));
	} finally {
		await marks.clear();
	}
}
