import { describe, expect, it } from 'vitest';

import { isTerminalStatus } from '../nodes/IbmQuantum/operations';
import { extractStateError, isErrorStatus } from '../nodes/IbmQuantum/triggerPoll';

describe('isTerminalStatus', () => {
	it('recognises every finished status, including the ran-too-long cancellation', () => {
		for (const s of ['completed', 'failed', 'canceled', 'cancelled', 'cancelled - ran too long']) {
			expect(isTerminalStatus(s)).toBe(true);
		}
	});

	it('does not treat in-progress statuses as terminal', () => {
		for (const s of ['queued', 'running', 'pending', 'in_progress']) {
			expect(isTerminalStatus(s)).toBe(false);
		}
	});
});

describe('isErrorStatus', () => {
	it('matches only failed or canceled, never completed or running', () => {
		expect(isErrorStatus('completed', 'any')).toBe(false);
		expect(isErrorStatus('running', 'any')).toBe(false);
		expect(isErrorStatus('failed', 'any')).toBe(true);
		expect(isErrorStatus('canceled', 'any')).toBe(true);
		expect(isErrorStatus('cancelled - ran too long', 'any')).toBe(true);
	});

	it('honours the failed/canceled filter', () => {
		expect(isErrorStatus('failed', 'failed')).toBe(true);
		expect(isErrorStatus('canceled', 'failed')).toBe(false);
		expect(isErrorStatus('canceled', 'canceled')).toBe(true);
		expect(isErrorStatus('failed', 'canceled')).toBe(false);
	});
});

describe('extractStateError', () => {
	it('pulls the reason, code and solution from the job state', () => {
		const job = {
			id: 'job-1',
			backend: 'ibm_brisbane',
			state: {
				status: 'Failed',
				reason: 'Hardware calibration in progress',
				reason_code: 1517,
				reason_solution: 'Resubmit to another backend',
			},
		};
		expect(extractStateError(job)).toEqual({
			jobId: 'job-1',
			backend: 'ibm_brisbane',
			status: 'failed',
			reason: 'Hardware calibration in progress',
			reasonCode: 1517,
			reasonSolution: 'Resubmit to another backend',
			job,
		});
	});

	it('returns null details when the job has no state', () => {
		const result = extractStateError({ id: 'job-2' });
		expect(result.status).toBe('');
		expect(result.reason).toBeNull();
		expect(result.reasonCode).toBeNull();
		expect(result.reasonSolution).toBeNull();
	});
});
