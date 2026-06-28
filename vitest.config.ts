import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			// Gate coverage on the real logic modules, not just the two pure helpers. The declarative
			// property schema (descriptions.ts) and the thin node wrappers (*.node.ts, mostly metadata
			// and poll wiring) are excluded so the gate reflects testable logic.
			include: ['nodes/IbmQuantum/**/*.ts', 'credentials/**/*.ts'],
			exclude: ['nodes/IbmQuantum/descriptions.ts', 'nodes/IbmQuantum/**/*.node.ts'],
			reporter: ['text', 'html'],
			thresholds: { lines: 85, functions: 85, branches: 80 },
		},
	},
});
