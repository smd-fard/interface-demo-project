import { describe, expect, it } from 'vitest';
import * as Policy from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/policy', () => {
	it('exposes a module barrel', () => {
		expect(Policy).toBeTypeOf('object');
	});
});
