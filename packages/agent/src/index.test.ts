import { describe, expect, it } from 'vitest';
import * as Agent from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/agent', () => {
	it('exposes a module barrel', () => {
		expect(Agent).toBeTypeOf('object');
	});
});
