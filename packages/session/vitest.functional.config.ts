import { defineConfig } from 'vitest/config';

// Functional tests start processes (mock-bank, browsers); keep them from fighting over ports.
export default defineConfig({
	test: {
		include: ['test/functional/**/*.test.ts'],
		environment: 'node',
		fileParallelism: false,
		testTimeout: 60_000,
		hookTimeout: 90_000,
	},
});
