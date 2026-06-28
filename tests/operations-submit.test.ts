import { describe, expect, it } from 'vitest';

import { handleJob } from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

const QASM = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nx q[0];';

function submit(operation: 'submitSampler' | 'submitEstimator', params: Record<string, unknown>) {
	const { ctx, requests } = makeExecuteContext({
		params: { backend: 'ibm_brisbane', qasm3: QASM, ...params },
		http: () => ({ id: 'job-123' }),
	});
	return handleJob.call(ctx, TEST_CTX, operation, 0).then((result) => ({
		result,
		body: requests[0]?.body as Record<string, unknown>,
		call: requests[0] as HttpCall,
	}));
}

describe('submitJob request body (TEST-01)', () => {
	it('builds a minimal Sampler body: program_id, backend, params.version 2, PUB (qasm, null, shots)', async () => {
		const { result, body, call } = await submit('submitSampler', { shots: 512 });
		expect(call.method).toBe('POST');
		expect(call.url).toBe(`${TEST_CTX.baseUrl}/jobs`);
		expect(body).toEqual({
			program_id: 'sampler',
			backend: 'ibm_brisbane',
			params: { version: 2, pubs: [[QASM, null, 512]] },
		});
		expect(body.session_id).toBeUndefined();
		expect((body.params as Record<string, unknown>).options).toBeUndefined();
		expect(result).toMatchObject({ jobId: 'job-123', backend: 'ibm_brisbane', primitive: 'sampler' });
	});

	it('builds a minimal Estimator body with resilience_level and a two-item PUB', async () => {
		const { body } = await submit('submitEstimator', { observables: '"ZZ"', resilienceLevel: 2 });
		expect(body.program_id).toBe('estimator');
		const params = body.params as Record<string, unknown>;
		expect(params.version).toBe(2);
		expect(params.resilience_level).toBe(2);
		expect(params.pubs).toEqual([[QASM, 'ZZ']]);
	});

	it('puts session_id at the top level, never inside params', async () => {
		const { body } = await submit('submitSampler', { submitSessionId: 'sess-9' });
		expect(body.session_id).toBe('sess-9');
		expect((body.params as Record<string, unknown>).session_id).toBeUndefined();
	});

	it('normalizes empty / {} parameters to null and keeps a real binding object', async () => {
		const empty = await submit('submitSampler', { parameters: '{}' });
		expect((empty.body.params as { pubs: unknown[][] }).pubs[0][1]).toBeNull();

		const bound = await submit('submitSampler', { parameters: '{"theta":1.5}' });
		expect((bound.body.params as { pubs: unknown[][] }).pubs[0][1]).toEqual({ theta: 1.5 });
	});

	it('accepts parameters resolved to an object by an expression (empty object means null)', async () => {
		const obj = await submit('submitSampler', { parameters: { theta: 2 } });
		expect((obj.body.params as { pubs: unknown[][] }).pubs[0][1]).toEqual({ theta: 2 });

		const emptyObj = await submit('submitSampler', { parameters: {} });
		expect((emptyObj.body.params as { pubs: unknown[][] }).pubs[0][1]).toBeNull();
	});

	it('attaches params.options only when a structured toggle is set', async () => {
		const { body } = await submit('submitSampler', { dynamicalDecoupling: true });
		expect((body.params as Record<string, unknown>).options).toEqual({
			dynamical_decoupling: { enable: true },
		});
	});

	it('merges Additional Options object into params.options (TEST-11)', async () => {
		const { body } = await submit('submitSampler', {
			additionalOptions: '{"default_shots":4096}',
			twirlingGates: true,
		});
		expect((body.params as Record<string, unknown>).options).toEqual({
			default_shots: 4096,
			twirling: { enable_gates: true },
		});
	});
});

describe('submit input validation (BUG-03, UX-01, TEST-11)', () => {
	it('rejects an Additional Options JSON array instead of sending corrupt numeric keys', async () => {
		await expect(submit('submitSampler', { additionalOptions: '[1,2,3]' })).rejects.toThrow(
			/Additional Options must be a JSON object/,
		);
	});

	it('rejects an Additional Options scalar', async () => {
		await expect(submit('submitSampler', { additionalOptions: '5' })).rejects.toThrow(
			/Additional Options must be a JSON object/,
		);
	});

	it('rejects invalid Additional Options JSON', async () => {
		await expect(submit('submitSampler', { additionalOptions: '{bad' })).rejects.toThrow(
			/Additional Options must be valid JSON/,
		);
	});

	it('rejects a malformed Pauli observable locally before submitting', async () => {
		await expect(submit('submitEstimator', { observables: '"zz"' })).rejects.toThrow(
			/not a valid Pauli string/,
		);
		await expect(submit('submitEstimator', { observables: '["ZZ","XA"]' })).rejects.toThrow(
			/not a valid Pauli string/,
		);
	});

	it('accepts valid Pauli strings, arrays and coefficient maps', async () => {
		await expect(submit('submitEstimator', { observables: '"ZZ"' })).resolves.toBeDefined();
		await expect(submit('submitEstimator', { observables: '["IZ","XY"]' })).resolves.toBeDefined();
		await expect(
			submit('submitEstimator', { observables: '{"IIZII":1,"XIZZZ":2.3}' }),
		).resolves.toBeDefined();
	});
});
