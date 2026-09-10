import { describe, expect, it } from 'vitest';

import {
	coupledNeighbours,
	handleJob,
	MAX_CIRCUITS_PER_JOB,
	MAX_COUPLING_WARNINGS,
	uncoupledPairs,
	multiQubitOperands,
} from '../nodes/IbmQuantum/operations';
import { jobPost, makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

const QASM = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nx q[0];';

function submit(operation: 'submitSampler' | 'submitEstimator', params: Record<string, unknown>) {
	const { ctx, requests } = makeExecuteContext({
		params: { backend: 'ibm_kingston', qasm3: QASM, ...params },
		http: () => ({ id: 'job-123' }),
	});
	return handleJob.call(ctx, TEST_CTX, operation, 0).then((result) => ({
		result,
		body: jobPost(requests as HttpCall[])?.body as Record<string, unknown>,
		call: jobPost(requests as HttpCall[]),
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
		expect(result).toMatchObject({
			jobId: 'job-123',
			backend: 'ibm_kingston',
			primitive: 'sampler',
		});
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
			return handleJob.call(ctx, TEST_CTX, 'submitNoiseLearner', 0).then((result) => ({
				result,
				body: jobPost(requests as HttpCall[])?.body as Record<string, unknown>,
			}));
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

		it('refuses an over-long session id like the other programs', async () => {
			await expect(learn({ submitSessionId: 'x'.repeat(40) })).rejects.toThrow(
				/Session ID is 40 characters/,
			);
		});

		it('never leaks the Sampler toggles into its options, which reject unknown keys', async () => {
			// The noise learner options object is declared additionalProperties:false upstream, so a
			// dynamical_decoupling or twirling key would make IBM refuse the whole job.
			const { body } = await learn({
				dynamicalDecoupling: true,
				twirlingGates: true,
				twirlingMeasure: true,
				twirlingOptions: { strategy: 'all' },
				executionOptions: { initQubits: false },
				dynamicalDecouplingOptions: { sequenceType: 'XY4' },
				resilienceOptions: { zneMitigation: true },
			});
			expect(body.params).toEqual({ version: 2, circuits: [QASM] });
		});

		it('validates Additional Options against its own key list, not the primitives', async () => {
			await expect(
				learn({ additionalOptions: '{"execution": {"rep_delay": 0.00025}}' }),
			).rejects.toThrow(
				/"execution" is not among the Noise Learner options\. IBM accepts only experimental, layer_pair_depths, max_layers_to_learn, num_randomizations, shots_per_randomization, simulator, support_qiskit, twirling_strategy at the top level\./,
			);
			const { body } = await learn({ additionalOptions: '{"support_qiskit": true}' });
			expect((body.params as Record<string, unknown>).options).toEqual({ support_qiskit: true });
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
			await expect(learn({ noiseLearnerOptions: { layerPairDepths: '0, two' } })).rejects.toThrow(
				/Layer Pair Depths/,
			);
		});

		it('shares the job envelope with the other programs', async () => {
			const { body } = await learn({
				submitSessionId: 'sess-1',
				submitCalibrationId: 'cal-1',
				jobTags: 'noise, audit',
				privateJob: true,
				maxCost: 90,
				logLevel: 'debug',
			});
			expect(body).toMatchObject({
				session_id: 'sess-1',
				calibration_id: 'cal-1',
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

	it('puts calibration_id at the top level, only when set, never inside params', async () => {
		const { body } = await submit('submitSampler', { submitCalibrationId: ' cal-7 ' });
		expect(body.calibration_id).toBe('cal-7');
		const params = body.params as Record<string, unknown>;
		expect(params.calibration_id).toBeUndefined();
		expect(params.options).toBeUndefined();

		const bare = await submit('submitSampler', {});
		expect(bare.body.calibration_id).toBeUndefined();
	});

	it('refuses a calibration ID above 100 characters before spending a submission', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				qasm3: QASM,
				submitCalibrationId: 'c'.repeat(101),
			},
			http: () => ({ id: 'job-123' }),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
			/Calibration ID is 101 characters/,
		);
		expect(requests).toHaveLength(0);
	});

	describe('circuit format', () => {
		// What the official client actually puts on the wire: QPY bytes, zlib compressed, base64
		// encoded. A zlib stream opens with 0x78 0x9C, so the base64 starts "eJw".
		const QPY = Buffer.from([0x78, 0x9c, 0x0b, 0xf4, 0x0c, 0xf6]).toString('base64');
		// Base64 of raw, uncompressed QPY. This is the natural mistake, and IBM answered a live
		// submission of it with reason code 1603 after trying to read the text as QASM.
		const RAW_QPY = Buffer.from('QISKIT binary body').toString('base64');

		// Measured live on 2026-09-08: a format naming neither field fell through to the OpenQASM
		// one, which n8n does not show for it, so the run failed on `Could not get parameter
		// "qasm3"` and named a field the user never set.
		it.each([['nonsense'], ['QASM3'], ['toString'], [7]])(
			'refuses a Circuit Format of %s before any request',
			async (circuitFormat) => {
				const { ctx, requests } = makeExecuteContext({
					params: { backend: 'ibm_kingston', circuitFormat, qasm3: 'OPENQASM 3.0;\nqubit[1] q;\n' },
					http: () => ({ id: 'job-123' }),
				});
				await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
					'Circuit Format must be one of qasm3, qpy.',
				);
				expect(requests).toHaveLength(0);
			},
		);

		// A workflow saved before the selector existed stores nothing, and an expression can leave
		// it empty; both keep the OpenQASM field the release has always defaulted to.
		it.each([[undefined], [null], [''], ['   ']])(
			'keeps qasm3 when Circuit Format resolves to %s',
			async (circuitFormat) => {
				const { body } = await submit('submitSampler', {
					circuitFormat,
					qasm3: 'OPENQASM 3.0;\nqubit[1] q;\n',
					shots: 128,
				});
				expect(body.program_id).toBe('sampler');
			},
		);

		// Measured live: with an empty Circuit Format stored, n8n's own resolver cannot reach the
		// OpenQASM field, because that field is displayed only for the literal `qasm3`. It hands
		// back the fallback instead, and the header check is what must report it.
		it('names the circuit field when n8n cannot resolve it', async () => {
			const { ctx, requests } = makeExecuteContext({
				params: { backend: 'ibm_kingston', circuitFormat: '' },
				http: () => ({ id: 'job-123' }),
			});
			await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
				/OpenQASM 3 Circuit does not start with an OpenQASM 3 version header/,
			);
			expect(requests).toHaveLength(0);
		});

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
		const tagged = await submit('submitSampler', {
			jobTags: ' vqe , experiment-7,, ',
			privateJob: true,
		});
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
			/Additional Options must be a JSON object, or \{\} for none\. Its top-level keys are the Sampler options: default_shots, dynamical_decoupling, execution, experimental, simulator, twirling\./,
		);
	});

	it('rejects invalid Additional Options JSON', async () => {
		await expect(submit('submitSampler', { additionalOptions: '{bad' })).rejects.toThrow(
			/Additional Options must be valid JSON/,
		);
	});

	it('refuses the environment key the old example suggested, before any request', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				qasm3: QASM,
				additionalOptions: '{"environment": {"log_level": "DEBUG"}}',
			},
			http: () => ({ id: 'job-1' }),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
			/"environment" is not among the Sampler options\. IBM accepts only default_shots, dynamical_decoupling, execution, experimental, simulator, twirling at the top level\. There is no "environment" key in the REST API: use the Log Level, Tags and Private fields instead\./,
		);
		expect(requests).toHaveLength(0);
	});

	it('checks the keys against the program: resilience is an Estimator key, not a Sampler one', async () => {
		const ok = await submit('submitEstimator', {
			observables: '"ZZ"',
			additionalOptions: '{"resilience": {"measure_mitigation": true}}',
		});
		expect((ok.body.params as Record<string, unknown>).options).toEqual({
			resilience: { measure_mitigation: true },
		});
		await expect(
			submit('submitSampler', {
				additionalOptions: '{"resilience": {"measure_mitigation": true}}',
			}),
		).rejects.toThrow(
			/"resilience" is not among the Sampler options\. IBM accepts only default_shots, dynamical_decoupling, execution, experimental, simulator, twirling at the top level\.$/,
		);
	});

	it('names every unknown key at once', async () => {
		await expect(
			submit('submitSampler', {
				additionalOptions: '{"environment": {}, "max_execution_time": 300}',
			}),
		).rejects.toThrow(/"environment", "max_execution_time" are not among the Sampler options/);
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

// One job carries a fixed overhead of roughly two QPU seconds on top of the circuits themselves,
// measured repeatedly on ibm_fez. Submitting a list of circuits in one job pays that once rather
// than once per circuit, which is the whole point of the array form.
describe('a list of circuits becomes one job with several PUBs', () => {
	const A = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nx q[0];';
	const B = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\ncz q[0], q[1];';

	it('keeps a single string as a single PUB, exactly as before', async () => {
		const { body } = await submit('submitSampler', { shots: 256 });
		expect((body.params as Record<string, unknown>).pubs).toEqual([[QASM, null, 256]]);
	});

	it('builds one PUB per circuit for the sampler', async () => {
		const { body } = await submit('submitSampler', { qasm3: [A, B], shots: 256 });
		expect((body.params as Record<string, unknown>).pubs).toEqual([
			[A, null, 256],
			[B, null, 256],
		]);
	});

	// The observables, bindings and precision apply to every circuit in the list.
	it('builds one PUB per circuit for the estimator', async () => {
		const { body } = await submit('submitEstimator', {
			qasm3: [A, B],
			observables: '"ZZ"',
			resilienceLevel: 0,
		});
		expect((body.params as Record<string, unknown>).pubs).toEqual([
			[A, 'ZZ'],
			[B, 'ZZ'],
		]);
	});

	it('sends the whole list to the noise learner, which already takes an array', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_kingston', qasm3: [A, B], noiseLearnerOptions: {} },
			http: () => ({ id: 'job-9' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitNoiseLearner', 0);
		const params = (jobPost(requests as HttpCall[]).body as Record<string, unknown>)
			.params as Record<string, unknown>;
		expect(params.circuits).toEqual([A, B]);
	});

	it('refuses an empty list rather than submitting a job that runs nothing', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_kingston', qasm3: [] },
			http: () => ({ id: 'job-9' }),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
			/Circuit list is empty/,
		);
		expect(requests).toHaveLength(0);
	});

	// The node's own bound, so an expression that resolves to a runaway array cannot build one
	// enormous request.
	it('refuses a list past the cap, naming both numbers', async () => {
		const many = new Array(MAX_CIRCUITS_PER_JOB + 1).fill(A);
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_kingston', qasm3: many },
			http: () => ({ id: 'job-9' }),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
			new RegExp(`${MAX_CIRCUITS_PER_JOB + 1} entries.*at most ${MAX_CIRCUITS_PER_JOB}`),
		);
		expect(requests).toHaveLength(0);
	});

	it('accepts a list exactly at the cap', async () => {
		const many = new Array(MAX_CIRCUITS_PER_JOB).fill(A);
		const { body } = await submit('submitSampler', { qasm3: many, shots: 16 });
		expect((body.params as Record<string, unknown>).pubs).toHaveLength(MAX_CIRCUITS_PER_JOB);
	});

	// Every circuit is validated, not just the first, so a bad entry cannot ride along on a good one.
	it('validates every entry, not only the first', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_kingston', qasm3: [A, 'not a circuit'] },
			http: () => ({ id: 'job-9' }),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow();
		expect(requests).toHaveLength(0);
	});

	it('coerces a non-string entry the same way a single circuit is coerced', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_kingston', qasm3: [A, { nope: true }] },
			http: () => ({ id: 'job-9' }),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow();
		expect(requests).toHaveLength(0);
	});

	// A batch of variants of one experiment would otherwise repeat the identical warning per entry.
	it('reports each distinct warning once across the whole list', async () => {
		const offIsa = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nswap q[0], q[1];';
		const { result } = await submit('submitSampler', { qasm3: [offIsa, offIsa], shots: 16 });
		expect((result as { warnings: string[] }).warnings).toHaveLength(1);
	});

	it('wraps every QPY entry, not just the first', async () => {
		const { body } = await submit('submitSampler', {
			circuitFormat: 'qpy',
			qpyCircuit: ['eJwL9Az2dAn2dAYAC9gCVQ==', 'eJwL9Az2dAn2dAYAC9gCVQ=='],
			shots: 16,
		});
		const pubs = (body.params as Record<string, unknown>).pubs as unknown[][];
		expect(pubs).toHaveLength(2);
		for (const pub of pubs) {
			expect(pub[0]).toMatchObject({ __type__: 'QuantumCircuit' });
		}
	});
});

