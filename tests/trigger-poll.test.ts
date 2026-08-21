import { describe, expect, it } from 'vitest';

import { IbmQuantumTrigger } from '../nodes/IbmQuantum/IbmQuantumTrigger.node';
import { MAX_POLL_LIMIT, SEEN_JOB_CURSOR } from '../nodes/IbmQuantum/triggerPoll';

type Job = { id: string; status: string };
type PollResult = Array<Array<{ json: Job }>> | null;

// Minimal IPollFunctions stand-in. `jobsRef.jobs` is the intercepted API response, and
// `staticData` is the persisted cursor that survives between polls, exactly like n8n.
function makeContext(
	jobsRef: { jobs: Job[] },
	staticData: Record<string, unknown>,
	mode: 'trigger' | 'manual' = 'trigger',
	params: Record<string, unknown> = {},
) {
	let httpCalls = 0;
	const requests: Array<Record<string, unknown>> = [];
	const defaults: Record<string, unknown> = { statusFilter: 'any', tagFilter: '', limit: 20 };
	const ctx = {
		getNodeParameter: (name: string) => (name in params ? params[name] : defaults[name]),
		getCredentials: async () => ({ region: 'us-east', apiVersion: '2026-04-15' }),
		getMode: () => mode,
		getNode: () => ({ name: 'IBM Quantum Trigger' }),
		getWorkflowStaticData: () => staticData,
		helpers: {
			httpRequestWithAuthentication: async (_cred: string, options: Record<string, unknown>) => {
				httpCalls += 1;
				requests.push(options);
				return { jobs: jobsRef.jobs };
			},
			returnJsonArray: (data: Job[]) => data.map((json) => ({ json })),
		},
	};
	return { ctx, httpCalls: () => httpCalls, requests };
}

const poll = (ctx: unknown) =>
	(IbmQuantumTrigger.prototype.poll as () => Promise<PollResult>).call(ctx);

describe('IbmQuantumTrigger.poll deduplication', () => {
	it('seeds on the first poll, then never re-emits the same terminal job', async () => {
		const jobsRef = { jobs: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }] };
		const staticData: Record<string, unknown> = {};
		const { ctx } = makeContext(jobsRef, staticData);

		// Poll 1: history is seeded, nothing fires.
		expect(await poll(ctx)).toBeNull();
		expect(staticData.seenJobIds).toEqual(['a', 'b']);

		// Poll 2: identical terminal jobs, must stay silent (this is the bug class to catch).
		expect(await poll(ctx)).toBeNull();

		// A new job finishes.
		jobsRef.jobs = [{ id: 'c', status: 'completed' }, ...jobsRef.jobs];
		const fired = await poll(ctx);
		expect(fired).not.toBeNull();
		expect(fired![0]).toHaveLength(1);
		expect(fired![0][0].json.id).toBe('c');

		// Poll 4: same jobs again, c was already emitted, stays silent.
		expect(await poll(ctx)).toBeNull();
	});

	it('emits only the newly completed jobs, not the whole window', async () => {
		const jobsRef = { jobs: [{ id: 'x1', status: 'completed' }] };
		const staticData: Record<string, unknown> = {};
		const { ctx } = makeContext(jobsRef, staticData);

		await poll(ctx); // seed x1

		jobsRef.jobs = [
			{ id: 'x3', status: 'completed' },
			{ id: 'x2', status: 'failed' },
			{ id: 'x1', status: 'completed' },
		];
		const fired = await poll(ctx);
		const ids = fired![0].map((item) => item.json.id).sort();
		expect(ids).toEqual(['x2', 'x3']);
	});

	it('manual mode returns a sample without mutating the cursor', async () => {
		const jobsRef = { jobs: [{ id: 'm1', status: 'completed' }] };
		const staticData: Record<string, unknown> = {};
		const { ctx } = makeContext(jobsRef, staticData, 'manual');

		const result = await poll(ctx);
		expect(result![0][0].json.id).toBe('m1');
		expect(staticData.seenJobIds).toBeUndefined();
	});

	it('holds the scan window to the requested limit, whatever the server returns (TEST-09)', async () => {
		// A server that ignores the limit and answers with 600 must not widen the window, because the
		// window has to stay below the cursor size.
		const jobs = Array.from({ length: 600 }, (_, i) => ({ id: `j${i}`, status: 'completed' }));
		const staticData: Record<string, unknown> = {};
		const { ctx } = makeContext({ jobs }, staticData);

		await poll(ctx);
		const seen = staticData.seenJobIds as string[];
		expect(seen).toHaveLength(20);
		// The window is the head of the response, so the newest jobs are the ones remembered.
		expect(seen[0]).toBe('j0');
		expect(seen[19]).toBe('j19');
	});

	// This is the property that matters: a job already emitted must never be emitted again.
	it('never re-emits a job on an identical follow-up poll (TEST-09)', async () => {
		const jobs = Array.from({ length: 600 }, (_, i) => ({ id: `j${i}`, status: 'completed' }));
		const staticData: Record<string, unknown> = {};
		const { ctx } = makeContext({ jobs }, staticData);

		await poll(ctx);
		const second = await poll(ctx);
		expect(second).toBeNull();
	});

	it('keeps the cursor below its cap so nothing falls off the window (TEST-09)', async () => {
		expect(SEEN_JOB_CURSOR).toBeGreaterThan(MAX_POLL_LIMIT);
	});

	it('clamps a limit an expression pushed out of range (TEST-09)', async () => {
		const cases: Array<[unknown, number]> = [
			[600, MAX_POLL_LIMIT],
			[1e9, MAX_POLL_LIMIT],
			[-5, 50],
			['abc', 50],
			[0, 50],
			[200, 200],
			[25, 25],
		];
		for (const [given, expected] of cases) {
			const { ctx, requests } = makeContext({ jobs: [] }, {}, 'manual', { limit: given });
			await poll(ctx);
			expect((requests[0].qs as Record<string, unknown>).limit).toBe(expected);
		}
	});

	it('skips jobs with no id instead of collapsing them to one cursor entry (TEST-09)', async () => {
		const jobsRef = { jobs: [{ status: 'completed' } as unknown as Job] };
		const staticData: Record<string, unknown> = {};
		const { ctx } = makeContext(jobsRef, staticData, 'manual');

		const result = await poll(ctx);
		expect(result![0]).toHaveLength(0);
	});
});

