import { describe, expect, it } from 'vitest';

import {
	handleAccount,
	handleJob,
	handleSession,
	handleWorkload,
	IBM_QUANTUM_RESOURCE_ID,
	MAX_INSTANCE_PAGES,
	MAX_WORKLOAD_PAGES,
	nextPageToken,
} from '../nodes/IbmQuantum/operations';
import {
	makeExecuteContext,
	TEST_ACCOUNT_ID,
	TEST_CRN,
	TEST_CTX,
	type HttpCall,
} from './fakeContext';

const base = TEST_CTX.baseUrl;

describe('handleSession request shapes (TEST-04)', () => {
	it('creates a session, adding max_ttl only when positive', async () => {
		const withTtl = makeExecuteContext({
			params: { mode: 'batch', sessionBackend: 'ibm_kingston', maxTtl: 28800 },
			http: () => ({ id: 'sess-1' }),
		});
		const created = (await handleSession.call(withTtl.ctx, TEST_CTX, 'create', 0)) as Record<
			string,
			unknown
		>;
		expect(withTtl.requests[0]).toMatchObject({ method: 'POST', url: `${base}/sessions` });
		expect(withTtl.requests[0].body).toEqual({
			mode: 'batch',
			backend: 'ibm_kingston',
			max_ttl: 28800,
		});
		expect(created).toMatchObject({ sessionId: 'sess-1', mode: 'batch', backend: 'ibm_kingston' });

		const noTtl = makeExecuteContext({
			params: { mode: 'dedicated', sessionBackend: 'ibm_fez', maxTtl: 0 },
			http: () => ({ id: 'sess-2' }),
		});
		await handleSession.call(noTtl.ctx, TEST_CTX, 'create', 0);
		expect(noTtl.requests[0].body).toEqual({ mode: 'dedicated', backend: 'ibm_fez' });
	});

	// Measured live on 2026-09-08: a mode naming neither batch nor dedicated reached IBM and came
	// back as a bare "Internal server error", which names no field. It is refused here instead.
	it.each([['nonsense'], ['toString'], [42], [['batch']]])(
		'refuses a Session Mode of %s before any request',
		async (sessionMode) => {
			const { ctx, requests } = makeExecuteContext({
				typeVersion: 2,
				params: { sessionMode, sessionBackend: 'ibm_fez' },
				http: () => ({}),
			});
			await expect(handleSession.call(ctx, TEST_CTX, 'create', 0)).rejects.toThrow(
				'Session Mode must be one of batch, dedicated.',
			);
			expect(requests).toHaveLength(0);
		},
	);

	// An options value an expression leaves empty keeps the default, the rule the release applies
	// to every options field.
	it.each([[undefined], [null], [''], ['   ']])(
		'keeps batch when Session Mode resolves to %s',
		async (sessionMode) => {
			const { ctx, requests } = makeExecuteContext({
				typeVersion: 2,
				params: { sessionMode, sessionBackend: 'ibm_fez', maxTtl: 0 },
				http: () => ({ id: 'sess-1' }),
			});
			await handleSession.call(ctx, TEST_CTX, 'create', 0);
			expect(requests[0].body).toEqual({ mode: 'batch', backend: 'ibm_fez' });
		},
	);

	it('gets a session by id', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { sessionId: 'sess-1' },
			http: () => ({}),
		});
		await handleSession.call(ctx, TEST_CTX, 'get', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/sessions/sess-1` });
	});

	it('sets accepting jobs with a PATCH and reports the requested state', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { sessionId: 'sess-1', acceptingJobs: false },
			http: () => ({}),
		});
		const result = await handleSession.call(ctx, TEST_CTX, 'setAccepting', 0);
		const call = requests[0] as HttpCall;
		expect(call.method).toBe('PATCH');
		expect(call.url).toBe(`${base}/sessions/sess-1`);
		expect(call.body).toEqual({ accepting_jobs: false });
		expect(result).toEqual({ sessionId: 'sess-1', acceptingJobs: false });
	});

	it('closes a session with a DELETE to /sessions/:id/close', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { sessionId: 'sess-1' },
			http: () => ({}),
		});
		const result = await handleSession.call(ctx, TEST_CTX, 'close', 0);
		expect(requests[0]).toMatchObject({ method: 'DELETE', url: `${base}/sessions/sess-1/close` });
		expect(result).toEqual({ sessionId: 'sess-1', closed: true });
	});
});

describe('handleJob dispatch (TEST-12)', () => {
	it('lists jobs with a limit and drops circuit payloads by default', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { limit: 10 },
			http: () => ({ jobs: [] }),
		});
		await handleJob.call(ctx, TEST_CTX, 'list', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/jobs` });
		expect(requests[0].qs).toEqual({ limit: 10, exclude_params: true });
	});

	it('maps list filters onto the API query string', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				limit: 5,
				listFilters: {
					backend: 'ibm_kingston',
					sessionId: 'sess-1',
					tag: 'vqe',
					pending: 'finished',
					createdAfter: '2026-07-01T00:00:00.000Z',
					sort: 'asc',
					offset: 10,
					includeParams: true,
				},
			},
			http: () => ({ jobs: [] }),
		});
		await handleJob.call(ctx, TEST_CTX, 'list', 0);
		expect(requests[0].qs).toEqual({
			limit: 5,
			exclude_params: false,
			backend: 'ibm_kingston',
			session_id: 'sess-1',
			tags: ['vqe'],
			pending: false,
			created_after: '2026-07-01T00:00:00.000Z',
			sort: 'ASC',
			offset: 10,
		});
	});

	it('gets job metrics from /jobs/:id/metrics', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { jobId: 'job-1' }, http: () => ({}) });
		await handleJob.call(ctx, TEST_CTX, 'getMetrics', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/jobs/job-1/metrics` });
	});

	it('wraps the plain-text logs response into a structured item', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'job-1' },
			http: () => 'line one\nline two',
		});
		const result = await handleJob.call(ctx, TEST_CTX, 'getLogs', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/jobs/job-1/logs` });
		expect(result).toEqual({ jobId: 'job-1', logs: 'line one\nline two' });
	});

	it('replaces tags with a PUT and reports the parsed list', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'job-1', jobTags: 'a, b' },
			http: () => ({}),
		});
		const result = await handleJob.call(ctx, TEST_CTX, 'updateTags', 0);
		expect(requests[0]).toMatchObject({ method: 'PUT', url: `${base}/jobs/job-1/tags` });
		expect(requests[0].body).toEqual({ tags: ['a', 'b'] });
		expect(result).toEqual({ jobId: 'job-1', tags: ['a', 'b'] });
	});

	it('gets a job status by id, circuit included by default', async () => {
		const body = { id: 'job-1', state: { status: 'Queued' }, params: { pubs: [] } };
		const { ctx, requests } = makeExecuteContext({ params: { jobId: 'job-1' }, http: () => body });
		const result = await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/jobs/job-1` });
		expect(requests[0].qs).toEqual({ exclude_params: false });
		expect(result).toEqual(body);
	});

	it('drops the circuit from Get Status when Include Circuit Params is off', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'job-1', includeParams: false },
			http: () => ({ id: 'job-1', state: { status: 'Running' } }),
		});
		const result = await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		expect(requests[0].url).toBe(`${base}/jobs/job-1`);
		expect(requests[0].qs).toEqual({ exclude_params: true });
		expect(result).toEqual({ id: 'job-1', state: { status: 'Running' } });
	});

	// A workflow saved before the toggle existed, or an expression that resolves to nothing, keeps
	// the body this operation always returned.
	it.each([[undefined], [null], [''], ['  ']])(
		'keeps the circuit when the toggle resolves to %s',
		async (given) => {
			const { ctx, requests } = makeExecuteContext({
				params: { jobId: 'job-1', includeParams: given },
				http: () => ({}),
			});
			await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
			expect(requests[0].qs).toEqual({ exclude_params: false });
		},
	);

	// An expression hands the toggle over untouched, so every spelling of off has to opt out.
	it.each([[false], ['false'], ['FALSE'], [' false '], [0], ['0']])(
		'drops the circuit when the toggle resolves to %s',
		async (given) => {
			const { ctx, requests } = makeExecuteContext({
				params: { jobId: 'job-1', includeParams: given },
				http: () => ({}),
			});
			await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
			expect(requests[0].qs).toEqual({ exclude_params: true });
		},
	);

	it('refuses a toggle that spells neither true nor false', async () => {
		const { ctx } = makeExecuteContext({
			params: { jobId: 'job-1', includeParams: 'maybe' },
			http: () => ({}),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
			'Include Circuit Params must be true or false.',
		);
	});

	it('cancels a job with a POST to /jobs/:id/cancel', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { jobId: 'job-1' }, http: () => ({}) });
		const result = await handleJob.call(ctx, TEST_CTX, 'cancel', 0);
		expect(requests[0]).toMatchObject({ method: 'POST', url: `${base}/jobs/job-1/cancel` });
		expect(result).toEqual({ jobId: 'job-1', cancelled: true });
	});

	it('deletes a job with a DELETE to /jobs/:id', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { jobId: 'job-1' }, http: () => ({}) });
		const result = await handleJob.call(ctx, TEST_CTX, 'delete', 0);
		expect(requests[0]).toMatchObject({ method: 'DELETE', url: `${base}/jobs/job-1` });
		expect(result).toEqual({ jobId: 'job-1', deleted: true });
	});
});

describe('session mode across node versions', () => {
	it('reads sessionMode on version 2', async () => {
		const { ctx, requests } = makeExecuteContext({
			typeVersion: 2,
			params: { sessionMode: 'dedicated', sessionBackend: 'ibm_fez', maxTtl: 0 },
			http: () => ({ id: 'sess-v2' }),
		});
		await handleSession.call(ctx, TEST_CTX, 'create', 0);
		expect(requests[0].body).toEqual({ mode: 'dedicated', backend: 'ibm_fez' });
	});

	it('still reads mode on a version 1 workflow, which stores the value under that name', async () => {
		const { ctx, requests } = makeExecuteContext({
			typeVersion: 1,
			params: { mode: 'dedicated', sessionBackend: 'ibm_fez', maxTtl: 0 },
			http: () => ({ id: 'sess-v1' }),
		});
		await handleSession.call(ctx, TEST_CTX, 'create', 0);
		expect(requests[0].body).toEqual({ mode: 'dedicated', backend: 'ibm_fez' });
	});

	it('ignores the other version’s parameter rather than mixing the two', async () => {
		// A version 2 node carrying a stale `mode` value must not pick it up, or a workflow migrated
		// by hand would silently keep running the old choice.
		const { ctx, requests } = makeExecuteContext({
			typeVersion: 2,
			params: { mode: 'dedicated', sessionBackend: 'ibm_fez', maxTtl: 0 },
			http: () => ({ id: 'sess-mixed' }),
		});
		await handleSession.call(ctx, TEST_CTX, 'create', 0);
		expect(requests[0].body).toEqual({ mode: 'batch', backend: 'ibm_fez' });
	});
});

describe('job tag listing', () => {
	it('always sends the type the API requires, and passes the search through', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { tagSearch: '  experiment  ' },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'listTags', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/tags` });
		expect(requests[0].qs).toEqual({ type: 'job', search: 'experiment' });
	});

	// Found live: IBM answers a search shorter than 3 characters with a bare 400 that names
	// neither the field nor the limit, so the bound is enforced before the request goes out.
	it.each([
		['', 'gol'],
		['ab', 'prea scurt'],
		['x'.repeat(101), 'prea lung'],
	])('refuses a search that is %s (%s) before spending a request', async (search) => {
		const { ctx, requests } = makeExecuteContext({
			params: { tagSearch: search },
			http: () => ({}),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'listTags', 0)).rejects.toThrow(
			/Search must be between 3 and 100 characters/,
		);
		expect(requests).toHaveLength(0);
	});

	it('accepts a term at the lower bound', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { tagSearch: 'qa-' },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'listTags', 0);
		expect(requests[0].qs).toEqual({ type: 'job', search: 'qa-' });
	});
});

