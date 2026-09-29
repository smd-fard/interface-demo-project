import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Fixtures are on-disk mini-workspaces (package.json only); never collect tests from them.
		include: ['src/**/*.test.ts', 'test/functional/**/*.test.ts'],
		exclude: ['test/fixtures/**', 'node_modules/**'],
		environment: 'node',
	},
});
