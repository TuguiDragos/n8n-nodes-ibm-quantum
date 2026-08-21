import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { backendLabel, getBackends } from '../nodes/IbmQuantum/loadOptions';
import { makeExecuteContext, type FakeContextOptions } from './fakeContext';

// The shape below is a real GET /v1/backends body, trimmed to the fields the dropdown reads.
const DEVICES = [
	{ name: 'ibm_kingston', status: { name: 'online', reason: 'available' }, queue_length: 0 },
	{ name: 'ibm_fez', status: { name: 'online', reason: 'available' }, queue_length: 7 },
	{ name: 'ibm_marrakesh', status: { name: 'paused', reason: 'Maintenance' }, queue_length: 20 },
];

function loadContext(opts: FakeContextOptions = {}) {
	const { ctx, requests } = makeExecuteContext(opts);
	return { ctx: ctx as unknown as ILoadOptionsFunctions, requests };
}

describe('backendLabel', () => {
	it('shows the status and the queue beside the name', () => {
		expect(backendLabel(DEVICES[0])).toBe('ibm_kingston (online, 0 queued)');
		expect(backendLabel(DEVICES[2])).toBe('ibm_marrakesh (paused, 20 queued)');
	});

	// Only `name`, `status` and `queue_length` are required by the schema, but a label must not
	// break if a field arrives empty or with an unexpected type.
	it('drops whichever detail is missing', () => {
		expect(backendLabel({ name: 'a', queue_length: 3 })).toBe('a (3 queued)');
		expect(backendLabel({ name: 'a', status: { name: 'offline' } })).toBe('a (offline)');
		expect(backendLabel({ name: 'a' })).toBe('a');
		expect(backendLabel({ name: 'a', status: { name: '' }, queue_length: null })).toBe('a');
		expect(backendLabel({ name: 'a', status: 'online', queue_length: '4' })).toBe('a');
		expect(backendLabel({})).toBe('');
	});
});

describe('getBackends', () => {
	it('asks the backends endpoint with the node credential', async () => {
		const { ctx, requests } = loadContext({ http: () => ({ devices: DEVICES }) });
		await getBackends.call(ctx);
		expect(requests).toHaveLength(1);
		expect(requests[0].method).toBe('GET');
		expect(requests[0].url).toBe('https://quantum.cloud.ibm.com/api/v1/backends');
		expect(requests[0].credentialName).toBe('ibmQuantumApi');
	});

	// The value has to stay the bare name: it is what every operation sends, and what workflows
	// saved before this dropdown existed already hold.
	it('stores the bare name and sorts by it', async () => {
		const { ctx } = loadContext({ http: () => ({ devices: DEVICES }) });
		expect(await getBackends.call(ctx)).toEqual([
			{ name: 'ibm_fez (online, 7 queued)', value: 'ibm_fez' },
			{ name: 'ibm_kingston (online, 0 queued)', value: 'ibm_kingston' },
			{ name: 'ibm_marrakesh (paused, 20 queued)', value: 'ibm_marrakesh' },
		]);
	});

	it('returns nothing rather than throwing when the listing is unusable', async () => {
		for (const body of [null, {}, { devices: null }, { devices: 'nope' }, { devices: [] }]) {
			const { ctx } = loadContext({ http: () => body });
			expect(await getBackends.call(ctx)).toEqual([]);
		}
	});

	it('skips entries that carry no usable name', async () => {
		const { ctx } = loadContext({
			http: () => ({ devices: [null, 'text', { status: {} }, { name: '' }, DEVICES[1]] }),
		});
		expect(await getBackends.call(ctx)).toEqual([
			{ name: 'ibm_fez (online, 7 queued)', value: 'ibm_fez' },
		]);
	});

	// Only a missing or malformed version is fatal; an older real date is merely deprecated.
	it('refuses to load when the credential has no usable API version', async () => {
		for (const apiVersion of ['', '   ', 'latest', '2026-02-31']) {
			const { ctx, requests } = loadContext({ credentials: { region: 'us-east', apiVersion } });
			await expect(getBackends.call(ctx)).rejects.toThrow();
			// The version is checked before the request, so a bad credential costs no call.
			expect(requests).toHaveLength(0);
		}
	});

	it('still loads on a deprecated but valid API version', async () => {
		const { ctx } = loadContext({
			credentials: { region: 'us-east', apiVersion: '2020-01-01' },
			http: () => ({ devices: [DEVICES[1]] }),
		});
		expect(await getBackends.call(ctx)).toEqual([
			{ name: 'ibm_fez (online, 7 queued)', value: 'ibm_fez' },
		]);
	});

	it('surfaces an API failure through the shared error enricher', async () => {
		const { ctx } = loadContext({
			http: () => {
				throw new Error('boom');
			},
		});
		await expect(getBackends.call(ctx)).rejects.toThrow();
	});
});
