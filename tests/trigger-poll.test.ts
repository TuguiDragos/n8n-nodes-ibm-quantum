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
});
