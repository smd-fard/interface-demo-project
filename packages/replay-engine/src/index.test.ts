import { describe, expect, it } from 'vitest';
import * as ReplayEngine from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/replay-engine', () => {
	it('exposes a module barrel', () => {
		expect(ReplayEngine).toBeTypeOf('object');
	});
});