describe('handleWorkload listing', () => {
	it('asks for newest first and the capped limit by default', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/workloads` });
		expect(requests[0].qs).toEqual({ limit: 50, sort: '-createdAt' });
	});

	it('caps the limit at the 50 this endpoint allows, well below the jobs listing', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { limit: 200 }, http: () => ({}) });
		await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect((requests[0].qs as Record<string, unknown>).limit).toBe(50);
	});

	it('maps every filter to its API name, including the renamed mode', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				limit: 25,
				workloadFilters: {
					backend: 'ibm_kingston',
					createdAfter: '2026-08-01T00:00:00Z',
					createdBefore: '2026-08-17T00:00:00Z',
					next: 'cursor-next',
					previous: 'cursor-prev',
					search: 'bell',
					workloadMode: 'session',
					status: ['completed', 'failed'],
					tags: 'experiment-7, vqe',
					sort: 'createdAt',
				},
			},
			http: () => ({}),
		});
		await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect(requests[0].qs).toEqual({
			limit: 25,
			backend: 'ibm_kingston',
			created_after: '2026-08-01T00:00:00Z',
			created_before: '2026-08-17T00:00:00Z',
			next: 'cursor-next',
			previous: 'cursor-prev',
			search: 'bell',
			mode: 'session',
			status: ['completed', 'failed'],
			tags: ['experiment-7', 'vqe'],
			sort: 'createdAt',
		});
	});

	it('lifts the paging tokens out of the links IBM returns, body untouched', async () => {
		const body = {
			workloads: [{ id: 'w1' }],
			total_count: 3,
			limit: 1,
			previous: { href: 'https://quantum.cloud.ibm.com/api/v1/workloads?previous=aaa111&limit=1' },
			next: { href: 'https://quantum.cloud.ibm.com/api/v1/workloads?limit=1&next=bbb222' },
		};
		const { ctx } = makeExecuteContext({ http: () => body });
		expect(await handleWorkload.call(ctx, TEST_CTX, 'list', 0)).toEqual({
			...body,
			nextCursor: 'bbb222',
			previousCursor: 'aaa111',
		});
	});

	it('reports null cursors when IBM sends no links, or links without the parameter', async () => {
		const bare = makeExecuteContext({ http: () => ({ workloads: [] }) });
		expect(await handleWorkload.call(bare.ctx, TEST_CTX, 'list', 0)).toEqual({
			workloads: [],
			nextCursor: null,
			previousCursor: null,
		});

		// A string `previous` goes through asCollection to {}, so its href is undefined.
		const unusable = makeExecuteContext({
			http: () => ({
				next: { href: 'https://x/workloads?limit=5' },
				previous: 'https://x/workloads?previous=1',
			}),
		});
		expect(await handleWorkload.call(unusable.ctx, TEST_CTX, 'list', 0)).toMatchObject({
			nextCursor: null,
			previousCursor: null,
		});
	});

	it('rejects an unknown workload operation', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await expect(handleWorkload.call(ctx, TEST_CTX, 'delete', 0)).rejects.toThrow(
			/Unsupported workload operation: delete/,
		);
		expect(requests).toHaveLength(0);
	});
});

describe('handleWorkload with Return All', () => {
	const link = (cursor: string) => ({ href: `${base}/workloads?limit=50&next=${cursor}` });

	it('follows the next link page by page, ignoring Limit, and merges the pages', async () => {
		const pages = [
			{ workloads: [{ id: 'w1' }], total_count: 3, limit: 50, next: link('tok2') },
			{ workloads: [{ id: 'w2' }], total_count: 3, limit: 50, next: link('tok3') },
			{ workloads: [{ id: 'w3' }], total_count: 3, limit: 50 },
		];
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: true, limit: 5, workloadFilters: { workloadMode: 'session' } },
			http: (_call, index) => pages[index],
		});
		const result = await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect(requests).toHaveLength(3);
		for (const request of requests) {
			expect(request.qs).toMatchObject({ limit: 50, mode: 'session', sort: '-createdAt' });
		}
		expect('next' in (requests[0].qs as object)).toBe(false);
		expect((requests[1].qs as { next: string }).next).toBe('tok2');
		expect((requests[2].qs as { next: string }).next).toBe('tok3');
		expect(result).toEqual({
			workloads: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }],
			total_count: 3,
			limit: 50,
			nextCursor: null,
			previousCursor: null,
		});
	});

	it('stops at the page cap and hands back the cursor to carry on from', async () => {
		// Every page carries a cursor of its own, which is the only way the cap is what ends the walk.
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: true },
			http: (_call, index) => ({ workloads: [{ id: `w${index}` }], next: link(`tok${index}`) }),
		});
		const result = await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect(requests).toHaveLength(MAX_WORKLOAD_PAGES);
		expect((result.workloads as unknown[]).length).toBe(MAX_WORKLOAD_PAGES);
		expect(result.truncated).toBe(true);
		expect(result.nextCursor).toBe(`tok${MAX_WORKLOAD_PAGES - 1}`);
	});

	it('stops on a cursor IBM repeats rather than walking the same page to the cap', async () => {
		// The cursor never advances, so before the dedupe this fetched the identical page 20 times
		// and returned the one workload on it 20 times over.
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: true },
			http: () => ({ workloads: [{ id: 'w' }], next: link('more') }),
		});
		const result = await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect(requests).toHaveLength(2);
		expect(result.workloads).toEqual([{ id: 'w' }]);
		// A looping cursor is still a walk that never reached the end, so it stays flagged.
		expect(result.truncated).toBe(true);
		expect(result.nextCursor).toBe('more');
	});

	it('keeps entries a page repeats without an id, and drops the ones that carry a repeated id', async () => {
		const pages = [
			{ workloads: [{ id: 'w1' }, { name: 'no id' }], next: link('tok2') },
			{ workloads: [{ id: 'w1' }, { name: 'no id' }, { id: 'w2' }] },
		];
		const { ctx } = makeExecuteContext({
			params: { returnAll: true },
			http: (_call, index) => pages[index],
		});
		const result = await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect(result.workloads).toEqual([
			{ id: 'w1' },
			{ name: 'no id' },
			{ name: 'no id' },
			{ id: 'w2' },
		]);
	});

	it('treats a page without a workloads array as empty and a cursorless link as the end', async () => {
		const pages = [
			{ next: link('tok2'), workloads: null },
			{ next: { href: `${base}/workloads?limit=50` } },
		];
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: true },
			http: (_call, index) => pages[index],
		});
		const result = await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect(requests).toHaveLength(2);
		expect(result).toMatchObject({ workloads: [], nextCursor: null });
		expect(result).not.toHaveProperty('truncated');
	});

	it('pages for the text an expression produces, the same as for the boolean', async () => {
		const pages = [
			{ workloads: [{ id: 'w1' }], next: link('tok2') },
			{ workloads: [{ id: 'w2' }] },
		];
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: 'true', limit: 5 },
			http: (_call, index) => pages[index],
		});
		const result = await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect(requests).toHaveLength(2);
		expect((requests[0].qs as { limit: number }).limit).toBe(50);
		expect(result).toMatchObject({ workloads: [{ id: 'w1' }, { id: 'w2' }] });
	});

	it('leaves paging off for the text that spells off', async () => {
		const body = { workloads: [{ id: 'w1' }], next: link('tok2') };
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: 'false', limit: 5 },
			http: () => body,
		});
		const result = await handleWorkload.call(ctx, TEST_CTX, 'list', 0);
		expect(requests).toHaveLength(1);
		expect((requests[0].qs as { limit: number }).limit).toBe(5);
		expect(result).toEqual({ ...body, nextCursor: 'tok2', previousCursor: null });
	});

	it('refuses a Return All that spells neither', async () => {
		const { ctx } = makeExecuteContext({ params: { returnAll: 'all' }, http: () => ({}) });
		await expect(handleWorkload.call(ctx, TEST_CTX, 'list', 0)).rejects.toThrow(
			'Return All must be true or false. An expression may also hand over "true", "false", 1 or 0.',
		);
	});
});

describe('handleAccount endpoints (TEST-12)', () => {
	// Only the account operations read the CRN off the request context; every other test keeps the
	// bare TEST_CTX, which is what the node builds for a credential without one.
	const ACCOUNT_CTX = { ...TEST_CTX, instanceCrn: TEST_CRN };
	const crnWithScope = (scope: string) =>
		`crn:v1:bluemix:public:quantum-computing:us-east:${scope}:0f1e2d3c-4b5a::`;

	it('maps getUsage to /instances/usage (plural)', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await handleAccount.call(ctx, TEST_CTX, 'getUsage');
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/instances/usage` });
	});

	it('maps getInstance to /instance (singular)', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await handleAccount.call(ctx, TEST_CTX, 'getInstance');
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/instance` });
	});

	it('maps getConfiguration to /instances/configuration', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await handleAccount.call(ctx, TEST_CTX, 'getConfiguration');
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/instances/configuration` });
	});

	it('sends an empty query for usage analytics when no filter is set', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await handleAccount.call(ctx, TEST_CTX, 'getAnalytics', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/analytics/usage` });
		expect(requests[0].qs).toEqual({});
	});

	it('splits list filters into arrays and keeps simulators off the query unless disabled', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				analyticsFilters: {
					backend: 'ibm_kingston, ibm_fez',
					instance: 'inst-a',
					plan: 'open',
					subscriptionId: 'sub-1, sub-2',
					userId: 'user-9',
					intervalStart: '2026-08-01T00:00:00Z',
					intervalEnd: '2026-08-17T00:00:00Z',
					simulators: false,
				},
			},
			http: () => ({}),
		});
		await handleAccount.call(ctx, TEST_CTX, 'getAnalytics', 0);
		expect(requests[0].qs).toEqual({
			backend: ['ibm_kingston', 'ibm_fez'],
			instance: ['inst-a'],
			plan: ['open'],
			subscription_id: ['sub-1', 'sub-2'],
			user_id: ['user-9'],
			interval_start: '2026-08-01T00:00:00Z',
			interval_end: '2026-08-17T00:00:00Z',
			simulators: false,
		});
	});

	it('keeps simulators out of the query when left on, matching the API default', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { analyticsFilters: { simulators: true } },
			http: () => ({}),
		});
		await handleAccount.call(ctx, TEST_CTX, 'getAnalytics', 0);
		expect(requests[0].qs).toEqual({});
	});

	it('passes the chosen key to the grouped endpoint', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { groupBy: 'plan' }, http: () => ({}) });
		await handleAccount.call(ctx, TEST_CTX, 'getAnalyticsGrouped', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/analytics/usage_grouped` });
		expect((requests[0].qs as Record<string, unknown>).group_by).toBe('plan');
	});

	it('forces group_by to instance on the by-date endpoint, the only value it accepts', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { groupBy: 'plan' }, http: () => ({}) });
		await handleAccount.call(ctx, TEST_CTX, 'getAnalyticsByDate', 0);
		expect(requests[0].url).toBe(`${base}/analytics/usage_grouped_by_date`);
		expect((requests[0].qs as Record<string, unknown>).group_by).toBe('instance');
	});

	it('maps getApiVersions to /versions', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await handleAccount.call(ctx, TEST_CTX, 'getApiVersions', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/versions` });
	});

	it('requests the analytics filter values without a query', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await handleAccount.call(ctx, TEST_CTX, 'getAnalyticsFilters', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/analytics/filters` });
		expect(requests[0].qs).toBeUndefined();
	});

	it('maps getAccountConfiguration to /accounts/{id}, with the id read from the credential CRN and no query', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({ plans: [] }) });
		const result = await handleAccount.call(ctx, ACCOUNT_CTX, 'getAccountConfiguration', 0);
		expect(requests[0]).toMatchObject({
			method: 'GET',
			url: `${base}/accounts/${TEST_ACCOUNT_ID}`,
		});
		expect(requests[0].qs).toBeUndefined();
		expect(result).toEqual({ plans: [] });
	});

	it('sends plan_id when Plan ID is set, trimmed', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { planId: '  850b21a7-71de-4e53-9441-1abdd202f35d ' },
			http: () => ({ plans: [] }),
		});
		await handleAccount.call(ctx, ACCOUNT_CTX, 'getAccountConfiguration', 0);
		expect(requests[0].qs).toEqual({ plan_id: '850b21a7-71de-4e53-9441-1abdd202f35d' });
	});

	it('sends a numeric Plan ID as text and drops a value an expression left empty or non-text', async () => {
		const numeric = makeExecuteContext({ params: { planId: 42 }, http: () => ({}) });
		await handleAccount.call(numeric.ctx, ACCOUNT_CTX, 'getAccountConfiguration', 0);
		expect(numeric.requests[0].qs).toEqual({ plan_id: '42' });

		const blank = makeExecuteContext({ params: { planId: '   ' }, http: () => ({}) });
		await handleAccount.call(blank.ctx, ACCOUNT_CTX, 'getAccountConfiguration', 0);
		expect(blank.requests[0].qs).toBeUndefined();

		const object = makeExecuteContext({ params: { planId: { id: 'x' } }, http: () => ({}) });
		await handleAccount.call(object.ctx, ACCOUNT_CTX, 'getAccountConfiguration', 0);
		expect(object.requests[0].qs).toBeUndefined();
	});

	it('refuses a Plan ID longer than 64 characters before any request', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { planId: 'x'.repeat(65) },
			http: () => ({}),
		});
		await expect(
			handleAccount.call(ctx, ACCOUNT_CTX, 'getAccountConfiguration', 0),
		).rejects.toThrow(/Plan ID is 65 characters, longer than the 64 IBM accepts/);
		expect(requests).toHaveLength(0);
	});

	it('refuses to guess the account when the CRN carries no a/ segment', async () => {
		const missing = makeExecuteContext({ http: () => ({}) });
		await expect(
			handleAccount.call(missing.ctx, TEST_CTX, 'getAccountConfiguration', 0),
		).rejects.toThrow(/Instance CRN carries no account segment/);
		expect(missing.requests).toHaveLength(0);

		const organisation = makeExecuteContext({ http: () => ({}) });
		await expect(
			handleAccount.call(
				organisation.ctx,
				{ ...TEST_CTX, instanceCrn: crnWithScope('o/org-1') },
				'getAccountConfiguration',
				0,
			),
		).rejects.toThrow(/Instance CRN carries no account segment/);
		expect(organisation.requests).toHaveLength(0);
	});

	it('refuses an account id outside the characters IBM accepts', async () => {
		const spaced = makeExecuteContext({ http: () => ({}) });
		await expect(
			handleAccount.call(
				spaced.ctx,
				{ ...TEST_CTX, instanceCrn: crnWithScope('a/abc def') },
				'getAccountConfiguration',
				0,
			),
		).rejects.toThrow(/not one IBM accepts/);
		expect(spaced.requests).toHaveLength(0);

		const long = makeExecuteContext({ http: () => ({}) });
		await expect(
			handleAccount.call(
				long.ctx,
				{ ...TEST_CTX, instanceCrn: crnWithScope(`a/${'a'.repeat(65)}`) },
				'getAccountConfiguration',
				0,
			),
		).rejects.toThrow(/not one IBM accepts/);
		expect(long.requests).toHaveLength(0);
	});

	it('refuses an account id without repeating the credential segment it read', async () => {
		const mispaste = 'AbCdEf01-GhIjKl23_MnOpQr45StUvWx67YzAbCdEf89';
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		const failure = await handleAccount
			.call(
				ctx,
				{ ...TEST_CTX, instanceCrn: crnWithScope(`a/${mispaste}.x`) },
				'getAccountConfiguration',
				0,
			)
			.catch((error: Error) => error);
		expect((failure as Error).message).toBe(
			"The account id in the credential's Instance CRN is not one IBM accepts: letters, digits, - and _ only, at most 64 characters.",
		);
		expect(requests).toHaveLength(0);
	});

	it('lets the shared identifier guard name a dots-only account id', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await expect(
			handleAccount.call(
				ctx,
				{ ...TEST_CTX, instanceCrn: crnWithScope('a/...') },
				'getAccountConfiguration',
				0,
			),
		).rejects.toThrow(/Account ID "\.\.\." is not a valid identifier/);
		expect(requests).toHaveLength(0);
	});
});

