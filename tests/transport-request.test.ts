import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { getBaseUrl, ibmQuantumApiRequest, REGION_HOSTS } from '../nodes/IbmQuantum/transport';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

describe('getBaseUrl region mapping (TEST-05)', () => {
	it('maps each known region to its host plus /api/v1', () => {
		expect(getBaseUrl('us-east')).toBe(`${REGION_HOSTS['us-east']}/api/v1`);
		expect(getBaseUrl('eu-de')).toBe(`${REGION_HOSTS['eu-de']}/api/v1`);
	});

	it('falls back to the us-east host for an unknown region', () => {
		expect(getBaseUrl('bogus')).toBe(`${REGION_HOSTS['us-east']}/api/v1`);
	});
});

describe('ibmQuantumApiRequest option building (TEST-05)', () => {
	function call(method: 'GET' | 'POST', endpoint: string, body?: unknown, qs?: unknown) {
		const { ctx, requests } = makeExecuteContext({ http: () => ({ ok: true }) });
		return ibmQuantumApiRequest
			.call(ctx, TEST_CTX, method, endpoint, body as never, qs as never)
			.then((res) => ({ res, options: requests[0] as HttpCall }));
	}

	it('sends a GET with neither body nor qs and a fixed 30s timeout', async () => {
		const { res, options } = await call('GET', '/backends');
		expect(res).toEqual({ ok: true });
		expect(options).toEqual({
			method: 'GET',
			url: `${TEST_CTX.baseUrl}/backends`,
			json: true,
			timeout: 30000,
		});
		expect('body' in options).toBe(false);
		expect('qs' in options).toBe(false);
	});

	it('attaches qs only when provided', async () => {
		const { options } = await call('GET', '/jobs', undefined, { limit: 5 });
		expect(options.qs).toEqual({ limit: 5 });
		expect('body' in options).toBe(false);
	});

	it('attaches body only when provided', async () => {
		const { options } = await call('POST', '/jobs', { program_id: 'sampler' });
		expect(options.body).toEqual({ program_id: 'sampler' });
		expect('qs' in options).toBe(false);
	});

	it('rewraps a request error as an enriched NodeApiError', async () => {
		const ibmBody = { errors: [{ message: 'Backend not found', solution: 'Check the name' }] };
		const { ctx } = makeExecuteContext({
			http: () => {
				throw { message: 'Request failed with status code 404', response: { data: ibmBody } };
			},
		});
		await expect(
			ibmQuantumApiRequest.call(ctx, TEST_CTX, 'GET', '/backends/nope/status'),
		).rejects.toBeInstanceOf(NodeApiError);
		await expect(
			ibmQuantumApiRequest.call(ctx, TEST_CTX, 'GET', '/backends/nope/status'),
		).rejects.toThrow(/Backend not found/);
	});
});