describe('IbmQuantumTrigger.poll query string', () => {
	it('scans only finished jobs and drops circuit payloads', async () => {
		const { ctx, requests } = makeContext({ jobs: [] }, {}, 'manual');
		await poll(ctx);
		expect(requests[0].qs).toEqual({ limit: 20, pending: false, exclude_params: true });
	});

	it('passes the tag filter through when set', async () => {
		const { ctx, requests } = makeContext({ jobs: [] }, {}, 'manual', { tagFilter: ' vqe ' });
		await poll(ctx);
		expect(requests[0].qs).toEqual({
			limit: 20,
			pending: false,
			exclude_params: true,
			tags: ['vqe'],
		});
		// IBM only recognises repeated keys for an array value; the default encoding is ignored
		// and the filter would silently return every job.
		expect(requests[0].arrayFormat).toBe('repeat');
	});
});

describe('IbmQuantumTrigger.poll response normalization (TEST-10)', () => {
	function ctxWithResponse(response: unknown, mode: 'trigger' | 'manual' = 'manual') {
		const defaults: Record<string, unknown> = { statusFilter: 'any', tagFilter: '', limit: 20 };
		return {
			getNodeParameter: (name: string) => defaults[name],
			getCredentials: async () => ({ region: 'us-east', apiVersion: '2026-04-15' }),
			getMode: () => mode,
			getNode: () => ({ name: 'IBM Quantum Trigger' }),
			getWorkflowStaticData: () => ({}),
			helpers: {
				httpRequestWithAuthentication: async () => response,
				returnJsonArray: (data: Job[]) => data.map((json) => ({ json })),
			},
		};
	}

	it('reads jobs from a bare array response', async () => {
		const result = await poll(ctxWithResponse([{ id: 'a', status: 'completed' }]));
		expect(result![0][0].json.id).toBe('a');
	});

	it('reads jobs from a { workloads: [] } response', async () => {
		const result = await poll(ctxWithResponse({ workloads: [{ id: 'b', status: 'failed' }] }));
		expect(result![0][0].json.id).toBe('b');
	});

	// An empty body used to reach `response.jobs` as null and throw a bare TypeError, outside the
	// error wrapper, on every poll. transport.ts guards the action node; this is the trigger's copy.
	it('treats an empty body as no jobs instead of throwing', async () => {
		for (const body of [null, undefined, '', 0]) {
			const result = await poll(ctxWithResponse(body));
			expect(result![0]).toHaveLength(0);
		}
	});

	it('treats an empty body as no jobs in trigger mode too', async () => {
		expect(await poll(ctxWithResponse(null, 'trigger'))).toBeNull();
	});

	// Reading .id off a null entry threw a raw TypeError outside the error wrapper, and a polling
	// trigger would repeat it on every tick.
	it('skips a null entry in the jobs array instead of throwing', async () => {
		const result = await poll(
			ctxWithResponse({ jobs: [null, { id: 'a', status: 'completed' }] }),
		);
		expect(result![0].map((item) => item.json.id)).toEqual(['a']);
	});

	it('survives a list of nothing but null entries', async () => {
		const result = await poll(ctxWithResponse({ jobs: [null, undefined] }));
		expect(result![0]).toHaveLength(0);
	});

	it('survives a response whose jobs key is not an array', async () => {
		const result = await poll(ctxWithResponse({ jobs: 'nope' }));
		expect(result![0]).toHaveLength(0);
	});
});
