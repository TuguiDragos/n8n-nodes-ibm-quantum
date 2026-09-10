import { describe, expect, it } from 'vitest';

import {
	ADDITIONAL_OPTION_KEYS,
	buildPubData,
	dynamicalDecouplingFieldOptions,
	executionFieldOptions,
	INT32_MAX,
	mergeOptionTrees,
	mergePrimitiveOptions,
	optionalBoolean,
	requireBoolean,
	requireBoundedNumberOrAuto,
	resilienceFieldOptions,
	twirlingFieldOptions,
} from '../nodes/IbmQuantum/operations';
import { fakeNode } from './fakeContext';

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
		expect(buildPubData('estimator', 'qasm', 'ZZ', { t: 1 }, 0, 0)).toEqual([
			'qasm',
			'ZZ',
			{ t: 1 },
		]);
		expect(buildPubData('estimator', 'qasm', 'ZZ', null, 0, 0.01)).toEqual([
			'qasm',
			'ZZ',
			null,
			0.01,
		]);
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

describe('ADDITIONAL_OPTION_KEYS', () => {
	it('pins the per-program top-level keys to the IBM OpenAPI schema (0.50.5)', () => {
		expect(ADDITIONAL_OPTION_KEYS).toEqual({
			sampler: [
				'default_shots',
				'dynamical_decoupling',
				'execution',
				'experimental',
				'simulator',
				'twirling',
			],
			estimator: [
				'default_precision',
				'default_shots',
				'dynamical_decoupling',
				'execution',
				'experimental',
				'resilience',
				'seed_estimator',
				'simulator',
				'twirling',
			],
			'noise-learner': [
				'experimental',
				'layer_pair_depths',
				'max_layers_to_learn',
				'num_randomizations',
				'shots_per_randomization',
				'simulator',
				'support_qiskit',
				'twirling_strategy',
			],
		});
	});

	it('never lists environment, which is a client-side key', () => {
		for (const program of ['sampler', 'estimator', 'noise-learner'] as const) {
			expect(ADDITIONAL_OPTION_KEYS[program]).not.toContain('environment');
		}
	});
});

describe('mergeOptionTrees', () => {
	it('merges nested objects key by key with the override winning', () => {
		expect(
			mergeOptionTrees(
				{ twirling: { strategy: 'active', num_randomizations: 8 }, default_shots: 1 },
				{ twirling: { strategy: 'all' } },
			),
		).toEqual({ twirling: { strategy: 'all', num_randomizations: 8 }, default_shots: 1 });
	});

	it('replaces arrays and scalars instead of merging them', () => {
		expect(
			mergeOptionTrees({ zne: { noise_factors: [1, 2] } }, { zne: { noise_factors: [1, 3, 5] } }),
		).toEqual({ zne: { noise_factors: [1, 3, 5] } });
		expect(mergeOptionTrees({ resilience: 'x' }, { resilience: { zne_mitigation: true } })).toEqual(
			{
				resilience: { zne_mitigation: true },
			},
		);
		expect(mergeOptionTrees({ resilience: { a: 1 } }, { resilience: 5 })).toEqual({
			resilience: 5,
		});
	});

	it('leaves the base untouched', () => {
		const base = { twirling: { strategy: 'active' } };
		mergeOptionTrees(base, { twirling: { strategy: 'all' }, default_shots: 2 });
		expect(base).toEqual({ twirling: { strategy: 'active' } });
	});
});

describe('mergePrimitiveOptions with dedicated fields', () => {
	it('applies the toggles on top of the merged fields', () => {
		expect(
			mergePrimitiveOptions({ twirling: { num_randomizations: 8 } }, true, true, false, {
				twirling: { strategy: 'all' },
				dynamical_decoupling: { sequence_type: 'XY4' },
			}),
		).toEqual({
			twirling: { num_randomizations: 8, strategy: 'all', enable_gates: true },
			dynamical_decoupling: { sequence_type: 'XY4', enable: true },
		});
	});

	it('is unchanged when fields are omitted', () => {
		const base = { default_shots: 4096 };
		expect(mergePrimitiveOptions(base, true, false, true)).toEqual(
			mergePrimitiveOptions(base, true, false, true, {}),
		);
	});
});

