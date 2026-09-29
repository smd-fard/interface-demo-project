import { describe, expect, it } from 'vitest';
import * as MockBank from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/mock-bank', () => {
	it('exposes a module barrel', () => {
		expect(MockBank).toBeTypeOf('object');
	});
});
