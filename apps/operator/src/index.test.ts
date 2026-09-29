import { describe, expect, it } from 'vitest';
import * as Operator from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/operator', () => {
	it('exposes a module barrel', () => {
		expect(Operator).toBeTypeOf('object');
	});
});