// A cz between two qubits the chip does not connect passes every local guard, is accepted by IBM,
// sits in the queue, and only then fails, charging the fixed per-job overhead. It is the last way a
// circuit built entirely from the palette's runs-as-is gates can still fail. The real map on
// ibm_fez has 352 entries and every one carries its own reverse, so it is read as undirected. The
// map comes from the configuration every OpenQASM 3 submit reads once, shared with the ISA check.
describe('coupling map check', () => {
	// A fragment of the real ibm_fez map, reverses included exactly as IBM publishes them.
	const MAP = [
		[0, 1],
		[1, 0],
		[1, 2],
		[2, 1],
		[2, 3],
		[3, 2],
		[3, 4],
		[4, 3],
		[3, 16],
		[16, 3],
	];
	const HEAD = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[20] q;\nbit[20] c;\n';
	const pairs = (body: string) => uncoupledPairs(multiQubitOperands(`${HEAD}${body}`), MAP);

	it('accepts a coupled pair in either order', () => {
		expect(pairs('cz q[0], q[1];')).toEqual([]);
		expect(pairs('cz q[1], q[0];')).toEqual([]);
	});

	it('flags a pair the chip does not connect', () => {
		expect(pairs('cz q[0], q[5];')).toEqual([[0, 5]]);
		expect(pairs('cz q[0], q[1];\ncz q[2], q[7];')).toEqual([[2, 7]]);
	});

	// Anything wider is not a direct hardware interaction, and the ISA warning already covers it.
	it('ignores statements on more than two qubits', () => {
		expect(pairs('ccx q[0], q[5], q[9];')).toEqual([]);
	});

	it('has nothing to check without a two-qubit gate', () => {
		expect(pairs('x q[0];')).toEqual([]);
		expect(pairs('barrier q[0], q[9];')).toEqual([]);
	});

	// The exact Bell circuit the README shows for ibm_fez, in the physical-qubit form Qiskit's
	// exporter writes. This is the circuit the check was written for, and until now the only one it
	// could not read.
	const TRANSPILED = `OPENQASM 3.0;
include "stdgates.inc";
bit[2] c;
rz(pi/2) $0;
sx $0;
rz(pi/2) $0;
rz(pi/2) $1;
sx $1;
rz(pi/2) $1;
cz $0, $1;
rz(pi/2) $1;
sx $1;
rz(pi/2) $1;
c[0] = measure $0;
c[1] = measure $1;`;

	it('reads the physical-qubit form a transpiler emits', () => {
		expect(multiQubitOperands(TRANSPILED)).toEqual([[0, 1]]);
		expect(uncoupledPairs(multiQubitOperands(TRANSPILED), MAP)).toEqual([]);
		expect(multiQubitOperands('OPENQASM 3.0;\nbit[2] c;\ncz $0, $5;')).toEqual([[0, 5]]);
		expect(multiQubitOperands('OPENQASM 3.0;\ncz $3, $3;')).toEqual([]);
	});

	// IBM's importer lays quantum registers out in declaration order, so the second register starts
	// where the first ends and a single `qubit s;` counts as one. Spacing around the size is free on
	// one line, and the legacy `qreg a[2];` declares as much as `qubit[2] a;` does; a `qubit` or
	// `qreg` declaration whose keyword, size and register name do not all sit on one line is read by
	// neither reader and offsets nothing, while a break after the name leaves it read as it would be
	// on one line. A `bit` or `creg` declaration needs only its keyword and name on one line: its
	// reader never looks at the size, so `creg c` broken before `[2];` is still read as classical.
	it('reads a register of any name, offset by the quantum registers declared before it', () => {
		expect(
			multiQubitOperands(
				'OPENQASM 3.0;\nqubit[4] qr;\nbit[4] meas;\ncz qr[0], qr[3];\nmeas[0] = measure qr[0];',
			),
		).toEqual([[0, 3]]);
		expect(multiQubitOperands('OPENQASM 3.0;\nqubit[2] a;\nqubit[2] b;\ncz a[0], b[0];')).toEqual([
			[0, 2],
		]);
		expect(multiQubitOperands('OPENQASM 3.0;\nqubit s;\nqubit[2] q;\ncz q[0], q[1];')).toEqual([
			[1, 2],
		]);
		expect(
			multiQubitOperands('OPENQASM 3.0;\nqubit [2] a;\nqubit[ 2 ] b;\nqubit[2] q;\ncz q[0], q[1];'),
		).toEqual([[4, 5]]);
		expect(multiQubitOperands('OPENQASM 3.0;\nqreg a[2];\nqubit[2] q;\ncz q[0], q[1];')).toEqual([
			[2, 3],
		]);
		expect(multiQubitOperands('OPENQASM 3.0;\nqreg q [2];\ncz q[0], q[1];')).toEqual([[0, 1]]);
		expect(multiQubitOperands('OPENQASM 3.0;\nqubit\n[2] a;\nqubit[2] q;\ncz q[0], q[1];')).toEqual(
			[[0, 1]],
		);
		expect(multiQubitOperands('OPENQASM 3.0;\nqreg a\n[2];\nqubit[2] q;\ncz q[0], q[1];')).toEqual([
			[0, 1],
		]);
		expect(multiQubitOperands('OPENQASM 3.0;\nqubit[2] a\n;\nqubit[2] q;\ncz q[0], q[1];')).toEqual(
			[[2, 3]],
		);
	});

	it('keeps the index as written for a register that was never declared', () => {
		expect(multiQubitOperands('OPENQASM 3.0;\ncz q[0], q[5];')).toEqual([[0, 5]]);
	});

	it('never reads a classical bit as a qubit', () => {
		expect(
			multiQubitOperands(
				'OPENQASM 3.0;\nqubit[3] q;\nbit[3] c;\nif (c[0] == 1) x q[1];\nif (c[1]) cz q[1], q[2];',
			),
		).toEqual([[1, 2]]);
		expect(
			multiQubitOperands('OPENQASM 3.0;\nqubit[2] q;\ncreg cc[2];\nmeasure q[1] -> cc[0];'),
		).toEqual([]);
		expect(multiQubitOperands('OPENQASM 3.0;\nbit [2] c;\ncz c[0], c[1];')).toEqual([]);
		expect(multiQubitOperands('OPENQASM 3.0;\nbit[ 2 ] c;\ncz c[0], c[1];')).toEqual([]);
	});

	// The same Bell circuit as Circuit Build writes it from the README's palette table, the spelling
	// the 0.5.0 check was written against.
	const PALETTE = `OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
bit[2] c;
rz(1.5707963267948966) q[0];
sx q[0];
rz(1.5707963267948966) q[0];
rz(1.5707963267948966) q[1];
sx q[1];
rz(1.5707963267948966) q[1];
cz q[0], q[1];
rz(1.5707963267948966) q[1];
sx q[1];
rz(1.5707963267948966) q[1];
c[0] = measure q[0];
c[1] = measure q[1];`;

	it('reads the palette form of the same circuit', () => {
		expect(multiQubitOperands(PALETTE)).toEqual([[0, 1]]);
		expect(uncoupledPairs(multiQubitOperands(PALETTE), MAP)).toEqual([]);
	});

	// A line can carry several statements; each is read on its own, and a trailing comment is not
	// read at all, so a `cz` beside a measure assignment keeps its pair and an indexed name in a
	// comment cannot widen it into a group the check ignores.
	it('reads each statement on a line and never a trailing comment', () => {
		expect(pairs('cz q[0], q[5]; c[0] = measure q[0];')).toEqual([[0, 5]]);
		expect(pairs('cz q[0], q[1]; cz q[2], q[7]; c[0] = measure q[0];')).toEqual([[2, 7]]);
		expect(pairs('cz q[0], q[5]; // see table[3]')).toEqual([[0, 5]]);
		expect(multiQubitOperands(`${HEAD}x q[0]; // touches q[1]`)).toEqual([]);
	});

	// The declaration readers and the barrier exclusion see one statement at a time as well, so a
	// barrier sharing a line with a cz is neither an uncoupled pair nor a second layer, and a
	// register declared on a shared line is still recorded.
	it('reads a barrier or a declaration sharing a line on its own', () => {
		expect(multiQubitOperands(`${HEAD}cz q[0], q[1]; barrier q[0], q[5];`)).toEqual([[0, 1]]);
		expect(pairs('cz q[0], q[1]; barrier q[0], q[5];')).toEqual([]);
		expect(multiQubitOperands('OPENQASM 3.0;\nbit[2] c;\ncz $0, $1; barrier $0, $5;')).toEqual([
			[0, 1],
		]);
		expect(
			multiQubitOperands('OPENQASM 3.0;\nqubit[2] q; bit[2] c;\nmeasure q[1] -> c[0];'),
		).toEqual([]);
		expect(
			multiQubitOperands(
				'OPENQASM 3.0; include "stdgates.inc"; qubit[2] a; qubit[2] b; cz a[0], b[1];',
			),
		).toEqual([[0, 3]]);
	});

	// Neither the operand regex nor the comment cut may grow with the square of a line's length.
	// Without the lookbehind a 200k character name took a quarter of a minute, and a comment strip
	// written as `.*$` took as long on a run of slashes before a bare carriage return; either would
	// block n8n's event loop on a webhook payload, and the default timeout catches both. The spacing
	// the declaration readers allow is the same trap: a bracket that never closes makes every split
	// of a long run of spaces a candidate.
	it('stays linear on a long identifier', () => {
		const name = 'a'.repeat(200_000);
		const digits = '1'.repeat(200_000);
		const slashes = '/'.repeat(200_000);
		const spaces = ' '.repeat(200_000);
		expect(
			multiQubitOperands(
				`${HEAD}x ${name};\nx ${name}[${digits};\nx ${slashes}\rcz q[0], q[5];\ncz q[0], q[5];`,
			),
		).toEqual([[0, 5]]);
		const declared = `qubit${spaces}[${spaces}2${spaces}] a;`;
		const unclosed = `qubit${spaces}[${spaces}2 b;\nbit${spaces}[${spaces}2 d;`;
		expect(multiQubitOperands(`${HEAD}${declared}\n${unclosed}\ncz q[0], q[5];`)).toEqual([[0, 5]]);
	});

	// A map that cannot be read must produce no alarm rather than a false one.
	it.each([[null], ['nope'], [[]], [[[0]]], [[['a', 'b']]]])(
		'reports nothing for an unusable map: %s',
		(map) => {
			expect(uncoupledPairs([[0, 5]], map)).toEqual([]);
		},
	);

	it('skips malformed entries but still uses the usable ones', () => {
		expect(uncoupledPairs([[0, 5]], [[0, 1], 'x', [1], [2, 'a']])).toEqual([[0, 5]]);
		expect(uncoupledPairs([[0, 1]], [[0, 1], 'x', [1], [2, 'a']])).toEqual([]);
	});

	it('lists the neighbours a qubit does have, sorted', () => {
		expect(coupledNeighbours(3, MAP)).toEqual([2, 4, 16]);
		expect(coupledNeighbours(99, MAP)).toEqual([]);
		expect(coupledNeighbours(0, null)).toEqual([]);
		expect(coupledNeighbours(0, [[0], 'x'])).toEqual([]);
	});

	describe('on the submit path', () => {
		const CZ = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[20] q;\nbit[20] c;\ncz q[0], q[5];';
		const OK = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[20] q;\nbit[20] c;\ncz q[0], q[1];';
		const ONE = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nx q[0];';

		const run = (qasm3: unknown, respond?: (call: HttpCall) => unknown) => {
			const { ctx, requests } = makeExecuteContext({
				params: { backend: 'ibm_fez', qasm3, shots: 16 },
				http:
					respond ??
					((call: HttpCall) =>
						String(call.url).endsWith('/configuration') ? { coupling_map: MAP } : { id: 'job-1' }),
			});
			return handleJob
				.call(ctx, TEST_CTX, 'submitSampler', 0)
				.then((result) => ({ result, requests: requests as HttpCall[] }));
		};

		it('warns, names both qubits, and says what qubit 0 does connect to', async () => {
			const { result } = await run(CZ);
			const warnings = (result as { warnings: string[] }).warnings;
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('qubits 0 and 5');
			expect(warnings[0]).toContain('ibm_fez');
			expect(warnings[0]).toContain('Qubit 0 connects to 1');
		});

		// A qubit that appears nowhere in the map has no neighbours to suggest, so the message drops
		// the hint rather than ending with a dangling "connects to".
		it('omits the hint when the offending qubit has no neighbours at all', async () => {
			const FAR =
				'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[100] q;\nbit[100] c;\ncz q[99], q[5];';
			const { result } = await run(FAR);
			const warnings = (result as { warnings: string[] }).warnings;
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('qubits 99 and 5');
			expect(warnings[0]).not.toContain('connects to');
			expect(warnings[0]).toMatch(/fail it\.$/);
		});

		it('stays silent for a coupled pair', async () => {
			const { result } = await run(OK);
			expect(result).not.toHaveProperty('warnings');
		});

		// The same read now feeds the ISA check, so it happens for every OpenQASM 3 circuit, and it
		// happens once, ahead of the job.
		it('reads the configuration once even without a two-qubit gate, before the job is posted', async () => {
			const { requests } = await run(ONE);
			expect(requests).toHaveLength(2);
			expect(requests[0]).toMatchObject({
				method: 'GET',
				url: `${TEST_CTX.baseUrl}/backends/ibm_fez/configuration`,
			});
			expect(requests[1]).toMatchObject({ method: 'POST', url: `${TEST_CTX.baseUrl}/jobs` });
		});

		it('reads the map once for a whole list of circuits', async () => {
			const { requests, result } = await run([CZ, CZ, OK]);
			const configCalls = requests.filter((call) => String(call.url).endsWith('/configuration'));
			expect(configCalls).toHaveLength(1);
			// The same offending pair appears twice in the list and is reported once.
			expect((result as { warnings: string[] }).warnings).toHaveLength(1);
		});

		// The map is undirected, so both spellings offend on one physical pair and one sentence covers
		// them; two would also double what the closing sentence below counts.
		it('names a pair once however the circuit spells its operands', async () => {
			const { result } = await run(`${CZ}\ncz q[5], q[0];`);
			const warnings = (result as { warnings: string[] }).warnings;
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('qubits 0 and 5');
		});

		// Deduplication bounds the repeats of one pair, not the number of distinct pairs, which grows
		// with the square of the qubits an untranspiled circuit touches: 100 of them wired all to all
		// touch 4950 pairs, 4839 of them uncoupled on ibm_fez, which was 4839 sentences on the item and
		// 4839 lines in the n8n log for one submit. The advice is the same in every one, so the list
		// stops and a closing sentence carries the count of the rest.
		describe('the reported pairs are capped', () => {
			// n distinct pairs, every one of them (0, k) with k above 1, which this map never couples.
			const spread = (n: number) => {
				const lines = ['OPENQASM 3.0;', 'include "stdgates.inc";', 'qubit[200] q;'];
				for (let k = 2; k < n + 2; k++) lines.push(`cz q[0], q[${k}];`);
				return lines.join('\n');
			};

			const submitAndLog = async (qasm3: string) => {
				const logged: string[] = [];
				const { ctx } = makeExecuteContext({
					params: { backend: 'ibm_fez', qasm3, shots: 16 },
					http: (call: HttpCall) =>
						String(call.url).endsWith('/configuration') ? { coupling_map: MAP } : { id: 'job-1' },
				});
				(ctx as unknown as { logger: { warn: (m: string) => void } }).logger = {
					warn: (message: string) => logged.push(message),
				};
				const result = (await handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)) as {
					warnings: string[];
				};
				return { warnings: result.warnings, logged };
			};

			it('names every pair while there are no more than the cap', async () => {
				const { warnings, logged } = await submitAndLog(spread(MAX_COUPLING_WARNINGS));
				expect(warnings).toHaveLength(MAX_COUPLING_WARNINGS);
				expect(warnings[MAX_COUPLING_WARNINGS - 1]).toContain(
					`qubits 0 and ${MAX_COUPLING_WARNINGS + 1}`,
				);
				expect(warnings.some((line) => line.includes('further'))).toBe(false);
				expect(logged).toHaveLength(MAX_COUPLING_WARNINGS);
			});

			it('names the cap and counts the rest in one closing sentence', async () => {
				const { warnings, logged } = await submitAndLog(spread(100));
				expect(warnings).toHaveLength(MAX_COUPLING_WARNINGS + 1);
				expect(warnings[0]).toContain('qubits 0 and 2');
				expect(warnings[MAX_COUPLING_WARNINGS - 1]).toContain(
					`qubits 0 and ${MAX_COUPLING_WARNINGS + 1}`,
				);
				expect(warnings[MAX_COUPLING_WARNINGS]).toBe(
					`Circuit puts two-qubit gates on ${100 - MAX_COUPLING_WARNINGS} further pairs ibm_fez does not couple, not listed here. Transpile the circuit for ibm_fez before submitting.`,
				);
				// The log follows the same list, so the cap holds there too.
				expect(logged).toEqual(warnings);
			});

			it('writes the singular when exactly one pair is left over', async () => {
				const { warnings } = await submitAndLog(spread(MAX_COUPLING_WARNINGS + 1));
				expect(warnings).toHaveLength(MAX_COUPLING_WARNINGS + 1);
				expect(warnings[MAX_COUPLING_WARNINGS]).toContain('on 1 further pair ibm_fez');
			});

			// The same pairs written both ways round, which a hand-written echo layer does: the cap and
			// the count are over physical pairs, so this reads as the one-way circuit above does.
			it('spends neither the cap nor the count on a reversed spelling', async () => {
				const lines = ['OPENQASM 3.0;', 'include "stdgates.inc";', 'qubit[200] q;'];
				for (let k = 2; k < MAX_COUPLING_WARNINGS + 3; k++) {
					lines.push(`cz q[0], q[${k}];`, `cz q[${k}], q[0];`);
				}
				const { warnings } = await submitAndLog(lines.join('\n'));
				expect(warnings).toHaveLength(MAX_COUPLING_WARNINGS + 1);
				expect(warnings[MAX_COUPLING_WARNINGS]).toContain('on 1 further pair ibm_fez');
			});
		});

		// The README's own transpiled Bell circuit, on the device it was transpiled for: the map is
		// read and nothing is flagged.
		it('reads the map for the physical-qubit form and stays silent on the right device', async () => {
			const { requests, result } = await run(TRANSPILED);
			expect(requests.filter((call) => String(call.url).endsWith('/configuration'))).toHaveLength(
				1,
			);
			expect(result).not.toHaveProperty('warnings');
		});

		// Same form, transpiled for a different topology: the pair is named exactly as for q[n].
		it('warns about an uncoupled physical pair', async () => {
			const { result } = await run(TRANSPILED.replace('cz $0, $1;', 'cz $0, $5;'));
			const warnings = (result as { warnings: string[] }).warnings;
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('qubits 0 and 5');
			expect(warnings[0]).toContain('Qubit 0 connects to 1');
		});

		// Reading the map is a courtesy. A submit must never fail because of it.
		it('submits anyway when the map cannot be read', async () => {
			const { result, requests } = await run(CZ, (call: HttpCall) => {
				if (String(call.url).endsWith('/configuration')) throw new Error('backend unreachable');
				return { id: 'job-1' };
			});
			expect(result).toMatchObject({ jobId: 'job-1' });
			expect(result).not.toHaveProperty('warnings');
			expect(requests.some((call) => call.method === 'POST')).toBe(true);
		});

		it('submits anyway when the map is missing from the response', async () => {
			const { result } = await run(CZ, (call: HttpCall) =>
				String(call.url).endsWith('/configuration') ? { n_qubits: 156 } : { id: 'job-1' },
			);
			expect(result).toMatchObject({ jobId: 'job-1' });
			expect(result).not.toHaveProperty('warnings');
		});

		it('skips the map entirely for a QPY circuit, which cannot be read', async () => {
			const { ctx, requests } = makeExecuteContext({
				params: {
					backend: 'ibm_fez',
					circuitFormat: 'qpy',
					qpyCircuit: 'eJwL9Az2dAn2dAYAC9gCVQ==',
					shots: 16,
				},
				http: () => ({ id: 'job-1' }),
			});
			await handleJob.call(ctx, TEST_CTX, 'submitSampler', 0);
			expect(
				(requests as HttpCall[]).some((call) => String(call.url).endsWith('/configuration')),
			).toBe(false);
		});
	});
});

