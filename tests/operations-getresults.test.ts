import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep all of n8n-workflow real except sleep, which we replace with an instant advance of a
// controllable clock so the poll loop is deterministic and never waits in real time.
vi.mock('n8n-workflow', async (importOriginal) => {
	const actual = await importOriginal<typeof import('n8n-workflow')>();
	return { ...actual, sleep: vi.fn(() => Promise.resolve()) };
});

import { sleep } from 'n8n-workflow';

import {
	handleJob,
	MAX_POLL_INTERVAL_SECONDS,
	MAX_WAIT_SECONDS,
} from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

let now = 1_000_000;

beforeEach(() => {
	now = 1_000_000;
	// restoreAllMocks does not clear a module mock's recorded calls, so without this each test would
	// also see the sleeps of the tests before it.
	vi.mocked(sleep).mockClear();
	vi.spyOn(Date, 'now').mockImplementation(() => now);
	vi.mocked(sleep).mockImplementation((ms?: number) => {
		now += ms ?? 0;
		return Promise.resolve();
	});
});

afterEach(() => vi.restoreAllMocks());

function getResults(params: Record<string, unknown>, http: FakeHttp) {
	const { ctx, requests } = makeExecuteContext({
		params: { jobId: 'job-1', pollInterval: 5, maxWait: 300, registerName: '', ...params },
		http,
	});
	return handleJob
		.call(ctx, TEST_CTX, 'getResults', 0)
		.then((result) => ({ result: result as Record<string, unknown>, requests }));
}

type FakeHttp = (call: HttpCall, index: number) => unknown;

const isResults = (call: HttpCall) => String(call.url).endsWith('/results');

