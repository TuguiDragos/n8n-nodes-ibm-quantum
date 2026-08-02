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
			// Set just under the current actuals, so a regression trips the gate rather than
			// quietly eroding the suite. Raise them again when coverage climbs.
			// Just under the current actuals, so a regression trips the gate rather than quietly
			// eroding the suite. Branches stop short of 100 because a handful of guards are
			// unreachable by construction (see the note in results.ts and getResults).
			thresholds: { lines: 100, statements: 99, functions: 100, branches: 97 },
		},
	},
});