// Everything under params.options used to be reachable only through the Additional Options JSON.
describe('primitive option fields', () => {
	const optionsOf = (body: Record<string, unknown>) =>
		(body.params as Record<string, unknown>).options;

	it('sends the three shared collections under their option keys for the sampler', async () => {
		const { body } = await submit('submitSampler', {
			dynamicalDecoupling: true,
			dynamicalDecouplingOptions: { sequenceType: 'XY4' },
			twirlingGates: true,
			twirlingOptions: { numRandomizations: 16, strategy: 'all' },
			executionOptions: { initQubits: false, repDelay: 0.00025, measType: 'kerneled' },
		});
		expect(optionsOf(body)).toEqual({
			dynamical_decoupling: { sequence_type: 'XY4', enable: true },
			twirling: { num_randomizations: 16, strategy: 'all', enable_gates: true },
			execution: { init_qubits: false, rep_delay: 0.00025, meas_type: 'kerneled' },
		});
	});

	it('sends resilience, seed and default precision for the estimator and drops meas_type', async () => {
		const { body } = await submit('submitEstimator', {
			observables: '"ZZ"',
			resilienceOptions: { zneMitigation: true, zneNoiseFactors: '1,3,5' },
			seedEstimator: '7',
			defaultPrecision: 0.02,
			executionOptions: { measType: 'kerneled', initQubits: true },
		});
		expect(optionsOf(body)).toEqual({
			resilience: { zne_mitigation: true, zne: { noise_factors: [1, 3, 5] } },
			seed_estimator: 7,
			default_precision: 0.02,
			execution: { init_qubits: true },
		});
		expect((body.params as Record<string, unknown>).resilience_level).toBe(1);
	});

	it('ignores estimator-only fields on a sampler submit', async () => {
		const { body } = await submit('submitSampler', {
			resilienceOptions: { zneMitigation: true },
			seedEstimator: '7',
			defaultPrecision: 0.5,
		});
		expect(optionsOf(body)).toBeUndefined();
	});

	it('lets a dedicated field win over Additional Options key by key', async () => {
		const { body } = await submit('submitSampler', {
			additionalOptions:
				'{"twirling":{"strategy":"active","num_randomizations":8},"default_shots":4096}',
			twirlingOptions: { strategy: 'all' },
		});
		expect(optionsOf(body)).toEqual({
			default_shots: 4096,
			twirling: { strategy: 'all', num_randomizations: 8 },
		});
	});

	it('sends no options when every collection is empty and the estimator extras are at rest', async () => {
		const { body } = await submit('submitEstimator', {
			observables: '"ZZ"',
			twirlingOptions: {},
			dynamicalDecouplingOptions: null,
			executionOptions: [],
			resilienceOptions: {},
			seedEstimator: '',
			defaultPrecision: 0,
		});
		expect(optionsOf(body)).toBeUndefined();
	});

	it.each([[0], [42]])(
		'accepts a seed delivered as the number %s by an expression',
		async (seed) => {
			const { body } = await submit('submitEstimator', {
				observables: '"ZZ"',
				seedEstimator: seed,
			});
			expect(optionsOf(body)).toEqual({ seed_estimator: seed });
		},
	);
});