describe('requireBoundedNumberOrAuto', () => {
	const node = fakeNode();
	const BOUNDS = { min: 1, max: INT32_MAX, integer: true };
	const read = (value: unknown) =>
		requireBoundedNumberOrAuto(value, 'Number of Randomizations', BOUNDS, node, 0);

	it('returns undefined only for a value that is not there and for text left empty', () => {
		expect(read('')).toBeUndefined();
		expect(read('   ')).toBeUndefined();
		expect(read(undefined)).toBeUndefined();
	});

	it.each([[true], [false], [{}], [[]], [[32]], [null]])(
		'refuses %o instead of dropping the key',
		(given) => {
			expect(() => read(given)).toThrow(
				/Number of Randomizations must be "auto" or an integer between 1 and 2147483647/,
			);
		},
	);

	it('accepts auto in any case', () => {
		expect(read('auto')).toBe('auto');
		expect(read('AUTO')).toBe('auto');
		expect(read(' Auto ')).toBe('auto');
	});

	it('accepts a whole number as text or number', () => {
		expect(read('64')).toBe(64);
		expect(read(64)).toBe(64);
	});

	it('names auto in the error for text that is not a number', () => {
		expect(() => read('many')).toThrow(/must be "auto" or an integer between 1 and 2147483647/);
	});

	it.each([[0], [1.5], [INT32_MAX + 1]])(
		'falls back to the plain bounds message for %s',
		(given) => {
			expect(() => read(given)).toThrow(/must be an integer between 1 and 2147483647/);
			expect(() => read(given)).not.toThrow(/auto/);
		},
	);
});

describe('optionalBoolean and requireBoolean', () => {
	const node = fakeNode();
	const read = (value: unknown) => optionalBoolean(value, 'Private', node, 0);

	it('returns the boolean itself', () => {
		expect(read(true)).toBe(true);
		expect(read(false)).toBe(false);
	});

	it.each([[undefined], [null], [''], ['   ']])(
		'returns undefined for %o, so the caller keeps the field default',
		(given) => {
			expect(read(given)).toBeUndefined();
			expect(requireBoolean(given, 'Private', true, node, 0)).toBe(true);
			expect(requireBoolean(given, 'Private', false, node, 0)).toBe(false);
		},
	);

	it.each([['true'], ['TRUE'], [' True '], ['1'], [1], ['1.0']])('reads %o as on', (given) => {
		expect(read(given)).toBe(true);
		expect(requireBoolean(given, 'Private', false, node, 0)).toBe(true);
	});

	it.each([['false'], ['FALSE'], [' False '], ['0'], [0], ['-0']])('reads %o as off', (given) => {
		expect(read(given)).toBe(false);
		expect(requireBoolean(given, 'Private', true, node, 0)).toBe(false);
	});

	it.each([['yes'], ['no'], ['on'], ['off'], [2], [-1], [[]], [['true']], [{}], [NaN]])(
		'refuses %o rather than guessing which way it points',
		(given) => {
			expect(() => read(given)).toThrow(
				'Private must be true or false. An expression may also hand over "true", "false", 1 or 0.',
			);
			expect(() => requireBoolean(given, 'Private', false, node, 0)).toThrow(
				'Private must be true or false.',
			);
		},
	);
});

describe('twirlingFieldOptions', () => {
	const node = fakeNode();

	it('maps every entry to its spec key', () => {
		expect(
			twirlingFieldOptions(
				{ numRandomizations: '32', shotsPerRandomization: 'auto', strategy: 'all' },
				node,
				0,
			),
		).toEqual({ num_randomizations: 32, shots_per_randomization: 'auto', strategy: 'all' });
	});

	it('adds nothing for an empty collection or a non-string strategy', () => {
		expect(twirlingFieldOptions({}, node, 0)).toEqual({});
		expect(twirlingFieldOptions({ strategy: 5 }, node, 0)).toEqual({});
	});
});

describe('dynamicalDecouplingFieldOptions', () => {
	const node = fakeNode();

	it('maps the four entries', () => {
		expect(
			dynamicalDecouplingFieldOptions(
				{
					sequenceType: 'XY4',
					extraSlackDistribution: 'edges',
					schedulingMethod: 'asap',
					skipResetQubits: false,
				},
				node,
				0,
			),
		).toEqual({
			sequence_type: 'XY4',
			extra_slack_distribution: 'edges',
			scheduling_method: 'asap',
			skip_reset_qubits: false,
		});
	});

	it('reads a flag that arrived as text rather than dropping the entry', () => {
		expect(dynamicalDecouplingFieldOptions({ skipResetQubits: 'true' }, node, 0)).toEqual({
			skip_reset_qubits: true,
		});
		expect(dynamicalDecouplingFieldOptions({ skipResetQubits: 'false' }, node, 0)).toEqual({
			skip_reset_qubits: false,
		});
		expect(dynamicalDecouplingFieldOptions({}, node, 0)).toEqual({});
		expect(() => dynamicalDecouplingFieldOptions({ skipResetQubits: 'x' }, node, 0)).toThrow(
			'Skip Reset Qubits must be true or false.',
		);
	});
});

