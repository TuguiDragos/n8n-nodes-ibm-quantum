import { describe, expect, it } from 'vitest';

import { IbmQuantumTrigger } from '../nodes/IbmQuantum/IbmQuantumTrigger.node';

type Job = { id: string; status: string };
type PollResult = Array<Array<{ json: Job }>> | null;

// Minimal IPollFunctions stand-in. `jobsRef.jobs` is the intercepted API response, and
// `staticData` is the persisted cursor that survives between polls, exactly like n8n.
function makeContext(
	jobsRef: { jobs: Job[] },
	staticData: Record<string, unknown>,
	mode: 'trigger' | 'manual' = 'trigger',
) {
	let httpCalls = 0;
	const ctx = {
		getNodeParameter: (name: string) => (name === 'statusFilter' ? 'any' : 20),
		getCredentials: async () => ({ region: 'us-east' }),
		getMode: () => mode,
		getNode: () => ({ name: 'IBM Quantum Trigger' }),
		getWorkflowStaticData: () => staticData,
		helpers: {
			httpRequestWithAuthentication: async () => {
				httpCalls += 1;
				return { jobs: jobsRef.jobs };
			},
			returnJsonArray: (data: Job[]) => data.map((json) => ({ json })),
		},
	};
	return { ctx, httpCalls: () => httpCalls };
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

	it('caps the seen-id cursor at 500 entries (TEST-09)', async () => {
		// A real poll window is <=200, so >500 in one poll is unreachable via the API; this only
		// pins the slice(-500) bound so the cursor cannot grow without limit.
		const jobs = Array.from({ length: 600 }, (_, i) => ({ id: `j${i}`, status: 'completed' }));
		const staticData: Record<string, unknown> = {};
		const { ctx } = makeContext({ jobs }, staticData);

		await poll(ctx);
		expect((staticData.seenJobIds as string[]).length).toBe(500);
	});

	it('skips jobs with no id instead of collapsing them to one cursor entry (TEST-09)', async () => {
		const jobsRef = { jobs: [{ status: 'completed' } as unknown as Job] };
		const staticData: Record<string, unknown> = {};
		const { ctx } = makeContext(jobsRef, staticData, 'manual');

		const result = await poll(ctx);
		expect(result![0]).toHaveLength(0);
	});
});

describe('IbmQuantumTrigger.poll response normalization (TEST-10)', () => {
	function ctxWithResponse(response: unknown, mode: 'trigger' | 'manual' = 'manual') {
		return {
			getNodeParameter: (name: string) => (name === 'statusFilter' ? 'any' : 20),
			getCredentials: async () => ({ region: 'us-east' }),
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
});
