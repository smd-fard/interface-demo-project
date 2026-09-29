import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
		environment: 'node',
		// Functional tests start processes (mock-bank, browsers); keep them from fighting over ports.
		fileParallelism: false,
		testTimeout: 30_000,
		hookTimeout: 60_000,
	},
});