describe('executionFieldOptions', () => {
	const node = fakeNode();
	const RAW = { initQubits: false, repDelay: 0.00025, measType: 'kerneled' };

	it('maps init_qubits, rep_delay and meas_type for the sampler', () => {
		expect(executionFieldOptions(RAW, 'sampler', node, 0)).toEqual({
			init_qubits: false,
			rep_delay: 0.00025,
			meas_type: 'kerneled',
		});
	});

	it('drops meas_type for the estimator', () => {
		expect(executionFieldOptions(RAW, 'estimator', node, 0)).toEqual({
			init_qubits: false,
			rep_delay: 0.00025,
		});
	});

	it.each([[''], [-1]])(
		'refuses a repetition delay that is not a number of at least 0: %s',
		(given) => {
			expect(() => executionFieldOptions({ repDelay: given }, 'sampler', node, 0)).toThrow(
				/Repetition Delay \(Seconds\) must be a number at least 0/,
			);
		},
	);
});

describe('resilienceFieldOptions', () => {
	const node = fakeNode();
	const read = (raw: Record<string, unknown>) => resilienceFieldOptions(raw, node, 0);

	it('maps the flags and the ZNE block', () => {
		expect(
			read({
				measureMitigation: true,
				zneMitigation: true,
				zneNoiseFactors: '1, 3, 5',
				zneExtrapolator: ['exponential', 'linear'],
				zneAmplifier: 'pea',
			}),
		).toEqual({
			measure_mitigation: true,
			zne_mitigation: true,
			zne: {
				noise_factors: [1, 3, 5],
				extrapolator: ['exponential', 'linear'],
				amplifier: 'pea',
			},
		});
	});

	it('accepts the extrapolator as a single string or a comma list', () => {
		expect(read({ zneExtrapolator: 'linear' })).toEqual({ zne: { extrapolator: ['linear'] } });
		expect(read({ zneExtrapolator: 'exponential, linear' })).toEqual({
			zne: { extrapolator: ['exponential', 'linear'] },
		});
	});

	it('maps the PEC block and spells a zero overhead as null', () => {
		expect(read({ pecMitigation: true, pecMaxOverhead: 0, pecNoiseGain: '1.5' })).toEqual({
			pec_mitigation: true,
			pec: { max_overhead: null, noise_gain: 1.5 },
		});
		expect(read({ pecMaxOverhead: 100, pecNoiseGain: 'auto' })).toEqual({
			pec: { max_overhead: 100, noise_gain: 'auto' },
		});
	});

	it('maps the layer noise learning counts and drops the zeros', () => {
		expect(
			read({
				noiseLearningMaxLayers: 4,
				noiseLearningRandomizations: 0,
				noiseLearningShotsPerRandomization: '128',
				noiseLearningLayerPairDepths: '0, 1, 2, 4',
			}),
		).toEqual({
			layer_noise_learning: {
				max_layers_to_learn: 4,
				shots_per_randomization: 128,
				layer_pair_depths: [0, 1, 2, 4],
			},
		});
	});

	it('adds no block when every entry of it is empty', () => {
		expect(read({})).toEqual({});
		expect(read({ zneExtrapolator: [], zneNoiseFactors: '', pecNoiseGain: '' })).toEqual({});
	});

	it('refuses noise factors that are not finite numbers', () => {
		// parseNumberListStrict quotes the entry as written, spaces included, so the input here has
		// none: the message is the parser's, unchanged by this item.
		expect(() => read({ zneNoiseFactors: '1,x' })).toThrow(
			/ZNE Noise Factors: "x" is not a valid number/,
		);
		expect(() => read({ zneNoiseFactors: '1, Infinity' })).toThrow(
			/ZNE Noise Factors must be finite numbers; got Infinity/,
		);
	});

	it('refuses fractional layer pair depths', () => {
		expect(() => read({ noiseLearningLayerPairDepths: '0, 1.5' })).toThrow(
			/Noise Learning Layer Pair Depths must be whole numbers; got 1.5/,
		);
	});

	it('refuses a max overhead or noise gain below zero', () => {
		expect(() => read({ pecMaxOverhead: -1 })).toThrow(
			/PEC Max Overhead must be a number at least 0/,
		);
		expect(() => read({ pecNoiseGain: 'lots' })).toThrow(
			/PEC Noise Gain must be "auto" or a number at least 0/,
		);
	});
});
