import { describe, expect, it } from 'vitest';

import { parseResults, samplesToCounts } from '../nodes/IbmQuantum/results';

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
