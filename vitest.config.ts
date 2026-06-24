import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['nodes/IbmQuantum/qasm3.ts', 'nodes/IbmQuantum/results.ts'],
			reporter: ['text', 'html'],
			thresholds: { lines: 85, functions: 85, branches: 80 },
		},
	},
});
