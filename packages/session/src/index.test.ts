import { describe, expect, it } from 'vitest';
import * as Session from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/session', () => {
	it('exposes a module barrel', () => {
		expect(Session).toBeTypeOf('object');
	});
});
