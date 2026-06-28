import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep all of n8n-workflow real except sleep, which we replace with an instant advance of a
// controllable clock so the poll loop is deterministic and never waits in real time.
vi.mock('n8n-workflow', async (importOriginal) => {
	const actual = await importOriginal<typeof import('n8n-workflow')>();
	return { ...actual, sleep: vi.fn(() => Promise.resolve()) };
});

import { sleep } from 'n8n-workflow';

import { handleJob } from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

let now = 1_000_000;

beforeEach(() => {
	now = 1_000_000;
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

	it('times out on a non-numeric maxWait instead of looping forever (NaN deadline)', async () => {
		const { result } = await getResults(
			{ maxWait: 'oops' as unknown as number },
			() => ({ state: { status: 'Running' } }),
		);
		// Falls back to the 300s default; the mocked sleep advances the clock so the loop terminates.
		expect(result.timedOut).toBe(true);
	});
});
