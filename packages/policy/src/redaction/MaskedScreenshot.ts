declare const maskedScreenshotBrand: unique symbol;

/**
 * Screenshot bytes in which every sensitive region has been masked. The evidence store accepts screenshots
 * only as this type (invariant 3). Produced only by the surface masking helper.
 */
export type MaskedScreenshot = Uint8Array & { readonly [maskedScreenshotBrand]: true };

/**
 * Brands screenshot bytes as masked. **Only call this after masking** — the sole call site is the surface
 * masking helper (`captureMaskedScreenshot`), which captures with Playwright masks over every sensitive
 * element. Returns the same bytes (no copy).
 */
export function asMaskedScreenshot(bytes: Uint8Array): MaskedScreenshot {
	return bytes as MaskedScreenshot;
}
