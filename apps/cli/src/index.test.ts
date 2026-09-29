import { describe, expect, it } from 'vitest';
import * as Cli from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/cli', () => {
	it('exposes a module barrel', () => {
		expect(Cli).toBeTypeOf('object');
	});
});
