import { describe, expect, it } from 'vitest';

import { handleAccount, handleJob, handleSession } from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

const base = TEST_CTX.baseUrl;

describe('handleSession request shapes (TEST-04)', () => {
	it('creates a session, adding max_ttl only when positive', async () => {
		const withTtl = makeExecuteContext({
			params: { mode: 'batch', sessionBackend: 'ibm_brisbane', maxTtl: 28800 },
			http: () => ({ id: 'sess-1' }),
		});
		const created = (await handleSession.call(withTtl.ctx, TEST_CTX, 'create', 0)) as Record<string, unknown>;
		expect(withTtl.requests[0]).toMatchObject({ method: 'POST', url: `${base}/sessions` });
		expect(withTtl.requests[0].body).toEqual({ mode: 'batch', backend: 'ibm_brisbane', max_ttl: 28800 });
		expect(created).toMatchObject({ sessionId: 'sess-1', mode: 'batch', backend: 'ibm_brisbane' });

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
	it('lists jobs with a limit query string', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { limit: 10 }, http: () => ({ jobs: [] }) });
		await handleJob.call(ctx, TEST_CTX, 'list', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${base}/jobs`, qs: { limit: 10 } });
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
});