// Both operations leave the Qiskit Runtime hosts for IBM Cloud's Resource Controller, so every
// assertion here also pins the host: a request built against the wrong base would still look
// right in isolation.
const rc = 'https://resource-controller.cloud.ibm.com';

describe('handleAccount Get Many Instances (Resource Controller)', () => {
	it('lists IBM Quantum instances from the Resource Controller with the catalog id and a limit of 50', async () => {
		const body = { rows_count: 1, next_url: '', resources: [{ crn: TEST_CRN }] };
		const { ctx, requests } = makeExecuteContext({ http: () => body });
		const result = await handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0);
		expect(requests[0]).toMatchObject({
			method: 'GET',
			url: `${rc}/v2/resource_instances`,
			credentialName: 'ibmQuantumApi',
			json: true,
			timeout: 30000,
			arrayFormat: 'repeat',
		});
		expect(requests[0].qs).toEqual({ resource_id: IBM_QUANTUM_RESOURCE_ID, limit: 50 });
		expect(result).toBe(body);
	});

	it('clamps the limit to 1..100 and falls back to 50', async () => {
		for (const [limit, expected] of [
			[500, 100],
			['abc', 50],
			[0, 50],
			[7, 7],
		] as Array<[unknown, number]>) {
			const { ctx, requests } = makeExecuteContext({ params: { limit }, http: () => ({}) });
			await handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0);
			expect((requests[0].qs as { limit: number }).limit).toBe(expected);
		}
	});

	it('maps the plan word to the documented plan id, case-insensitively', async () => {
		for (const [plan, expected] of [
			['open', '850b21a7-71de-4e53-9441-1abdd202f35d'],
			[' Pay-As-You-Go ', '5304b575-3cff-4455-90dc-ae4367762093'],
			['premium', '7f666d17-7893-47d8-bf9d-2b2389fc4dfc'],
			['flex', '53bde9d3-cdbb-46f5-a98f-60ebcadf7260'],
		] as Array<[string, string]>) {
			const { ctx, requests } = makeExecuteContext({ params: { plan }, http: () => ({}) });
			await handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0);
			expect((requests[0].qs as { resource_plan_id: string }).resource_plan_id).toBe(expected);
		}

		for (const plan of ['', null]) {
			const { ctx, requests } = makeExecuteContext({ params: { plan }, http: () => ({}) });
			await handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0);
			expect('resource_plan_id' in (requests[0].qs as object)).toBe(false);
		}
	});

	it('refuses a plan it cannot map without sending a request', async () => {
		for (const plan of ['gold', 5, {}, false]) {
			const { ctx, requests } = makeExecuteContext({ params: { plan }, http: () => ({}) });
			await expect(handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0)).rejects.toThrow(
				/Plan ".*" is not one of flex, open, pay-as-you-go, premium/,
			);
			expect(requests).toHaveLength(0);
		}
	});

	it('follows next_url page by page when Return All is on, ignoring Limit', async () => {
		const pages = [
			{
				rows_count: 2,
				next_url: '/v2/resource_instances?resource_id=b60&start=tok2',
				resources: [{ crn: 'a' }, { crn: 'b' }],
			},
			{
				rows_count: 2,
				next_url: `${rc}/v2/resource_instances?start=tok3#x`,
				resources: [{ crn: 'c' }, { crn: 'd' }],
			},
			{ rows_count: 1, next_url: '', resources: [{ crn: 'e' }] },
		];
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: true, limit: 7, plan: 'open' },
			http: (_call, index) => pages[index],
		});
		const result = await handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0);
		expect(requests).toHaveLength(3);
		for (const request of requests) {
			expect(request.qs).toMatchObject({
				limit: 100,
				resource_plan_id: '850b21a7-71de-4e53-9441-1abdd202f35d',
			});
		}
		expect('start' in (requests[0].qs as object)).toBe(false);
		expect((requests[1].qs as { start: string }).start).toBe('tok2');
		expect((requests[2].qs as { start: string }).start).toBe('tok3');
		expect(result).toEqual({
			resources: [{ crn: 'a' }, { crn: 'b' }, { crn: 'c' }, { crn: 'd' }, { crn: 'e' }],
			rows_count: 5,
			next_url: '',
			truncated: false,
		});
	});

	it('stops at the page cap and says so', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: true },
			http: () => ({ next_url: '/v2/resource_instances?start=more', resources: [{ crn: 'x' }] }),
		});
		const result = await handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0);
		expect(requests).toHaveLength(MAX_INSTANCE_PAGES);
		expect(result.truncated).toBe(true);
		expect(result.next_url).toBe('/v2/resource_instances?start=more');
		expect(result.rows_count).toBe(MAX_INSTANCE_PAGES);
	});

	it('treats a page without a resources array as empty and an empty body as the end', async () => {
		const pages: unknown[] = [{ next_url: '?start=t', resources: null }, null];
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: true },
			http: (_call, index) => pages[index],
		});
		const result = await handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0);
		expect(requests).toHaveLength(2);
		expect(result).toEqual({ resources: [], rows_count: 0, next_url: '', truncated: false });
	});

	it('pages for the text an expression produces, the same as for the boolean', async () => {
		const pages = [
			{ next_url: '/v2/resource_instances?start=tok', resources: [{ crn: 'a' }] },
			{ resources: [{ crn: 'b' }] },
		];
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: 'true' },
			http: (_call, index) => pages[index],
		});
		const result = await handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0);
		expect(requests).toHaveLength(2);
		expect(result).toMatchObject({ resources: [{ crn: 'a' }, { crn: 'b' }], rows_count: 2 });
	});

	it('leaves paging off for the text that spells off, and refuses anything else', async () => {
		const body = { next_url: '/v2/resource_instances?start=tok', resources: [{ crn: 'a' }] };
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: '0' },
			http: () => body,
		});
		const result = await handleAccount.call(ctx, TEST_CTX, 'getManyInstances', 0);
		expect(requests).toHaveLength(1);
		expect(result).toBe(body);

		const refused = makeExecuteContext({ params: { returnAll: {} }, http: () => body });
		await expect(handleAccount.call(refused.ctx, TEST_CTX, 'getManyInstances', 0)).rejects.toThrow(
			'Return All must be true or false.',
		);
	});
});

