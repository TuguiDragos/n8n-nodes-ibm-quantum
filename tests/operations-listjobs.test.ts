import { describe, expect, it } from 'vitest';

import type { IDataObject } from 'n8n-workflow';

import { handleJob, MAX_JOB_LIST_LIMIT, MAX_JOB_LIST_PAGES } from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

// A page the way IBM shapes it: `count` is the total across pages, `offset` where this one starts.
function jobsPage(from: number, size: number, count: number): IDataObject {
	return {
		jobs: Array.from({ length: size }, (_, i) => ({ id: `job-${from + i}` })),
		count,
		offset: from,
		limit: MAX_JOB_LIST_LIMIT,
	};
}

function listAll(
	params: Record<string, unknown>,
	http: (call: HttpCall, index: number) => unknown,
) {
	const { ctx, requests } = makeExecuteContext({ params: { returnAll: true, ...params }, http });
	return handleJob
		.call(ctx, TEST_CTX, 'list', 0)
		.then((result) => ({ result: result as Record<string, unknown>, requests }));
}

const qsOf = (call: HttpCall) => call.qs as Record<string, unknown>;

describe('Job Get Many with Return All', () => {
	it('walks the listing 200 at a time and merges the pages into one body', async () => {
		const pages = [jobsPage(0, 200, 450), jobsPage(200, 200, 450), jobsPage(400, 50, 450)];
		const { result, requests } = await listAll({}, (_call, i) => pages[i]);
		expect(requests).toHaveLength(3);
		expect(qsOf(requests[0])).toEqual({ limit: 200, exclude_params: true, offset: 0 });
		expect(qsOf(requests[1]).offset).toBe(200);
		expect(qsOf(requests[2]).offset).toBe(400);
		expect((result.jobs as unknown[]).length).toBe(450);
		expect(result).toMatchObject({ count: 450, limit: 200, offset: 0 });
		expect(result).not.toHaveProperty('truncated');
	});

	it('stops when the offset reaches the server count, even on a full page', async () => {
		const { result, requests } = await listAll({}, () => jobsPage(0, 200, 200));
		expect(requests).toHaveLength(1);
		expect((result.jobs as unknown[]).length).toBe(200);
	});

	it('falls back to the short-page rule when count is not a number', async () => {
		const pages = [{ ...jobsPage(0, 200, 0), count: '200' }, jobsPage(200, 0, 0)];
		const { result, requests } = await listAll({}, (_call, i) => pages[i]);
		expect(requests).toHaveLength(2);
		expect((result.jobs as unknown[]).length).toBe(200);
		expect(result.count).toBe(0);
	});

	it('starts at the Offset filter and reports it as the offset of the merged body', async () => {
		const pages = [jobsPage(10, 200, 250), jobsPage(210, 40, 250)];
		const { result, requests } = await listAll(
			{ listFilters: { offset: 10 } },
			(_c, i) => pages[i],
		);
		expect(qsOf(requests[0]).offset).toBe(10);
		expect(qsOf(requests[1]).offset).toBe(210);
		expect(result.offset).toBe(10);
		expect((result.jobs as unknown[]).length).toBe(240);
	});

	it('ignores the Limit field while Return All is on', async () => {
		const { requests } = await listAll({ limit: 5 }, () => jobsPage(0, 3, 3));
		expect(qsOf(requests[0]).limit).toBe(MAX_JOB_LIST_LIMIT);
	});

	it('keeps the filters on every page', async () => {
		const pages = [jobsPage(0, 200, 201), jobsPage(200, 1, 201)];
		const { requests } = await listAll(
			{ listFilters: { backend: 'ibm_fez', tag: 'vqe, run-7', pending: 'finished' } },
			(_call, i) => pages[i],
		);
		for (const call of requests) {
			expect(qsOf(call)).toMatchObject({
				backend: 'ibm_fez',
				tags: ['vqe', 'run-7'],
				pending: false,
				exclude_params: true,
			});
		}
	});

	it('stops at the page cap and marks the listing as truncated', async () => {
		const { result, requests } = await listAll({}, (_call, i) => jobsPage(i * 200, 200, 1_000_000));
		expect(requests).toHaveLength(MAX_JOB_LIST_PAGES);
		expect((result.jobs as unknown[]).length).toBe(MAX_JOB_LIST_PAGES * MAX_JOB_LIST_LIMIT);
		expect(result.truncated).toBe(true);
	});

	it('drops a job repeated at a page boundary and keeps entries it cannot identify', async () => {
		const pages = [
			jobsPage(0, 200, 400),
			{ jobs: [{ id: 'job-199' }, null, 'stray', {}, { id: 'job-200' }] },
		];
		const { result, requests } = await listAll({}, (_call, i) => pages[i]);
		expect(requests).toHaveLength(2);
		const jobs = result.jobs as unknown[];
		expect(jobs).toHaveLength(204);
		expect(jobs.slice(200)).toEqual([null, 'stray', {}, { id: 'job-200' }]);
	});

	it('treats a body without a jobs array as the end of the listing', async () => {
		const { result, requests } = await listAll({}, () => ({}));
		expect(requests).toHaveLength(1);
		expect(result).toEqual({ jobs: [], offset: 0 });
	});

	it('fails the item on a page error rather than returning part of the listing', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: true },
			http: (_call, i) => {
				if (i === 1) throw Object.assign(new Error('boom'), { statusCode: 502 });
				return jobsPage(0, 200, 400);
			},
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'list', 0)).rejects.toThrow();
		expect(requests).toHaveLength(2);
	});

	it('turns paging on for the text an expression produces', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: 'true' },
			http: () => jobsPage(0, 100, 100),
		});
		await handleJob.call(ctx, TEST_CTX, 'list', 0);
		expect(requests).toHaveLength(1);
		expect(qsOf(requests[0])).toEqual({ limit: 200, exclude_params: true, offset: 0 });
	});

	it('leaves paging off for the text that spells off', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { returnAll: 'false' },
			http: () => jobsPage(0, 200, 1000),
		});
		await handleJob.call(ctx, TEST_CTX, 'list', 0);
		expect(requests).toHaveLength(1);
		expect(qsOf(requests[0])).toEqual({ limit: 50, exclude_params: true });
	});

	it('refuses a Return All that spells neither', async () => {
		const { ctx } = makeExecuteContext({
			params: { returnAll: ['true'] },
			http: () => jobsPage(0, 200, 1000),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'list', 0)).rejects.toThrow(
			'Return All must be true or false.',
		);
	});
});
