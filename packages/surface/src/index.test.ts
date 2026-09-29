import { describe, expect, it } from 'vitest';
import * as Surface from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/surface', () => {
	it('exposes a module barrel', () => {
		expect(Surface).toBeTypeOf('object');
	});
});
