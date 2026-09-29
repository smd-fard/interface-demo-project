import { describe, expect, it } from 'vitest';
import * as Evidence from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/evidence', () => {
	it('exposes a module barrel', () => {
		expect(Evidence).toBeTypeOf('object');
	});
});
