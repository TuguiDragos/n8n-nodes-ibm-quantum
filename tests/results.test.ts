import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	hasNoiseLearnerData,
	hasSerializedResults,
	parseNoiseLearnerPub,
	executorEntries,
	parseExecutorEntry,
	parseResults,
	parseSerializedPub,
	samplesToCounts,
} from '../nodes/IbmQuantum/results';

describe('samplesToCounts', () => {
	it('counts hex samples as zero-padded bitstrings', () => {
		expect(samplesToCounts(['0x0', '0x3', '0x3'], 2)).toEqual({ '00': 1, '11': 2 });
	});

	it('pads to the requested width', () => {
		expect(samplesToCounts(['0x1'], 4)).toEqual({ '0001': 1 });
	});

	it('ignores unparseable samples', () => {
		expect(samplesToCounts(['zz', '0x1'], 2)).toEqual({ '01': 1 });
	});
});

describe('parseResults', () => {
	it('parses a Sampler pub into counts', () => {
		const response = {
			results: [
				{ data: { c: { samples: ['0x0', '0x1', '0x1'], num_bits: 2 } }, metadata: { shots: 3 } },
			],
		};
		const parsed = parseResults(response);

		expect(parsed.pubCount).toBe(1);
		const pub = (parsed.pubs as Array<Record<string, unknown>>)[0];
		expect(pub.type).toBe('sampler');
		expect(pub.register).toBe('c');
		expect(pub.shots).toBe(3);
		expect(pub.counts).toEqual({ '00': 1, '01': 2 });
	});

	it('honours a preferred register name', () => {
		const response = {
			results: [
				{
					data: {
						meas: { samples: ['0x0'], num_bits: 1 },
						other: { samples: ['0x1'], num_bits: 1 },
					},
					metadata: {},
				},
			],
		};
		const pub = (parseResults(response, 'other').pubs as Array<Record<string, unknown>>)[0];
		expect(pub.register).toBe('other');
		expect(pub.counts).toEqual({ '1': 1 });
	});

	it('infers the bit width when num_bits is absent', () => {
		const response = { results: [{ data: { c: { samples: ['0x0', '0x3'] } }, metadata: {} }] };
		const pub = (parseResults(response).pubs as Array<Record<string, unknown>>)[0];
		expect(pub.numBits).toBe(2);
		expect(pub.counts).toEqual({ '00': 1, '11': 1 });
	});

	it('parses an Estimator pub', () => {
		const response = {
			results: [{ data: { evs: 0.5, stds: 0.1, ensemble_standard_error: 0.01 }, metadata: {} }],
		};
		const pub = (parseResults(response).pubs as Array<Record<string, unknown>>)[0];

		expect(pub.type).toBe('estimator');
		expect(pub.evs).toBe(0.5);
		expect(pub.stds).toBe(0.1);
		expect(pub.ensembleStandardError).toBe(0.01);
	});

	it('returns an empty result set when there are no pubs', () => {
		expect(parseResults({})).toEqual({ pubCount: 0, pubs: [] });
	});
});

describe('samplesToCounts wide-register precision (BigInt, not parseInt)', () => {
	it('keeps distinct outcomes that differ only in low bits beyond 53 bits', () => {
		// 0x20000000000000 = 2^53 and 0x20000000000001 = 2^53 + 1. parseInt would collapse both to
		// the same double; BigInt keeps them apart as two 54-bit bitstrings.
		const counts = samplesToCounts(['0x20000000000001', '0x20000000000000'], 54) as Record<
			string,
			number
		>;
		const keys = Object.keys(counts);
		expect(keys).toHaveLength(2);
		expect(keys.every((k) => k.length === 54)).toBe(true);
		expect(counts['1' + '0'.repeat(53)]).toBe(1);
		expect(counts['1' + '0'.repeat(52) + '1']).toBe(1);
	});

	it('skips unparseable samples without collapsing them into a key', () => {
		expect(samplesToCounts(['0x3', 'zz', ''], 2)).toEqual({ '11': 1 });
	});
});

describe('inferNumBits NaN guard', () => {
	it('does not let an unparseable sample inflate the inferred width', () => {
		// num_bits absent: width is inferred. 'zz' must be ignored, not treated as 3 bits ('NaN').
		const response = { results: [{ data: { c: { samples: ['0x1', 'zz'] } }, metadata: {} }] };
		const pub = (parseResults(response).pubs as Array<Record<string, unknown>>)[0];
		expect(pub.numBits).toBe(1);
		expect(pub.counts).toEqual({ '1': 1 });
	});
});

