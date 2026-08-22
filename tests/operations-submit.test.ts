import { describe, expect, it } from 'vitest';

import {
	coupledNeighbours,
	handleJob,
	MAX_CIRCUITS_PER_JOB,
	uncoupledPairs,
	multiQubitOperands,
} from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

const QASM = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nx q[0];';

// A submit carrying a two-qubit gate first reads the backend's coupling map, so the job POST is not
// always the first call. Find it rather than assume its position.
const jobPost = (requests: HttpCall[]) =>
	requests.find((call) => call.method === 'POST' && String(call.url).endsWith('/jobs')) as HttpCall;

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
			await expect(learn({ noiseLearnerOptions: { layerPairDepths: '0, two' } })).rejects.toThrow(
				/Layer Pair Depths/,
			);
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
// ibm_fez has 352 entries and every one carries its own reverse, so it is read as undirected.
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

		// The configuration call costs about a second, so it must not happen at all for a circuit
		// that cannot possibly need it.
		it('does not read the map when there is no two-qubit gate', async () => {
			const { requests } = await run(ONE);
			expect(requests.some((call) => String(call.url).endsWith('/configuration'))).toBe(false);
			expect(requests).toHaveLength(1);
		});

		it('reads the map once for a whole list of circuits', async () => {
			const { requests, result } = await run([CZ, CZ, OK]);
			const configCalls = requests.filter((call) => String(call.url).endsWith('/configuration'));
			expect(configCalls).toHaveLength(1);
			// The same offending pair appears twice in the list and is reported once.
			expect((result as { warnings: string[] }).warnings).toHaveLength(1);
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
