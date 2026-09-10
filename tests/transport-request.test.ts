import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	getBaseUrl,
	ibmQuantumApiRequest,
	REGION_HOSTS,
	RESOURCE_CONTROLLER_HOST,
	resourceControllerRequest,
} from '../nodes/IbmQuantum/transport';
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
			arrayFormat: 'repeat',
			// Recorded by the fake so a wrong identifier here cannot pass the suite.
			credentialName: 'ibmQuantumApi',
		});
		expect('body' in options).toBe(false);
		expect('qs' in options).toBe(false);
	});

	// n8n resolves the credential by this exact name; a typo authenticates nothing and only shows
	// up at runtime.
	it('authenticates with the ibmQuantumApi credential', async () => {
		const { options } = await call('GET', '/backends');
		expect(options.credentialName).toBe('ibmQuantumApi');
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

	it('turns an empty-string body into an empty object, as it does for null', async () => {
		const read = (body: string) => {
			const { ctx } = makeExecuteContext({ http: () => body });
			return ibmQuantumApiRequest.call(ctx, TEST_CTX, 'GET', '/backends/x/defaults');
		};
		expect(await read('')).toEqual({});
		// The logs endpoint answers with text; a non-empty string still passes through untouched.
		expect(await read('plain text')).toBe('plain text');
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

describe('resourceControllerRequest option building', () => {
	function call(method: 'GET' | 'PATCH', endpoint: string, body?: unknown, qs?: unknown) {
		const { ctx, requests } = makeExecuteContext({ http: () => ({ ok: true }) });
		return resourceControllerRequest
			.call(ctx, method, endpoint, body as never, qs as never)
			.then((res) => ({ res, options: requests[0] as HttpCall }));
	}

	// SECURITY.md lists this host and tests/metadata.test.ts reads the literal out of transport.ts,
	// so the string is pinned here as well: changing it silently would move where the bearer token
	// goes.
	it('names the Resource Controller host IBM documents', () => {
		expect(RESOURCE_CONTROLLER_HOST).toBe('https://resource-controller.cloud.ibm.com');
	});

	it('prefixes the endpoint with the Resource Controller host and the fixed options', async () => {
		const { res, options } = await call('GET', '/v2/resource_instances');
		expect(res).toEqual({ ok: true });
		expect(options).toEqual({
			method: 'GET',
			url: 'https://resource-controller.cloud.ibm.com/v2/resource_instances',
			json: true,
			timeout: 30000,
			arrayFormat: 'repeat',
			credentialName: 'ibmQuantumApi',
		});
		expect('body' in options).toBe(false);
		expect('qs' in options).toBe(false);
	});

	it('attaches body and qs only when provided', async () => {
		const patched = await call('PATCH', '/v2/resource_instances/crn', {
			parameters: { instance_limit_seconds: 600 },
		});
		expect(patched.options.body).toEqual({ parameters: { instance_limit_seconds: 600 } });
		expect('qs' in patched.options).toBe(false);

		const listed = await call('GET', '/v2/resource_instances', undefined, { limit: 100 });
		expect(listed.options.qs).toEqual({ limit: 100 });
		expect('body' in listed.options).toBe(false);
	});

	it('turns an empty body into an empty object', async () => {
		const { ctx } = makeExecuteContext({ http: () => null });
		await expect(
			resourceControllerRequest.call(ctx, 'GET', '/v2/resource_instances'),
		).resolves.toEqual({});
	});

	it('rewraps a Resource Controller error with its message', async () => {
		const ibmBody = {
			errors: [{ code: 'not_found', message: 'The resource instance could not be found' }],
		};
		const { ctx } = makeExecuteContext({
			http: () => {
				throw { message: 'Request failed with status code 404', response: { data: ibmBody } };
			},
		});
		await expect(
			resourceControllerRequest.call(ctx, 'GET', '/v2/resource_instances/crn'),
		).rejects.toBeInstanceOf(NodeApiError);
		await expect(
			resourceControllerRequest.call(ctx, 'GET', '/v2/resource_instances/crn'),
		).rejects.toThrow(/could not be found/);
	});
});
