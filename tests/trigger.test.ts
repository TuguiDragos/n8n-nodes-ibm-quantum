import { describe, expect, it } from 'vitest';

import { jobMatchesFilter } from '../nodes/IbmQuantum/IbmQuantumTrigger.node';
import { isErrorStatus } from '../nodes/IbmQuantum/triggerPoll';

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

	it('treats the error alias as failed, like the error trigger does', () => {
		expect(jobMatchesFilter('error', 'failed')).toBe(true);
		expect(jobMatchesFilter('error', 'any')).toBe(true);
		expect(jobMatchesFilter('error', 'completed')).toBe(false);
	});
});

describe('jobMatchesFilter with the combined error filter', () => {
	it('matches failures and cancellations, but never a completed job', () => {
		expect(jobMatchesFilter('failed', 'failedOrCanceled')).toBe(true);
		expect(jobMatchesFilter('error', 'failedOrCanceled')).toBe(true);
		expect(jobMatchesFilter('canceled', 'failedOrCanceled')).toBe(true);
		expect(jobMatchesFilter('cancelled', 'failedOrCanceled')).toBe(true);
		expect(jobMatchesFilter('completed', 'failedOrCanceled')).toBe(false);
	});

	it('ignores jobs that have not finished', () => {
		expect(jobMatchesFilter('running', 'failedOrCanceled')).toBe(false);
		expect(jobMatchesFilter('queued', 'failedOrCanceled')).toBe(false);
		expect(jobMatchesFilter('', 'failedOrCanceled')).toBe(false);
	});

	// The option exists to replace the retired error trigger, so the two must agree everywhere.
	it('agrees with the error trigger matcher on every status', () => {
		const statuses = [
			'completed',
			'failed',
			'error',
			'cancelled',
			'canceled',
			'cancelling',
			'canceling',
			'running',
			'queued',
			'pending',
			'validating',
			'',
			'COMPLETED',
		];
		for (const status of statuses) {
			expect(jobMatchesFilter(status, 'failedOrCanceled')).toBe(isErrorStatus(status, 'any'));
		}
	});
});