// Trimmed from the body IBM actually returned for job da49nauaa69c739jhigg on ibm_fez, a completed
// noise learner run. The point is the shape: the payload is under `data`, not `results`.
const NOISE_LEARNER_BODY = {
	data: [
		{
			__type__: '_json',
			__module__: 'qiskit_ibm_runtime.utils.noise_learner_result',
			__class__: 'LayerError',
			__value__: {
				circuit: { __type__: 'QuantumCircuit', __value__: 'eJwL9Az29gzhZWJlgALGgkIG' },
				qubits: [0, 1],
				error: {
					__type__: '_json',
					__class__: 'PauliLindbladError',
					__value__: {
						generators: {
							__type__: 'settings',
							__class__: 'PauliList',
							__value__: { data: ['IX', 'ZZ'] },
						},
						rates: { __type__: 'ndarray', __value__: 'eJyb7BfqGxDJyFDGUK2ekloc' },
					},
				},
			},
		},
	],
	metadata: { backend: 'ibm_fez', input_options: { num_randomizations: 1 } },
};

describe('noise learner results', () => {
	it('recognises the body by its data array, not by results', () => {
		expect(hasNoiseLearnerData(NOISE_LEARNER_BODY)).toBe(true);
		// A sampler body wins even when both keys are present, so the established shape never
		// changes meaning underneath a workflow that already reads it.
		expect(hasNoiseLearnerData({ results: [], data: [{}] })).toBe(false);
		expect(hasNoiseLearnerData({})).toBe(false);
		expect(hasNoiseLearnerData({ data: 'nope' })).toBe(false);
	});

	// This is the defect: a real 1133-byte result body used to come back as zero pubs.
	it('parses a learned layer instead of reporting nothing', () => {
		const parsed = parseResults(NOISE_LEARNER_BODY);
		expect(parsed.pubCount).toBe(1);
		expect((parsed.pubs as IDataObject[])[0]).toEqual({
			type: 'noiseLearner',
			qubits: [0, 1],
			generators: ['IX', 'ZZ'],
			ratesEncoded: 'eJyb7BfqGxDJyFDGUK2ekloc',
			circuitEncoded: 'eJwL9Az29gzhZWJlgALGgkIG',
		});
	});

	// IBM's spec gives every Executor and NoiseLearnerV3 result the same outline, a `data` array and
	// no `results` array, so a job submitted from Qiskit under either reads here as a layer of nulls
	// beside the whole body in `raw`. llms-full.txt says so under "What this package does NOT do";
	// this holds the parser to it, because the alternative is flagging a body IBM did send as one
	// with nothing in it to read.
	it.each([
		[
			'a NoiseLearnerV3 v0.3',
			{ schema_version: 'v0.3', data: [{ generators_sparse: [], num_qubits: 2 }] },
		],
	])('reads %s body here rather than reporting no result body', (_label, body) => {
		expect(hasNoiseLearnerData(body)).toBe(true);
		expect(parseResults(body)).toEqual({
			pubCount: 1,
			pubs: [
				{
					type: 'noiseLearner',
					encoding: 'ibm-array',
					numQubits: 2,
					generatorsSparse: [],
					ratesEncoded: null,
					ratesShape: null,
					ratesStdEncoded: null,
					metadata: {},
				},
			],
		});
	});

	// The array container IBM uses for both of these shapes is passed through, so every field it
	// carries has to survive a body that does not carry it.
	it('degrades every part of an array container it cannot read', () => {
		const body = {
			data: [
				{
					generators_sparse: 'not a list',
					num_qubits: 'two',
					rates: { data: 'AAA', shape: 'nope', dtype: 7 },
					rates_std: { shape: [2] },
				},
			],
		};
		expect(parseResults(body as unknown as IDataObject)).toEqual({
			pubCount: 1,
			pubs: [
				{
					type: 'noiseLearner',
					encoding: 'ibm-array',
					numQubits: null,
					generatorsSparse: null,
					ratesEncoded: 'AAA',
					ratesShape: null,
					ratesStdEncoded: null,
					metadata: {},
				},
			],
		});
	});

	it('does not read an entry that carries neither layer fields nor results as a layer', () => {
		expect(hasNoiseLearnerData({ data: [{ something: 1 }] })).toBe(false);
		expect(hasNoiseLearnerData({ data: [null] })).toBe(false);
		expect(hasNoiseLearnerData({ data: ['text'] })).toBe(false);
		expect(hasNoiseLearnerData({ data: [[1]] })).toBe(false);
		// Neither reader claims it, so the body falls through to the `results` path and reads as no
		// pubs, with the whole thing still handed back in `raw` by the caller.
		expect(executorEntries({ data: [{ something: 1 }] })).toBeNull();
		expect(parseResults({ data: [{ something: 1 }] })).toEqual({ pubCount: 0, pubs: [] });
		// An empty list is nothing to read either way; the learner branch answers first in practice.
		expect(executorEntries({ data: [] })).toBeNull();
	});

	it('reads both rate arrays of a flat layer when IBM sends them', () => {
		const body = {
			data: [
				{
					generators_sparse: [[['X', [1]]]],
					num_qubits: 2,
					rates: { data: 'UkFURVM=', shape: [1], dtype: 'float64' },
					rates_std: { data: 'U1RE', shape: [1], dtype: 'float64' },
					metadata: { learning_protocol: 'lindblad' },
				},
			],
		};
		expect(parseResults(body as unknown as IDataObject)).toEqual({
			pubCount: 1,
			pubs: [
				{
					type: 'noiseLearner',
					encoding: 'ibm-array',
					numQubits: 2,
					generatorsSparse: [[['X', [1]]]],
					ratesEncoded: 'UkFURVM=',
					ratesShape: [1],
					ratesStdEncoded: 'U1RE',
					metadata: { learning_protocol: 'lindblad' },
				},
			],
		});
	});

	it('leaves an empty or partial executor body alone', () => {
		expect(parseResults({ data: [] })).toEqual({ pubCount: 0, pubs: [] });
		const partial = { data: [{ results: { a: 'not a container' } }] };
		expect(parseResults(partial as unknown as IDataObject)).toEqual({
			pubCount: 1,
			pubs: [{ type: 'executor', encoding: 'ibm-array', registers: { a: null }, metadata: {} }],
		});
		expect(parseExecutorEntry(null)).toEqual({
			type: 'executor',
			encoding: 'ibm-array',
			registers: {},
			metadata: {},
		});
	});

	// An executor body is not a learned layer. Reading it as one returned every field null and lost
	// the register data: measured on one account, 4 of 160 completed jobs, alongside 6 flat learner
	// bodies whose fields the envelope reader could not see either.
	it('reads an executor body as its own shape rather than as a learned layer', () => {
		const body = {
			schema_version: 'v2.0',
			data: [
				{
					results: { meas: { data: 'jZvGTe', shape: [256, 64], dtype: 'bool' } },
					metadata: { stretch_values: [] },
				},
			],
		};
		expect(hasNoiseLearnerData(body)).toBe(false);
		expect(parseResults(body)).toEqual({
			pubCount: 1,
			pubs: [
				{
					type: 'executor',
					encoding: 'ibm-array',
					registers: { meas: { encoded: 'jZvGTe', shape: [256, 64], dtype: 'bool' } },
					metadata: { stretch_values: [] },
				},
			],
		});
	});

	// The register check exists for sampler classical registers. A learned layer has none, so
	// asking for one must not raise on a body that could never carry it.
	it('ignores a requested register rather than throwing', () => {
		expect(() => parseResults(NOISE_LEARNER_BODY, 'c')).not.toThrow();
		expect(parseResults(NOISE_LEARNER_BODY, 'c').pubCount).toBe(1);
	});

	it('reports an empty data array as zero pubs without failing', () => {
		expect(parseResults({ data: [] })).toEqual({ pubCount: 0, pubs: [] });
	});

	// Every level of IBM's envelope is optional as far as this parser is concerned: a reshaped body
	// must yield nulls, never a throw, because the caller still hands back the untouched raw body.
	it.each([
		['null entry', null],
		['bare string', 'nope'],
		['empty object', {}],
		['no __value__', { __type__: '_json' }],
		['error is not an object', { __value__: { qubits: [0], error: 7 } }],
		['generators is not a list', { __value__: { error: { __value__: { generators: 5 } } } }],
		[
			'rates is an object, not base64',
			{ __value__: { error: { __value__: { rates: { __value__: {} } } } } },
		],
	])('survives a %s', (_label, entry) => {
		const pub = parseNoiseLearnerPub(entry);
		expect(pub.type).toBe('noiseLearner');
		expect(() => JSON.stringify(pub)).not.toThrow();
	});

	it('keeps qubits only when they arrive as a list', () => {
		expect(parseNoiseLearnerPub({ __value__: { qubits: 'nope' } }).qubits).toBeNull();
		expect(parseNoiseLearnerPub({ __value__: { qubits: [3, 4] } }).qubits).toEqual([3, 4]);
	});
});

