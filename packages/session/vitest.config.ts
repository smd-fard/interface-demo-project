import { defineConfig } from 'vitest/config';

// Unit tests only: no browser, no network, no processes. Functional tests run via vitest.functional.config.ts.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
	},
});
