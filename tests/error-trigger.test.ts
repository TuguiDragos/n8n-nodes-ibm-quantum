import { describe, expect, it } from 'vitest';

import { IbmQuantumErrorTrigger } from '../nodes/IbmQuantum/IbmQuantumErrorTrigger.node';
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

type ErrorJob = Record<string, unknown>;
type PollResult = Array<Array<{ json: Record<string, unknown> }>> | null;

function makeErrorContext(jobs: ErrorJob[], errorFilter = 'any', mode: 'trigger' | 'manual' = 'manual') {
	return {
		getNodeParameter: (name: string) => (name === 'errorFilter' ? errorFilter : 20),
		getCredentials: async () => ({ region: 'us-east' }),
		getMode: () => mode,
		getNode: () => ({ name: 'IBM Quantum Error Trigger' }),
		getWorkflowStaticData: () => ({}),
		helpers: {
			httpRequestWithAuthentication: async () => ({ jobs }),
			returnJsonArray: (data: ErrorJob[]) => data.map((json) => ({ json })),
		},
	};
}

const errorPoll = (ctx: unknown) =>
	(IbmQuantumErrorTrigger.prototype.poll as () => Promise<PollResult>).call(ctx);

const failedJob = {
	id: 'e1',
	backend: 'ibm_brisbane',
	state: { status: 'Failed', reason: 'Calibration in progress', reason_code: 1517, reason_solution: 'Resubmit' },
};

describe('IbmQuantumErrorTrigger.poll wiring (TEST-08)', () => {
	it('emits a failed job mapped through extractStateError', async () => {
		const result = await errorPoll(makeErrorContext([failedJob]));
		expect(result![0][0].json).toMatchObject({
			jobId: 'e1',
			backend: 'ibm_brisbane',
			status: 'failed',
			reason: 'Calibration in progress',
			reasonCode: 1517,
			reasonSolution: 'Resubmit',
		});
	});

	it('never fires on a completed job', async () => {
		const result = await errorPoll(makeErrorContext([{ id: 'ok', state: { status: 'Completed' } }]));
		expect(result![0]).toHaveLength(0);
	});

	it('honours the errorFilter', async () => {
		const canceled = [{ id: 'c1', state: { status: 'Cancelled' } }];
		expect((await errorPoll(makeErrorContext(canceled, 'failed')))![0]).toHaveLength(0);
		expect((await errorPoll(makeErrorContext(canceled, 'canceled')))![0][0].json.jobId).toBe('c1');
	});

	it('seeds then fires on a newly failed job in trigger mode', async () => {
		// Re-implement a tiny stateful context so the cursor persists across two polls.
		const staticData: Record<string, unknown> = {};
		let jobs: ErrorJob[] = [{ id: 'old', state: { status: 'Completed' } }];
		const ctx = {
			getNodeParameter: (name: string) => (name === 'errorFilter' ? 'any' : 20),
			getCredentials: async () => ({ region: 'us-east' }),
			getMode: () => 'trigger',
			getNode: () => ({ name: 'IBM Quantum Error Trigger' }),
			getWorkflowStaticData: () => staticData,
			helpers: {
				httpRequestWithAuthentication: async () => ({ jobs }),
				returnJsonArray: (data: ErrorJob[]) => data.map((json) => ({ json })),
			},
		};
		expect(await errorPoll(ctx)).toBeNull(); // seed
		jobs = [failedJob, ...jobs];
		const fired = await errorPoll(ctx);
		expect(fired![0][0].json.reasonCode).toBe(1517);
	});
});