describe('getResults polling loop (TEST-02)', () => {
	it('polls until terminal, then fetches /results once and parses counts', async () => {
		const { result, requests } = await getResults({}, (call, i) => {
			if (isResults(call)) {
				return { results: [{ data: { c: { samples: ['0x1', '0x1', '0x0'], num_bits: 1 } }, metadata: {} }] };
			}
			return { state: { status: i === 0 ? 'Running' : 'Completed' } };
		});

		expect(result.status).toBe('completed');
		expect(result.pubCount).toBe(1);
		expect(vi.mocked(sleep)).toHaveBeenCalledTimes(1);
		expect(requests.filter(isResults)).toHaveLength(1);
	});

	it('returns timedOut and never fetches /results when the deadline passes', async () => {
		const { result, requests } = await getResults({ maxWait: 10 }, () => ({
			state: { status: 'Running' },
		}));

		expect(result.timedOut).toBe(true);
		expect(result.status).toBe('running');
		expect(requests.some(isResults)).toBe(false);
	});

	it('returns a non-completed terminal status without fetching /results', async () => {
		const { result, requests } = await getResults({}, () => ({ state: { status: 'Failed' } }));

		expect(result.status).toBe('failed');
		expect(result.pubCount).toBeUndefined();
		expect(requests.some(isResults)).toBe(false);
	});

	it('passes the preferred register name through to the parser', async () => {
		const { result } = await getResults({ registerName: 'meas' }, (call) => {
			if (isResults(call)) {
				// 'other' is first, so the default find() would pick it; only a working passthrough
				// of registerName='meas' yields 'meas'. This makes the assertion non-tautological.
				return {
					results: [
						{
							data: {
								other: { samples: ['0x0'], num_bits: 1 },
								meas: { samples: ['0x1'], num_bits: 1 },
							},
							metadata: {},
						},
					],
				};
			}
			return { state: { status: 'Completed' } };
		});

		const pub = (result.pubs as Array<Record<string, unknown>>)[0];
		expect(pub.register).toBe('meas');
	});

	it('clamps a non-numeric pollInterval instead of busy-looping with sleep(NaN)', async () => {
		const { result } = await getResults({ pollInterval: 'abc' as unknown as number }, (call, i) => {
			if (isResults(call)) return { results: [] };
			return { state: { status: i === 0 ? 'Running' : 'Completed' } };
		});
		expect(result.status).toBe('completed');
		// Without the clamp this would be sleep(NaN); the fallback (5s) must be a finite ms value.
		expect(vi.mocked(sleep)).toHaveBeenCalledWith(5000);
	});

	// A job that failed has no results, and IBM buries the cause two levels down in the raw body.
	// The Error Trigger surfaces it; Get Results used to leave the caller to dig for it.
	it('lifts the failure reason next to the status for a failed job', async () => {
		const { result } = await getResults({}, () => ({
			state: {
				status: 'Failed',
				reason: "Job not valid. Error loading QASM circuit: 'duplicate bit arguments'",
				reason_code: 1603,
				reason_solution: 'Transpile the circuit for the target backend.',
			},
		}));
		expect(result.status).toBe('failed');
		expect(result.reason).toBe(
			"Job not valid. Error loading QASM circuit: 'duplicate bit arguments'",
		);
		expect(result.reasonCode).toBe(1603);
		expect(result.reasonSolution).toBe('Transpile the circuit for the target backend.');
		// The untouched body stays available for anything the lift does not cover.
		expect(result.job).toBeTruthy();
	});

	it('emits the same fields as null for a cancelled job that carries no reason', async () => {
		const { result } = await getResults({}, () => ({ state: { status: 'Cancelled' } }));
		expect(result.status).toBe('cancelled');
		expect(result).toHaveProperty('reason', null);
		expect(result).toHaveProperty('reasonCode', null);
		expect(result).toHaveProperty('reasonSolution', null);
	});

	// A malformed body with no state object at all must still produce the same shape.
	it('reports null reasons when the failed job carries no state object', async () => {
		const { result } = await getResults({}, () => ({ status: 'Failed' }));
		expect(result.status).toBe('failed');
		expect(result).toHaveProperty('reason', null);
		expect(result).toHaveProperty('reasonCode', null);
		expect(result).toHaveProperty('reasonSolution', null);
	});

	it('does not fetch results for a job that did not complete', async () => {
		const { requests } = await getResults({}, () => ({ state: { status: 'Failed' } }));
		expect(requests.some((call) => String(call.url).endsWith('/results'))).toBe(false);
	});

	// IBM documents a 204 on the results endpoint as "Job's final result not found". The transport
	// turns that empty body into {}, which used to read as a completed job that produced nothing.
	it('says so when the completed job has no result body at all', async () => {
		const { result } = await getResults({}, (call) => {
			if (isResults(call)) return {};
			return { state: { status: 'Completed' } };
		});
		expect(result.status).toBe('completed');
		expect(result.resultsAvailable).toBe(false);
		expect(result.pubCount).toBe(0);
	});

	it('does not flag a real result set that simply has no pubs', async () => {
		const { result } = await getResults({}, (call) => {
			if (isResults(call)) return { results: [] };
			return { state: { status: 'Completed' } };
		});
		expect(result).not.toHaveProperty('resultsAvailable');
		expect(result.pubCount).toBe(0);
	});

	// A completed job must keep exactly the shape it had before the lift was added.
	it('leaves a completed job output unchanged', async () => {
		const { result } = await getResults({}, (call) => {
			if (isResults(call)) {
				return { results: [{ data: { c: { samples: ['0x1'], num_bits: 1 } }, metadata: {} }] };
			}
			return { state: { status: 'Completed' } };
		});
		expect(Object.keys(result).sort()).toEqual(['jobId', 'pubCount', 'pubs', 'raw', 'status']);
		expect(result).not.toHaveProperty('reason');
	});

	// Returning the wrong register's counts under the requested name is a silent physics error, so
	// the handler turns the parser's plain Error into a node error naming the available registers.
	it('fails with a node error when the requested Register Name is absent', async () => {
		await expect(
			getResults({ registerName: 'syndrome' }, (call) => {
				if (isResults(call)) {
					return { results: [{ data: { meas: { samples: ['0x1'], num_bits: 1 } }, metadata: {} }] };
				}
				return { state: { status: 'Completed' } };
			}),
		).rejects.toThrow(/Register "syndrome" is not in this result\. Available: meas\./);
	});

	it('returns the requested register when it is present', async () => {
		const { result } = await getResults({ registerName: 'syndrome' }, (call) => {
			if (isResults(call)) {
				return {
					results: [
						{
							data: {
								meas: { samples: ['0x1'], num_bits: 1 },
								syndrome: { samples: ['0x3', '0x3'], num_bits: 2 },
							},
							metadata: {},
						},
					],
				};
			}
			return { state: { status: 'Completed' } };
		});
		const pub = (result.pubs as Array<Record<string, unknown>>)[0];
		expect(pub.register).toBe('syndrome');
		expect(pub.counts).toEqual({ '11': 2 });
	});

	// setTimeout takes a 32 bit signed delay, so a sleep longer than 2^31-1 ms fires after 1 ms
	// instead of waiting. Without an upper bound a huge poll interval turned the wait into no wait
	// and the loop hammered the API until the deadline.
	it('clamps a poll interval that would overflow setTimeout', async () => {
		// maxWait is wide enough that the deadline does not mask the interval clamp.
		await getResults(
			{ pollInterval: 1e15 as unknown as number, maxWait: MAX_WAIT_SECONDS },
			(call, i) => {
				if (isResults(call)) return { results: [] };
				return { state: { status: i === 0 ? 'Running' : 'Completed' } };
			},
		);
		expect(vi.mocked(sleep)).toHaveBeenCalledWith(MAX_POLL_INTERVAL_SECONDS * 1000);
	});

	it('never sleeps past the deadline, even with a huge interval', async () => {
		await getResults({ pollInterval: 1e15 as unknown as number, maxWait: 300 }, (call, i) => {
			if (isResults(call)) return { results: [] };
			return { state: { status: i === 0 ? 'Running' : 'Completed' } };
		});
		// The remaining time, not the interval, is the smaller of the two here.
		expect(vi.mocked(sleep)).toHaveBeenCalledWith(300_000);
	});

	it('keeps every sleep inside the 32 bit setTimeout range', async () => {
		await getResults(
			{
				pollInterval: Number.MAX_SAFE_INTEGER as unknown as number,
				maxWait: 1e15 as unknown as number,
			},
			() => ({ state: { status: 'Running' } }),
		);
		const calls = vi.mocked(sleep).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		for (const call of calls) {
			expect(call[0]).toBeGreaterThan(0);
			expect(call[0]).toBeLessThanOrEqual(2 ** 31 - 1);
		}
	});

	it('caps the total wait so a runaway maxWait still terminates', async () => {
		const { result } = await getResults(
			{ maxWait: 1e15 as unknown as number, pollInterval: MAX_POLL_INTERVAL_SECONDS },
			() => ({ state: { status: 'Running' } }),
		);
		expect(result.timedOut).toBe(true);
		const slept = vi.mocked(sleep).mock.calls.reduce((sum, call) => sum + (call[0] ?? 0), 0);
		expect(slept).toBeLessThanOrEqual(MAX_WAIT_SECONDS * 1000);
	});

	it('leaves an ordinary interval alone', async () => {
		await getResults({ pollInterval: 30 }, (call, i) => {
			if (isResults(call)) return { results: [] };
			return { state: { status: i === 0 ? 'Running' : 'Completed' } };
		});
		expect(vi.mocked(sleep)).toHaveBeenCalledWith(30_000);
	});

	// Zero is the value the clamp exists for: sleep(0) inside the retry loop is a busy loop that
	// hammers the API until the deadline. NaN was covered; zero and negatives were not.
	it.each([
		[0, 5000],
		[-1, 5000],
		[0.5, 5000],
		[10, 10000],
	])('clamps a pollInterval of %s to %s ms', async (given, expected) => {
		await getResults({ pollInterval: given as unknown as number }, (call, i) => {
			if (isResults(call)) return { results: [] };
			return { state: { status: i === 0 ? 'Running' : 'Completed' } };
		});
		expect(vi.mocked(sleep)).toHaveBeenCalledWith(expected);
	});

	it('times out on a non-numeric maxWait instead of looping forever (NaN deadline)', async () => {
		const { result } = await getResults(
			{ maxWait: 'oops' as unknown as number },
			() => ({ state: { status: 'Running' } }),
		);
		// Falls back to the 300s default; the mocked sleep advances the clock so the loop terminates.
		expect(result.timedOut).toBe(true);
	});

	it('retries a transient 502 during polling and still completes', async () => {
		const { result, requests } = await getResults({}, (call, i) => {
			if (isResults(call)) {
				return { results: [{ data: { c: { samples: ['0x0'], num_bits: 1 } }, metadata: {} }] };
			}
			if (i === 0) throw { httpCode: '502', message: 'Bad gateway' };
			return { state: { status: 'Completed' } };
		});
		expect(result.status).toBe('completed');
		expect(requests.filter((call) => !isResults(call))).toHaveLength(2);
	});

	it('retries a 429 rate limit during polling', async () => {
		const { result } = await getResults({}, (call, i) => {
			if (isResults(call)) return { results: [] };
			if (i === 0) throw { httpCode: 429, message: 'Too many requests' };
			return { state: { status: 'Completed' } };
		});
		expect(result.status).toBe('completed');
	});

	it('fails fast on a non-transient error like 404', async () => {
		let calls = 0;
		await expect(
			getResults({}, () => {
				calls += 1;
				throw { httpCode: '404', message: 'Job not found' };
			}),
		).rejects.toThrow();
		expect(calls).toBe(1);
	});

	it('stops retrying once the deadline passes', async () => {
		let calls = 0;
		await expect(
			getResults({ maxWait: 12, pollInterval: 5 }, () => {
				calls += 1;
				throw { httpCode: '503', message: 'Service unavailable' };
			}),
		).rejects.toThrow();
		// 12s window, 5s interval: attempts at t=0, 5 and 10 retry, the t=12 attempt rethrows.
		expect(calls).toBe(4);
	});
});
