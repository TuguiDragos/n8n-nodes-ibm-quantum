import { describe, expect, it } from 'vitest';

import { buildPubData, mergePrimitiveOptions } from '../nodes/IbmQuantum/operations';

describe('buildPubData', () => {
	it('builds a Sampler pub as (circuit, parameters, shots)', () => {
		expect(buildPubData('sampler', 'qasm', null, null, 1024, 0)).toEqual(['qasm', null, 1024]);
		expect(buildPubData('sampler', 'qasm', null, { theta: 1.5 }, 2048, 0)).toEqual([
			'qasm',
			{ theta: 1.5 },
			2048,
		]);
	});

	it('keeps a basic Estimator pub at two items (no trailing null)', () => {
		expect(buildPubData('estimator', 'qasm', 'ZZ', null, 0, 0)).toEqual(['qasm', 'ZZ']);
	});

	it('extends the Estimator pub only when parameters or precision are set', () => {
		expect(buildPubData('estimator', 'qasm', 'ZZ', { t: 1 }, 0, 0)).toEqual(['qasm', 'ZZ', { t: 1 }]);
		expect(buildPubData('estimator', 'qasm', 'ZZ', null, 0, 0.01)).toEqual(['qasm', 'ZZ', null, 0.01]);
		expect(buildPubData('estimator', 'qasm', 'ZZ', { t: 1 }, 0, 0.01)).toEqual([
			'qasm',
			'ZZ',
			{ t: 1 },
			0.01,
		]);
	});
});

describe('mergePrimitiveOptions', () => {
	it('adds no keys when nothing is enabled', () => {
		expect(mergePrimitiveOptions({}, false, false, false)).toEqual({});
	});

	it('enables dynamical decoupling and twirling with the correct key paths', () => {
		expect(mergePrimitiveOptions({}, true, false, false)).toEqual({
			dynamical_decoupling: { enable: true },
		});
		expect(mergePrimitiveOptions({}, false, true, true)).toEqual({
			twirling: { enable_gates: true, enable_measure: true },
		});
	});

	it('preserves the base options and merges into nested objects', () => {
		expect(
			mergePrimitiveOptions(
				{ default_shots: 4096, twirling: { strategy: 'active' } },
				true,
				true,
				false,
			),
		).toEqual({
			default_shots: 4096,
			dynamical_decoupling: { enable: true },
			twirling: { strategy: 'active', enable_gates: true },
		});
	});
});
