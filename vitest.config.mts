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
			// Every branch in the covered modules is now reachable and tested, so the gate is a flat
			// 100. The defensive paths that used to sit below it were either dead code that has been
			// removed, or duplicated narrowing that now lives in one tested helper each
			// (errorMessage and asNodeError in transport.ts). Adding an untested line fails the build.
			thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
		},
	},
});