describe('primitive option fields refuse what IBM would reject', () => {
	const attempt = (
		operation: 'submitSampler' | 'submitEstimator',
		params: Record<string, unknown>,
	) => {
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_kingston', qasm3: QASM, ...params },
			http: () => ({ id: 'job-123' }),
		});
		return { run: () => handleJob.call(ctx, TEST_CTX, operation, 0), requests };
	};

	it.each([
		[
			'twirlingOptions',
			{ numRandomizations: 'many' },
			/Number of Randomizations must be "auto" or an integer/,
		],
		[
			'twirlingOptions',
			{ shotsPerRandomization: 0 },
			/Shots per Randomization must be an integer between 1 and 2147483647/,
		],
		[
			'twirlingOptions',
			{ numRandomizations: [32] },
			/Number of Randomizations must be "auto" or an integer/,
		],
		[
			'executionOptions',
			{ repDelay: 'soon' },
			/Repetition Delay \(Seconds\) must be a number at least 0/,
		],
	])('refuses %s %o before the request', async (name, collection, message) => {
		const { run, requests } = attempt('submitSampler', { [name]: collection });
		await expect(run()).rejects.toThrow(message);
		expect(requests).toHaveLength(0);
	});

	it.each([
		['seedEstimator', '1.5', /Seed Estimator must be an integer between 0 and 2147483647/],
		['seedEstimator', '-1', /Seed Estimator must be an integer between 0 and 2147483647/],
		['defaultPrecision', '', /Default Precision must be a number at least 0/],
		['defaultPrecision', -0.1, /Default Precision must be a number at least 0/],
	])('refuses %s of %o before the request', async (name, value, message) => {
		const { run, requests } = attempt('submitEstimator', { observables: '"ZZ"', [name]: value });
		await expect(run()).rejects.toThrow(message);
		expect(requests).toHaveLength(0);
	});

	it('refuses malformed resilience entries before the request', async () => {
		const factors = attempt('submitEstimator', {
			observables: '"ZZ"',
			resilienceOptions: { zneNoiseFactors: '1, two' },
		});
		await expect(factors.run()).rejects.toThrow(/ZNE Noise Factors/);
		expect(factors.requests).toHaveLength(0);

		const depths = attempt('submitEstimator', {
			observables: '"ZZ"',
			resilienceOptions: { noiseLearningLayerPairDepths: '2.5' },
		});
		await expect(depths.run()).rejects.toThrow(/must be whole numbers/);
		expect(depths.requests).toHaveLength(0);

		const gain = attempt('submitEstimator', {
			observables: '"ZZ"',
			resilienceOptions: { pecMitigation: true, pecNoiseGain: [0.5] },
		});
		await expect(gain.run()).rejects.toThrow(
			/PEC Noise Gain must be "auto" or a number at least 0/,
		);
		expect(gain.requests).toHaveLength(0);
	});
});
