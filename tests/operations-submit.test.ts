import { describe, expect, it } from 'vitest';

import { handleJob } from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

const QASM = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nx q[0];';

function submit(operation: 'submitSampler' | 'submitEstimator', params: Record<string, unknown>) {
	const { ctx, requests } = makeExecuteContext({
		params: { backend: 'ibm_kingston', qasm3: QASM, ...params },
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
			backend: 'ibm_kingston',
			params: { version: 2, pubs: [[QASM, null, 512]] },
		});
		expect(body.session_id).toBeUndefined();
		expect((body.params as Record<string, unknown>).options).toBeUndefined();
		expect(result).toMatchObject({ jobId: 'job-123', backend: 'ibm_kingston', primitive: 'sampler' });
	});

	it('builds a minimal Estimator body with resilience_level and a two-item PUB', async () => {
		const { body } = await submit('submitEstimator', { observables: '"ZZ"', resilienceLevel: 2 });
		expect(body.program_id).toBe('estimator');
		const params = body.params as Record<string, unknown>;
		expect(params.version).toBe(2);
		expect(params.resilience_level).toBe(2);
		expect(params.pubs).toEqual([[QASM, 'ZZ']]);
	});

	describe('noise learner', () => {
		const learn = (params: Record<string, unknown>) => {
			const { ctx, requests } = makeExecuteContext({
				params: { backend: 'ibm_kingston', qasm3: QASM, ...params },
				http: () => ({ id: 'nl-1' }),
			});
			return handleJob
				.call(ctx, TEST_CTX, 'submitNoiseLearner', 0)
				.then((result) => ({ result, body: requests[0]?.body as Record<string, unknown> }));
		};

		it('sends bare circuits rather than PUBs, and version 2', async () => {
			const { result, body } = await learn({});
			expect(body).toEqual({
				program_id: 'noise-learner',
				backend: 'ibm_kingston',
				params: { version: 2, circuits: [QASM] },
			});
			expect(result).toMatchObject({ jobId: 'nl-1', primitive: 'noise-learner' });
		});

		it('never leaks the Sampler toggles into its options, which reject unknown keys', async () => {
			// The noise learner options object is declared additionalProperties:false upstream, so a
			// dynamical_decoupling or twirling key would make IBM refuse the whole job.
			const { body } = await learn({
				dynamicalDecoupling: true,
				twirlingGates: true,
				twirlingMeasure: true,
			});
			expect(body.params).toEqual({ version: 2, circuits: [QASM] });
		});

		it('maps its own options and drops the ones left at zero', async () => {
			const { body } = await learn({
				noiseLearnerOptions: {
					maxLayersToLearn: 4,
					numRandomizations: 32,
					shotsPerRandomization: 128,
					layerPairDepths: '0, 1, 2, 4',
					twirlingStrategy: 'active-accum',
				},
			});
			expect((body.params as Record<string, unknown>).options).toEqual({
				max_layers_to_learn: 4,
				num_randomizations: 32,
				shots_per_randomization: 128,
				layer_pair_depths: [0, 1, 2, 4],
				twirling_strategy: 'active-accum',
			});

			const bare = await learn({ noiseLearnerOptions: { maxLayersToLearn: 0 } });
			expect((bare.body.params as Record<string, unknown>).options).toBeUndefined();
		});

		it('rejects a non-numeric layer depth instead of sending it', async () => {
			await expect(
				learn({ noiseLearnerOptions: { layerPairDepths: '0, two' } }),
			).rejects.toThrow(/Layer Pair Depths/);
		});

		it('shares the job envelope with the other programs', async () => {
			const { body } = await learn({
				submitSessionId: 'sess-1',
				jobTags: 'noise, audit',
				privateJob: true,
				maxCost: 90,
				logLevel: 'debug',
			});
			expect(body).toMatchObject({
				session_id: 'sess-1',
				tags: ['noise', 'audit'],
				private: true,
				cost: 90,
				log_level: 'debug',
			});
		});
	});

	it('sends log_level only when chosen', async () => {
		const off = await submit('submitSampler', {});
		expect(off.body.log_level).toBeUndefined();

		const on = await submit('submitSampler', { logLevel: 'info' });
		expect(on.body.log_level).toBe('info');
	});

	describe('circuit format', () => {
		// What the official client actually puts on the wire: QPY bytes, zlib compressed, base64
		// encoded. A zlib stream opens with 0x78 0x9C, so the base64 starts "eJw".
		const QPY = Buffer.from([0x78, 0x9c, 0x0b, 0xf4, 0x0c, 0xf6]).toString('base64');
		// Base64 of raw, uncompressed QPY. This is the natural mistake, and IBM answered a live
		// submission of it with reason code 1603 after trying to read the text as QASM.
		const RAW_QPY = Buffer.from('QISKIT binary body').toString('base64');

		it('wraps the payload the way the official client does', async () => {
			const { body } = await submit('submitSampler', {
				circuitFormat: 'qpy',
				qpyCircuit: QPY,
				shots: 256,
			});
			expect((body.params as Record<string, unknown>).pubs).toEqual([
				[{ __type__: 'QuantumCircuit', __value__: QPY }, null, 256],
			]);
		});

		it('names the missing step when the payload was never compressed', async () => {
			const { ctx, requests } = makeExecuteContext({
				params: { backend: 'ibm_kingston', circuitFormat: 'qpy', qpyCircuit: RAW_QPY },
				http: () => ({ id: 'job-123' }),
			});
			await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
				/QPY Circuit is uncompressed/,
			);
			expect(requests).toHaveLength(0);
		});

		it('rejects anything that is not a zlib stream before spending a submission', async () => {
			const { ctx, requests } = makeExecuteContext({
				params: {
					backend: 'ibm_kingston',
					circuitFormat: 'qpy',
					qpyCircuit: Buffer.from('not a qpy file').toString('base64'),
				},
				http: () => ({ id: 'job-123' }),
			});
			await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
				/not base64 encoded zlib compressed QPY/,
			);
			expect(requests).toHaveLength(0);
		});

		it('still rejects a QASM3 circuit that carries no version header', async () => {
			const { ctx, requests } = makeExecuteContext({
				params: { backend: 'ibm_kingston', circuitFormat: 'qasm3', qasm3: 'this is not qasm' },
				http: () => ({ id: 'job-123' }),
			});
			await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
				/does not start with an OpenQASM 3 version header/,
			);
			expect(requests).toHaveLength(0);
		});

		it('treats a workflow saved without the format selector as OpenQASM 3', async () => {
			// The parameter did not exist before this release, so an existing workflow stores nothing
			// for it and must keep submitting the OpenQASM 3 field it already filled in.
			const { body } = await submit('submitSampler', { shots: 100 });
			expect((body.params as Record<string, unknown>).pubs).toEqual([[QASM, null, 100]]);
		});
	});

	it('sends cost only when set, clamped to the three hours IBM allows', async () => {
		const omitted = await submit('submitSampler', {});
		expect(omitted.body.cost).toBeUndefined();

		const zero = await submit('submitSampler', { maxCost: 0 });
		expect(zero.body.cost).toBeUndefined();

		const set = await submit('submitSampler', { maxCost: 120 });
		expect(set.body.cost).toBe(120);

		// minValue and maxValue are UI hints only, so an expression can deliver either extreme.
		const over = await submit('submitSampler', { maxCost: 99999 });
		expect(over.body.cost).toBe(10800);

		const negative = await submit('submitSampler', { maxCost: -30 });
		expect(negative.body.cost).toBeUndefined();

		const fractional = await submit('submitEstimator', { observables: '"ZZ"', maxCost: 45.9 });
		expect(fractional.body.cost).toBe(45);
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

	it('sends cleaned tags and the private flag only when set', async () => {
		const tagged = await submit('submitSampler', { jobTags: ' vqe , experiment-7,, ', privateJob: true });
		expect(tagged.body.tags).toEqual(['vqe', 'experiment-7']);
		expect(tagged.body.private).toBe(true);

		const plain = await submit('submitSampler', {});
		expect(plain.body.tags).toBeUndefined();
		expect(plain.body.private).toBeUndefined();
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
