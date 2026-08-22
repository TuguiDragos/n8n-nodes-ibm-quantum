import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	hasNoiseLearnerData,
	parseNoiseLearnerPub,
	parseResults,
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
			results: [
				{ data: { evs: 0.5, stds: 0.1, ensemble_standard_error: 0.01 }, metadata: {} },
			],
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
		['rates is an object, not base64', { __value__: { error: { __value__: { rates: { __value__: {} } } } } }],
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
