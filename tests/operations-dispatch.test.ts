import { describe, expect, it } from 'vitest';

import {
	handleAccount,
	handleJob,
	handleSession,
	handleWorkload,
} from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

const base = TEST_CTX.baseUrl;

describe('handleSession request shapes (TEST-04)', () => {
	it('creates a session, adding max_ttl only when positive', async () => {
		const withTtl = makeExecuteContext({
			params: { mode: 'batch', sessionBackend: 'ibm_kingston', maxTtl: 28800 },
			http: () => ({ id: 'sess-1' }),
		});
		const created = (await handleSession.call(withTtl.ctx, TEST_CTX, 'create', 0)) as Record<string, unknown>;
		expect(withTtl.requests[0]).toMatchObject({ method: 'POST', url: `${base}/sessions` });
		expect(withTtl.requests[0].body).toEqual({ mode: 'batch', backend: 'ibm_kingston', max_ttl: 28800 });
		expect(created).toMatchObject({ sessionId: 'sess-1', mode: 'batch', backend: 'ibm_kingston' });

		const noTtl = makeExecuteContext({
			params: { mode: 'dedicated', sessionBackend: 'ibm_fez', maxTtl: 0 },
			http: () => ({ id: 'sess-2' }),
		});
		await handleSession.call(noTtl.ctx, TEST_CTX, 'create', 0);
		expect(noTtl.requests[0].body).toEqual({ mode: 'dedicated', backend: 'ibm_fez' });
	});

	it('gets a session by id', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { sessionId: 'sess-1' }, http: () => ({}) });
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
		const { ctx, requests } = makeExecuteContext({ params: { sessionId: 'sess-1' }, http: () => ({}) });
		const result = await handleSession.call(ctx, TEST_CTX, 'close', 0);
		expect(requests[0]).toMatchObject({ method: 'DELETE', url: `${base}/sessions/sess-1/close` });
		expect(result).toEqual({ sessionId: 'sess-1', closed: true });
	});
});

describe('handleJob dispatch (TEST-12)', () => {
	it('lists jobs with a limit and drops circuit payloads by default', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { limit: 10 }, http: () => ({ jobs: [] }) });
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

	it('gets a job status by id', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { jobId: 'job-1' }, http: () => ({}) });
		await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/jobs/job-1` });
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
	it.each([['', 'gol'], ['ab', 'prea scurt'], ['x'.repeat(101), 'prea lung']])(
		'refuses a search that is %s (%s) before spending a request',
		async (search) => {
			const { ctx, requests } = makeExecuteContext({ params: { tagSearch: search }, http: () => ({}) });
			await expect(handleJob.call(ctx, TEST_CTX, 'listTags', 0)).rejects.toThrow(
				/Search must be between 3 and 100 characters/,
			);
			expect(requests).toHaveLength(0);
		},
	);

	it('accepts a term at the lower bound', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { tagSearch: 'qa-' }, http: () => ({}) });
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

	it('rejects an unknown workload operation', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await expect(handleWorkload.call(ctx, TEST_CTX, 'delete', 0)).rejects.toThrow(
			/Unsupported workload operation: delete/,
		);
		expect(requests).toHaveLength(0);
	});
});

describe('handleAccount endpoints (TEST-12)', () => {
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
		const { ctx, requests } = makeExecuteContext({ params: { sessionId: 'sess-1' }, http: () => ({}) });
		await expect(handleSession.call(ctx, TEST_CTX, 'stop', 0)).rejects.toThrow(
			/Unsupported session operation: stop/,
		);
		expect(requests).toHaveLength(0);
	});

	// Set Cost Limit was removed in 0.5.0 because IBM's write endpoint stopped answering. A saved
	// workflow still carrying it must fail here, immediately and by name, rather than reach any
	// request. This is the whole safety argument for removing the operation instead of keeping it.
	it('handleAccount refuses the removed setCostLimit without writing anything', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { instanceLimit: 600 },
			http: () => ({}),
		});
		await expect(handleAccount.call(ctx, TEST_CTX, 'setCostLimit', 0)).rejects.toThrow(
			/Unsupported account operation: setCostLimit/,
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
