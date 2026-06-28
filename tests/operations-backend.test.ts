import { describe, expect, it } from 'vitest';

import { handleBackend } from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

type Device = Record<string, unknown>;

function leastBusy(params: Record<string, unknown>, devices: Device[]) {
	const { ctx } = makeExecuteContext({ params, http: () => ({ devices }) });
	return handleBackend.call(ctx, TEST_CTX, 'getLeastBusy', 0) as Promise<Record<string, unknown>>;
}

const online = (name: string, queue: number | null, qubits: unknown, sim = false): Device => ({
	name,
	status: { name: 'online' },
	queue_length: queue,
	qubits,
	is_simulator: sim,
});

describe('getLeastBusy ranking and filtering (TEST-03)', () => {
	it('picks the lowest-queue online real device and excludes simulators and offline devices', async () => {
		const result = await leastBusy({ minQubits: 0, includeSimulators: false }, [
			online('ibm_q5', 5, 127),
			online('ibm_q2', 2, 127),
			online('ibm_sim', 0, 32, true),
			{ name: 'ibm_offline', status: { name: 'offline' }, queue_length: 1, qubits: 127 },
		]);
		expect(result.leastBusy).toBe('ibm_q2');
		expect(result.queueLength).toBe(2);
		expect((result.candidates as Device[]).map((d) => d.name)).toEqual(['ibm_q2', 'ibm_q5']);
	});

	it('includes simulators when asked', async () => {
		const result = await leastBusy({ minQubits: 0, includeSimulators: true }, [
			online('ibm_q2', 2, 127),
			online('ibm_sim', 0, 32, true),
		]);
		expect(result.leastBusy).toBe('ibm_sim');
	});

	it('excludes a device with an unknown qubit count when minQubits is set (BUG-04)', async () => {
		const result = await leastBusy({ minQubits: 5, includeSimulators: false }, [
			online('ibm_unknown', 0, undefined),
			online('ibm_real127', 5, 127),
		]);
		// Pre-fix the queue-0 unknown-qubit device would win; it must now be excluded.
		expect(result.leastBusy).toBe('ibm_real127');
	});

	it('sorts unknown queue length last but still reports it as null', async () => {
		const result = await leastBusy({ minQubits: 0, includeSimulators: false }, [
			online('ibm_nullq', null, 127),
			online('ibm_q3', 3, 127),
		]);
		expect(result.leastBusy).toBe('ibm_q3');
		const candidates = result.candidates as Device[];
		expect(candidates[1]).toMatchObject({ name: 'ibm_nullq', queueLength: null });
	});

	it('returns nulls when no candidate qualifies', async () => {
		const result = await leastBusy({ minQubits: 0, includeSimulators: false }, [
			{ name: 'ibm_offline', status: { name: 'offline' }, queue_length: 1, qubits: 127 },
		]);
		expect(result.leastBusy).toBeNull();
		expect(result.queueLength).toBeNull();
	});
});

describe('handleBackend dispatch', () => {
	it('lists backends with a GET to /backends', async () => {
		const { ctx, requests } = makeExecuteContext({ http: () => ({ devices: [] }) });
		await handleBackend.call(ctx, TEST_CTX, 'list', 0);
		expect(requests[0]).toMatchObject({ method: 'GET', url: `${TEST_CTX.baseUrl}/backends` });
	});

	it.each([
		['getConfiguration', 'configuration'],
		['getProperties', 'properties'],
		['getStatus', 'status'],
	])('routes %s to the matching /backends/:name endpoint', async (operation, suffix) => {
		const { ctx, requests } = makeExecuteContext({
			params: { backendName: 'ibm_brisbane' },
			http: () => ({}),
		});
		await handleBackend.call(ctx, TEST_CTX, operation, 0);
		const call = requests[0] as HttpCall;
		expect(call.method).toBe('GET');
		expect(call.url).toBe(`${TEST_CTX.baseUrl}/backends/ibm_brisbane/${suffix}`);
	});
});
