import type { LocatorRung } from '@idp/artifact-schema';
import type { Frame, Locator } from 'playwright';
import { substituteTemplate } from '../internal/substituteTemplate.js';
import type { Bindings } from '../port/Bindings.js';
import { structuralXPath } from './structuralXPath.js';

/** The part of a Playwright `Frame` that builds locators. */
export type LocatorFactory = Pick<Frame, 'getByRole' | 'getByLabel' | 'getByText' | 'locator'>;
type AriaRole = Parameters<Frame['getByRole']>[0];

/**
 * Turns one ladder rung into a Playwright locator inside a frame. The locator is not evaluated here; the
 * ladder resolver requires it to match exactly one element. `surface.web.cssHint` is never used.
 */
export function rungToLocator(frame: LocatorFactory, rung: LocatorRung, bindings: Bindings): Locator {
	switch (rung.kind) {
		case 'role': {
			const role = rung.role as AriaRole;
			if (rung.name === undefined) return frame.getByRole(role, {});
			return frame.getByRole(role, { name: substituteTemplate(rung.name, bindings), exact: rung.exact ?? false });
		}
		case 'label':
			return frame.getByLabel(substituteTemplate(rung.text, bindings));
		case 'text':
			return frame.getByText(substituteTemplate(rung.text, bindings), { exact: rung.match === 'exact' });
		case 'structural':
			return frame.locator(`xpath=${structuralXPath(rung.anchor, bindings)}`);
	}
}
