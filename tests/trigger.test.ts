import { describe, expect, it } from 'vitest';

import { jobMatchesFilter } from '../nodes/IbmQuantum/IbmQuantumTrigger.node';

describe('jobMatchesFilter', () => {
	it('ignores non-terminal statuses', () => {
		expect(jobMatchesFilter('pending', 'any')).toBe(false);
		expect(jobMatchesFilter('in_progress', 'any')).toBe(false);
		expect(jobMatchesFilter('running', 'completed')).toBe(false);
	});

	it('matches any terminal status when the filter is "any"', () => {
		expect(jobMatchesFilter('completed', 'any')).toBe(true);
		expect(jobMatchesFilter('failed', 'any')).toBe(true);
		expect(jobMatchesFilter('canceled', 'any')).toBe(true);
	});

	it('matches a specific terminal status', () => {
		expect(jobMatchesFilter('completed', 'completed')).toBe(true);
		expect(jobMatchesFilter('failed', 'completed')).toBe(false);
	});

	it('treats both spellings of canceled as a match', () => {
		expect(jobMatchesFilter('canceled', 'canceled')).toBe(true);
		expect(jobMatchesFilter('cancelled', 'canceled')).toBe(true);
	});
});
