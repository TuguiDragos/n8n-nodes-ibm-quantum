import { describe, expect, it } from 'vitest';

import { handleAccount, handleJob, handleSession } from '../nodes/IbmQuantum/operations';
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

	it('handleAccount rejects an unknown operation', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({}) });
		await expect(handleAccount.call(ctx, TEST_CTX, 'foo')).rejects.toThrow(
			/Unsupported account operation: foo/,
		);
		expect(requests).toHaveLength(0);
	});
});
