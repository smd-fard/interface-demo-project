import { describe, expect, it } from 'vitest';
import * as ArtifactSchema from './index.js';

// Placeholder so an empty package's test gate is green. Replace it with real tests as the package grows.
describe('@idp/artifact-schema', () => {
	it('exposes a module barrel', () => {
		expect(ArtifactSchema).toBeTypeOf('object');
	});
});