describe('nextPageToken', () => {
	it('returns null for anything that carries no usable start token', () => {
		for (const value of [null, undefined, 7, '', 'no-query', '/v2?start=', '/v2?other=1']) {
			expect(nextPageToken(value)).toBeNull();
		}
	});

	it('reads the start parameter, decoded, ignoring any fragment', () => {
		expect(nextPageToken('/v2/resource_instances?resource_id=b60&start=tok')).toBe('tok');
		expect(nextPageToken('https://h/v2?start=t%2Bk#frag')).toBe('t+k');
		expect(nextPageToken('/v2?start=a#?start=b')).toBe('a');
	});
});

describe('handleAccount Set Cost Limit (Resource Controller)', () => {
	const CRN_CTX = { ...TEST_CTX, instanceCrn: TEST_CRN };
	const instanceBody = {
		crn: TEST_CRN,
		name: 'main',
		extensions: { instance_limit_seconds: 600, backends: ['ANY'] },
	};
	const parametersOf = (call: HttpCall) =>
		(call.body as { parameters: Record<string, unknown> }).parameters;

	it('PATCHes the credential instance with the limit and a fresh timestamp', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { instanceLimit: 600 },
			http: () => instanceBody,
		});
		const result = await handleAccount.call(ctx, CRN_CTX, 'setCostLimit', 0);
		expect(requests[0]).toMatchObject({
			method: 'PATCH',
			url: `${rc}/v2/resource_instances/${encodeURIComponent(TEST_CRN)}`,
			credentialName: 'ibmQuantumApi',
			json: true,
			timeout: 30000,
		});
		const parameters = parametersOf(requests[0]);
		expect(parameters.instance_limit_seconds).toBe(600);
		expect(Object.keys(parameters).sort()).toEqual(['instance_limit_seconds', 'timestamp']);
		const timestamp = parameters.timestamp as string;
		expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(Math.abs(Date.parse(timestamp) - Date.now())).toBeLessThan(5000);
		expect(result).toMatchObject({ crn: TEST_CRN, name: 'main', instanceLimitSeconds: 600 });
	});

	it('encodes every separator of the CRN into one path segment', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { instanceLimit: 600 },
			http: () => instanceBody,
		});
		await handleAccount.call(ctx, CRN_CTX, 'setCostLimit', 0);
		const segment = (requests[0].url as string).split('/resource_instances/')[1];
		expect(segment).toBe(encodeURIComponent(TEST_CRN));
		expect(segment).not.toContain(':');
		expect(segment).not.toContain('/');
	});

	it('gives two writes in one run two different values and a timestamp each', async () => {
		const { ctx, requests } = makeExecuteContext({
			itemParams: [{ instanceLimit: 100 }, { instanceLimit: 200 }],
			http: () => instanceBody,
		});
		await handleAccount.call(ctx, CRN_CTX, 'setCostLimit', 0);
		await handleAccount.call(ctx, CRN_CTX, 'setCostLimit', 1);
		expect(parametersOf(requests[0]).instance_limit_seconds).toBe(100);
		expect(parametersOf(requests[1]).instance_limit_seconds).toBe(200);
		expect(typeof parametersOf(requests[0]).timestamp).toBe('string');
		expect(typeof parametersOf(requests[1]).timestamp).toBe('string');
	});

	it('prefers the Instance CRN parameter over the credential', async () => {
		const other = 'crn:v1:bluemix:public:quantum-computing:eu-de:a/x:y::';
		const { ctx, requests } = makeExecuteContext({
			params: { instanceCrn: other, instanceLimit: 5 },
			http: () => instanceBody,
		});
		await handleAccount.call(ctx, CRN_CTX, 'setCostLimit', 0);
		expect(requests[0].url).toBe(`${rc}/v2/resource_instances/${encodeURIComponent(other)}`);
	});

	it('sends null only when Clear Limit is on, and then ignores Cost Limit', async () => {
		for (const params of [{ clearLimit: true }, { clearLimit: true, instanceLimit: 'nonsense' }]) {
			const { ctx, requests } = makeExecuteContext({
				params,
				http: () => ({ extensions: { instance_limit_seconds: null } }),
			});
			const result = await handleAccount.call(ctx, CRN_CTX, 'setCostLimit', 0);
			expect(parametersOf(requests[0]).instance_limit_seconds).toBeNull();
			expect(result.instanceLimitSeconds).toBeNull();
		}
	});

	it('refuses a value it cannot read before any request, so the cap is never cleared by accident', async () => {
		// 'clear' is in the list because it is not a keyword: only the Clear Limit switch clears.
		for (const instanceLimit of [0, -5, 1.5, 'nonsense', 'clear', '', null, []]) {
			const { ctx, requests } = makeExecuteContext({
				params: { instanceLimit },
				http: () => instanceBody,
			});
			await expect(handleAccount.call(ctx, CRN_CTX, 'setCostLimit', 0)).rejects.toThrow(
				/Cost Limit must be an integer at least 1\. Turn on Clear Limit to remove the limit\./,
			);
			expect(requests).toHaveLength(0);
		}
	});

	it('refuses a missing, malformed or traversing CRN before any request', async () => {
		const cases: Array<[Record<string, unknown>, string | undefined, RegExp]> = [
			[{}, '', /Instance CRN is required and cannot be empty/],
			[{}, undefined, /Instance CRN is required and cannot be empty/],
			[{}, '..', /is not a valid identifier/],
			[{}, '0f1e2d3c-guid', /does not start with crn:v1:/],
			[{ instanceCrn: '../backends' }, TEST_CRN, /does not start with crn:v1:/],
			[{ instanceCrn: 'a'.repeat(1001) }, TEST_CRN, /longer than the 1000/],
		];
		for (const [params, instanceCrn, message] of cases) {
			const { ctx, requests } = makeExecuteContext({
				params: { instanceLimit: 600, ...params },
				http: () => instanceBody,
			});
			await expect(
				handleAccount.call(ctx, { ...TEST_CTX, instanceCrn }, 'setCostLimit', 0),
			).rejects.toThrow(message);
			expect(requests).toHaveLength(0);
		}
	});

	it('refuses a CRN without repeating what it read, from either source', async () => {
		// The Instance CRN box sits under the API Key box and holds a string just as opaque, so a
		// refusal that quoted it would put a mis-pasted key in front of the workflow.
		const mispaste = 'AbCdEf01-GhIjKl23_MnOpQr45StUvWx67YzAbCdEf89';
		const sources: Array<[Record<string, unknown>, string]> = [
			[{}, mispaste],
			[{ instanceCrn: mispaste }, TEST_CRN],
		];
		for (const [params, instanceCrn] of sources) {
			const { ctx, requests } = makeExecuteContext({
				params: { instanceLimit: 600, ...params },
				http: () => instanceBody,
			});
			const failure = await handleAccount
				.call(ctx, { ...TEST_CTX, instanceCrn }, 'setCostLimit', 0)
				.catch((error: Error) => error);
			expect((failure as Error).message).toBe(
				'Instance CRN does not start with crn:v1:. Copy the full CRN from the IBM Quantum Platform instances page.',
			);
			expect(requests).toHaveLength(0);
		}
	});

	it('reports null when the response carries no readable extensions', async () => {
		for (const body of [
			{},
			{ extensions: { instance_limit_seconds: '600' } },
			{ extensions: 'x' },
			null,
		]) {
			const { ctx } = makeExecuteContext({ params: { instanceLimit: 600 }, http: () => body });
			const result = await handleAccount.call(ctx, CRN_CTX, 'setCostLimit', 0);
			expect(result.instanceLimitSeconds).toBeNull();
		}
	});
});

describe('unknown operations fail loudly instead of falling through', () => {
	it('handleJob rejects an unknown operation without sending a request', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { jobId: 'job-1' }, http: () => ({}) });
		await expect(handleJob.call(ctx, TEST_CTX, 'nuke', 0)).rejects.toThrow(
			/Unsupported job operation: nuke/,
		);
		// The old fallthrough would have issued DELETE /jobs/job-1 here.
		expect(requests).toHaveLength(0);
	});

	it('handleSession rejects an unknown operation without closing the session', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { sessionId: 'sess-1' },
			http: () => ({}),
		});
		await expect(handleSession.call(ctx, TEST_CTX, 'stop', 0)).rejects.toThrow(
			/Unsupported session operation: stop/,
		);
		expect(requests).toHaveLength(0);
	});

	it('handleAccount rejects an unknown operation', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await expect(handleAccount.call(ctx, TEST_CTX, 'foo')).rejects.toThrow(
			/Unsupported account operation: foo/,
		);
		expect(requests).toHaveLength(0);
	});
});