// IBM answers in this encoding whenever the submitted params carry `support_qiskit`, which is what
// qiskit-ibm-runtime sends. The bodies below are the real ones, trimmed: a sampler PUB from
// daa63eerbfbs73cibfq0 and an estimator PUB from d9hr4gshonhs73adgqng, both measured 2026-09-07.
describe('the serialised Qiskit result encoding', () => {
	const samplerBody = {
		__type__: 'PrimitiveResult',
		__value__: {
			pub_results: [
				{
					__type__: 'SamplerPubResult',
					__value__: {
						data: {
							__type__: 'DataBin',
							__value__: {
								field_names: ['c'],
								fields: {
									c: {
										__type__: 'BitArray',
										__value__: {
											array: { __type__: 'ndarray', __value__: 'eJydVzlu' },
											num_bits: 2,
										},
									},
								},
							},
						},
						metadata: { circuit_metadata: {} },
					},
				},
			],
			metadata: { version: 2 },
		},
	};

	const estimatorBody = {
		__type__: 'PrimitiveResult',
		__value__: {
			pub_results: [
				{
					__type__: 'PubResult',
					__value__: {
						data: {
							__type__: 'DataBin',
							__value__: {
								field_names: ['evs', 'stds'],
								fields: {
									evs: { __type__: 'ndarray', __value__: 'eJxjYAAA' },
									stds: { __type__: 'ndarray', __value__: 'eJxjYgAA' },
								},
							},
						},
						metadata: { shots: 4096 },
					},
				},
			],
		},
	};

	// The defect this replaced: reading only `results` reported these as zero pubs and told the
	// caller no result was available. Measured on one account, 25 of 160 completed jobs.
	it('is recognised, where a body without results used to read as nothing', () => {
		expect(hasSerializedResults(samplerBody)).toBe(true);
		expect(hasSerializedResults(estimatorBody)).toBe(true);
		expect(hasSerializedResults({ results: [] })).toBe(false);
		expect(hasSerializedResults({})).toBe(false);
		expect(hasSerializedResults(null)).toBe(false);
	});

	it('reads a sampler PUB down to its register, width and encoded shots', () => {
		const parsed = parseResults(samplerBody as unknown as IDataObject);
		expect(parsed.pubCount).toBe(1);
		expect((parsed.pubs as IDataObject[])[0]).toEqual({
			type: 'sampler',
			encoding: 'qiskit-serialized',
			register: 'c',
			numBits: 2,
			samplesEncoded: 'eJydVzlu',
			metadata: { circuit_metadata: {} },
		});
	});

	it('reads an estimator PUB down to its field names and encoded arrays', () => {
		const parsed = parseResults(estimatorBody as unknown as IDataObject);
		expect(parsed.pubCount).toBe(1);
		expect((parsed.pubs as IDataObject[])[0]).toEqual({
			type: 'estimator',
			encoding: 'qiskit-serialized',
			fieldNames: ['evs', 'stds'],
			fieldsEncoded: { evs: 'eJxjYAAA', stds: 'eJxjYgAA' },
			metadata: { shots: 4096 },
		});
	});

	it('honours a requested register and reports one no PUB carries', () => {
		const matched = parseResults(samplerBody as unknown as IDataObject, 'c');
		expect(matched.pubCount).toBe(1);
		expect(matched).not.toHaveProperty('registerError');
		const missed = parseResults(samplerBody as unknown as IDataObject, 'meas');
		expect(missed.registerError).toBe('Register "meas" is not in this result. Available: c.');
		expect((missed.pubs as IDataObject[])[0]).toMatchObject({
			register: 'c',
			samplesEncoded: 'eJydVzlu',
			requestedRegister: 'meas',
			registerFallback: true,
		});
	});

	// An estimator PUB names its fields where a sampler PUB names its register, so a Register Name
	// left over from a sampler workflow finds none of them. That must not cost the arrays.
	it('reports a register name against an estimator PUB without dropping the fields', () => {
		const parsed = parseResults(estimatorBody as unknown as IDataObject, 'c');
		expect(parsed.registerError).toBe('Register "c" is not in this result. Available: evs, stds.');
		expect((parsed.pubs as IDataObject[])[0].fieldsEncoded).toEqual({
			evs: 'eJxjYAAA',
			stds: 'eJxjYgAA',
		});
	});

	// IBM writes some estimator bodies with Python's json, which emits a bare Infinity. JSON does
	// not allow it, so the body arrives as text no parser can read. Saying so beats claiming the
	// job produced nothing.
	it('says why a body it cannot parse is unreadable instead of reporting no result', () => {
		const text = '{"__type__": "PrimitiveResult", "__value__": {"scaling": Infinity}}';
		expect(hasSerializedResults(text)).toBe(true);
		const parsed = parseResults(text as unknown as IDataObject);
		expect(parsed.pubCount).toBe(0);
		expect(parsed.resultsUnreadable).toContain('Infinity');
	});

	it('parses the same encoding when IBM sends it as valid JSON text', () => {
		const parsed = parseResults(JSON.stringify(samplerBody) as unknown as IDataObject);
		expect(parsed.pubCount).toBe(1);
		expect((parsed.pubs as IDataObject[])[0].register).toBe('c');
	});

	it('rejects an envelope whose pub_results is not a list', () => {
		expect(hasSerializedResults({ __type__: 'PrimitiveResult', __value__: {} })).toBe(false);
		expect(
			hasSerializedResults({ __type__: 'PrimitiveResult', __value__: { pub_results: 3 } }),
		).toBe(false);
		expect(hasSerializedResults(['PrimitiveResult'])).toBe(false);
		expect(hasSerializedResults('{"__type__": "SomethingElse"}')).toBe(false);
		// Valid JSON that is not an object: parsed, found not to be an envelope, and left alone.
		expect(hasSerializedResults('[1, 2]')).toBe(false);
		expect(hasSerializedResults('42')).toBe(false);
	});

	// num_bits comes from the response, so a value that is not a plausible register width is not
	// trusted. There are no samples to measure in this encoding, so the honest answer is null.
	it('reports a null width for a num_bits it cannot trust', () => {
		const widths = [1e9, -1, 2.5, 'two', undefined];
		for (const num_bits of widths) {
			const pub = parseSerializedPub({
				__type__: 'SamplerPubResult',
				__value__: {
					data: {
						__type__: 'DataBin',
						__value__: {
							field_names: ['c'],
							fields: { c: { __type__: 'BitArray', __value__: { array: null, num_bits } } },
						},
					},
				},
			});
			expect(pub.numBits, String(num_bits)).toBeNull();
			expect(pub.samplesEncoded, String(num_bits)).toBeNull();
		}
	});

	it('marks a register fallback when the requested name is not on that PUB', () => {
		const twoPubs = {
			__type__: 'PrimitiveResult',
			__value__: {
				pub_results: [
					samplerBody.__value__.pub_results[0],
					{
						__type__: 'SamplerPubResult',
						__value__: {
							data: {
								__type__: 'DataBin',
								__value__: {
									field_names: ['meas'],
									fields: {
										meas: { __type__: 'BitArray', __value__: { array: null, num_bits: 1 } },
									},
								},
							},
						},
					},
				],
			},
		};
		const parsed = parseResults(twoPubs as unknown as IDataObject, 'meas');
		const pubs = parsed.pubs as IDataObject[];
		expect(pubs[0]).toMatchObject({
			register: 'c',
			requestedRegister: 'meas',
			registerFallback: true,
		});
		expect(pubs[1]).toMatchObject({ register: 'meas' });
		expect(pubs[1].registerFallback).toBeUndefined();
	});

	it('does not raise for a requested register when no PUB names any field', () => {
		const nameless = {
			__type__: 'PrimitiveResult',
			__value__: { pub_results: [{ __type__: 'PubResult', __value__: {} }] },
		};
		expect(parseResults(nameless as unknown as IDataObject, 'c').pubCount).toBe(1);
	});

	it('degrades to nulls rather than throwing on a reshaped envelope', () => {
		const empty = parseSerializedPub({ __type__: 'PubResult', __value__: {} });
		expect(empty).toEqual({
			type: 'estimator',
			encoding: 'qiskit-serialized',
			fieldNames: [],
			fieldsEncoded: {},
			metadata: {},
		});
		expect(parseSerializedPub(null)).toMatchObject({ type: 'estimator', fieldNames: [] });
		expect(parseSerializedPub('nonsense')).toMatchObject({ type: 'estimator' });
	});
});
