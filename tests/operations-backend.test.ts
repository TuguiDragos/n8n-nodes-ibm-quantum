import { describe, expect, it } from 'vitest';

import { handleBackend, processorTypeOf, RANK_METRICS } from '../nodes/IbmQuantum/operations';
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

	// IBM marks is_simulator deprecated and will remove it. A device without the field must be kept
	// whatever the toggle says, so the operation keeps working the day the field disappears.
	it('keeps a device that carries no is_simulator field, whichever way the toggle is set', async () => {
		const devices = [
			{ name: 'ibm_q1', status: { name: 'online' }, queue_length: 1, qubits: 156 },
			online('ibm_q4', 4, 156),
		];
		const excluded = await leastBusy({ minQubits: 0, includeSimulators: false }, devices);
		const included = await leastBusy({ minQubits: 0, includeSimulators: true }, devices);
		expect(excluded.leastBusy).toBe('ibm_q1');
		expect(included).toEqual(excluded);
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

	// IBM declares `qubits` nullable and leaves it out of the required device fields, and the shape
	// llms-full.txt documents asks the reader to test these keys for null. A key holding `undefined`
	// is gone by the time n8n has serialised the item, so the round trip is part of the assertion.
	it('reports a missing qubit count and an unreadable name as null rather than dropping the key', async () => {
		const result = await leastBusy({ minQubits: 0, includeSimulators: false }, [
			{ status: { name: 'online' } },
		]);
		expect(JSON.parse(JSON.stringify(result))).toEqual({
			leastBusy: null,
			queueLength: null,
			waitTimeSeconds: null,
			candidates: [
				{
					name: null,
					queueLength: null,
					qubits: null,
					status: 'online',
					family: null,
					revision: null,
					waitTimeSeconds: null,
				},
			],
		});
	});

	it('returns nulls when no candidate qualifies', async () => {
		const result = await leastBusy({ minQubits: 0, includeSimulators: false }, [
			{ name: 'ibm_offline', status: { name: 'offline' }, queue_length: 1, qubits: 127 },
		]);
		expect(result.leastBusy).toBeNull();
		expect(result.queueLength).toBeNull();
	});

	it('survives a body whose devices key is not an array', async () => {
		const result = await leastBusy(
			{ minQubits: 0, includeSimulators: false },
			'nope' as unknown as Device[],
		);
		expect(result.leastBusy).toBeNull();
		expect(result.candidates).toEqual([]);
	});

	it('skips a null entry in the listing instead of throwing on it', async () => {
		const result = await leastBusy({ minQubits: 0, includeSimulators: false }, [
			null,
			online('ibm_q2', 2, 127),
		] as unknown as Device[]);
		expect(result.leastBusy).toBe('ibm_q2');
		expect((result.candidates as Device[]).map((d) => d.name)).toEqual(['ibm_q2']);
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
		['getDefaults', 'defaults'],
		['getProperties', 'properties'],
		['getStatus', 'status'],
	])('routes %s to the matching /backends/:name endpoint', async (operation, suffix) => {
		const { ctx, requests } = makeExecuteContext({
			params: { backendName: 'ibm_fez' },
			http: () => ({}),
		});
		await handleBackend.call(ctx, TEST_CTX, operation, 0);
		const call = requests[0] as HttpCall;
		expect(call.method).toBe('GET');
		expect(call.url).toBe(`${TEST_CTX.baseUrl}/backends/ibm_fez/${suffix}`);
	});

	it('rejects an unknown operation instead of requesting /backends/:name/undefined', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { backendName: 'ibm_fez' },
			http: () => ({}),
		});
		await expect(handleBackend.call(ctx, TEST_CTX, 'getCalibration', 0)).rejects.toThrow(
			/Unsupported backend operation: getCalibration/,
		);
		expect(requests).toHaveLength(0);
	});
});

describe('calibration_id and updated_before on the backend reads', () => {
	const read = (
		operation: string,
		params: Record<string, unknown> = {},
		http: () => unknown = () => ({}),
	) => {
		const { ctx, requests } = makeExecuteContext({
			params: { backendName: 'ibm_fez', ...params },
			http,
		});
		return {
			result: handleBackend.call(ctx, TEST_CTX, operation, 0),
			requests: requests as HttpCall[],
		};
	};

	it.each([
		['getConfiguration', 'configuration'],
		['getProperties', 'properties'],
	])('sends calibration_id as a query parameter on %s', async (operation, suffix) => {
		const { result, requests } = read(operation, { calibrationId: 'cal-1' });
		await result;
		expect(requests[0].qs).toEqual({ calibration_id: 'cal-1' });
		expect(requests[0].url).toBe(`${TEST_CTX.baseUrl}/backends/ibm_fez/${suffix}`);
	});

	it('sends updated_before on Get Properties, trimmed', async () => {
		const { result, requests } = read('getProperties', {
			updatedBefore: ' 2026-09-01T00:00:00Z ',
		});
		await result;
		expect(requests[0].qs).toEqual({ updated_before: '2026-09-01T00:00:00Z' });
	});

	it('sends both together', async () => {
		const { result, requests } = read('getProperties', {
			calibrationId: 'cal-1',
			updatedBefore: '2026-09-01T00:00:00Z',
		});
		await result;
		expect(requests[0].qs).toEqual({
			calibration_id: 'cal-1',
			updated_before: '2026-09-01T00:00:00Z',
		});
	});

	it.each([['getConfiguration'], ['getProperties']])(
		'sends no query string on %s when neither field is set',
		async (operation) => {
			const { result, requests } = read(operation);
			await result;
			expect(requests[0].qs).toBeUndefined();
		},
	);

	it.each([['getDefaults'], ['getStatus']])(
		'ignores both fields on %s, which take neither',
		async (operation) => {
			const { result, requests } = read(operation, {
				calibrationId: 'cal-1',
				updatedBefore: '2026-09-01T00:00:00Z',
			});
			await result;
			expect(requests[0].qs).toBeUndefined();
		},
	);

	it('coerces a numeric calibration ID to text and trims a padded one', async () => {
		const numeric = read('getProperties', { calibrationId: 12345 });
		await numeric.result;
		expect(numeric.requests[0].qs).toEqual({ calibration_id: '12345' });

		const padded = read('getProperties', { calibrationId: '  cal-1 ' });
		await padded.result;
		expect(padded.requests[0].qs).toEqual({ calibration_id: 'cal-1' });
	});

	it.each([[''], ['   '], [null], [{}], [[]]])('omits calibration_id for %s', async (given) => {
		const { result, requests } = read('getConfiguration', { calibrationId: given });
		await result;
		expect(requests[0].qs).toBeUndefined();
	});

	// JSON Schema maxLength counts characters, so 100 emoji are 100, not 200 UTF-16 units.
	it('accepts a calibration ID of exactly 100 characters, counted in code points', async () => {
		for (const value of ['a'.repeat(100), '\u{1F600}'.repeat(100)]) {
			const { result, requests } = read('getProperties', { calibrationId: value });
			await result;
			expect(requests[0].qs).toEqual({ calibration_id: value });
		}
	});

	it('refuses a calibration ID of 101 characters before the request', async () => {
		const { result, requests } = read('getProperties', { calibrationId: 'c'.repeat(101) });
		await expect(result).rejects.toThrow(
			/Calibration ID is 101 characters; IBM accepts at most 100\./,
		);
		expect(requests).toHaveLength(0);
	});

	it.each([['   '], [null]])('omits updated_before for %s', async (given) => {
		const { result, requests } = read('getProperties', { updatedBefore: given });
		await result;
		expect(requests[0].qs).toBeUndefined();
	});

	it.each([['yesterday'], [1725000000000], [{}], [true]])(
		'refuses an Updated Before that is not a date: %s',
		async (given) => {
			const { result, requests } = read('getProperties', { updatedBefore: given });
			await expect(result).rejects.toThrow(
				/Updated Before must be a date and time, for example 2026-09-01T00:00:00Z\./,
			);
			expect(requests).toHaveLength(0);
		},
	);

	it('names the calibration in the hint when a 404 comes back with one set', async () => {
		const { result } = read('getProperties', { calibrationId: 'cal-1' }, () => {
			throw Object.assign(new Error('Request failed with status code 404'), {
				httpCode: '404',
				context: { data: { errors: [{ code: 'not_found', message: 'device not found' }] } },
			});
		});
		await expect(result).rejects.toThrow(
			/Backend "ibm_fez": device not found\. Check the name against Backend > Get Many, and that calibration "cal-1" belongs to it\./,
		);
	});
});

function leastBusyWithRequests(params: Record<string, unknown>, devices: Device[]) {
	const { ctx, requests } = makeExecuteContext({ params, http: () => ({ devices }) });
	const result = handleBackend.call(ctx, TEST_CTX, 'getLeastBusy', 0) as Promise<
		Record<string, unknown>
	>;
	return { result, requests };
}

const heron = (name: string, queue: number, wait: unknown, revision = '2'): Device => ({
	...online(name, queue, 156),
	processor_type: { family: 'Heron', revision },
	wait_time_seconds: wait,
});

describe('getLeastBusy ranks by estimated wait and filters by family (T-17)', () => {
	it('asks the listing for wait_time_seconds', async () => {
		const { result, requests } = leastBusyWithRequests({ minQubits: 0 }, [
			heron('ibm_a', 1, { average: 10, p50: 8, p95: 30 }),
		]);
		await result;
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			method: 'GET',
			url: `${TEST_CTX.baseUrl}/backends`,
			qs: { fields: 'wait_time_seconds' },
		});
	});

	it('keeps ranking by queue length by default and reports the wait beside it', async () => {
		const result = await leastBusy({ minQubits: 0 }, [
			heron('ibm_slow', 1, { average: 900, p50: 800, p95: 2000 }),
			heron('ibm_fast', 4, { average: 60, p50: 50, p95: 120 }),
		]);
		expect(result.leastBusy).toBe('ibm_slow');
		expect(result.queueLength).toBe(1);
		expect(result.waitTimeSeconds).toEqual({ average: 900, p50: 800, p95: 2000 });
		expect((result.candidates as Device[])[0]).toMatchObject({
			name: 'ibm_slow',
			family: 'Heron',
			revision: '2',
			waitTimeSeconds: { average: 900, p50: 800, p95: 2000 },
		});
	});

	// Queue length alone would pick ibm_c (queue 1); each wait metric picks a different device.
	const FLEET = [
		heron('ibm_a', 3, { average: 100, p50: 10, p95: 40 }),
		heron('ibm_b', 2, { average: 50, p50: 60, p95: 500 }),
		heron('ibm_c', 1, { average: 70, p50: 80, p95: 90 }),
	];

	it.each([
		['waitAverage', 'ibm_b'],
		['waitP50', 'ibm_a'],
		['waitP95', 'ibm_a'],
		['queueLength', 'ibm_c'],
	])('ranks by %s', async (rankBy, expected) => {
		const result = await leastBusy({ minQubits: 0, rankBy }, FLEET);
		expect(result.leastBusy).toBe(expected);
	});

	it('sorts a device without a wait figure last and reports it as null', async () => {
		const result = await leastBusy({ minQubits: 0, rankBy: 'waitP50' }, [
			online('ibm_nowait', 0, 156),
			heron('ibm_wait', 9, { average: 10, p50: 7, p95: 20 }),
		]);
		expect(result.leastBusy).toBe('ibm_wait');
		expect((result.candidates as Device[])[1]).toMatchObject({
			name: 'ibm_nowait',
			waitTimeSeconds: null,
			family: null,
			revision: null,
		});
	});

	it('breaks a wait tie by queue length, unknown queue last', async () => {
		const tied = { average: 1, p50: 1, p95: 30 };
		const result = await leastBusy({ minQubits: 0, rankBy: 'waitP95' }, [
			{ ...heron('ibm_noqueue', 0, tied), queue_length: null },
			heron('ibm_long', 9, tied),
			heron('ibm_short', 2, tied),
		]);
		expect((result.candidates as Device[]).map((d) => d.name)).toEqual([
			'ibm_short',
			'ibm_long',
			'ibm_noqueue',
		]);
	});

	it('falls back to the queue when no device carries the chosen figure', async () => {
		const result = await leastBusy({ minQubits: 0, rankBy: 'waitAverage' }, [
			online('ibm_q5', 5, 156),
			online('ibm_q2', 2, 156),
		]);
		expect(result.leastBusy).toBe('ibm_q2');
		expect(result.waitTimeSeconds).toBeNull();
	});

	it('reads a partial wait object field by field and ignores a wait that is not an object', async () => {
		const result = await leastBusy({ minQubits: 0, rankBy: 'waitP50' }, [
			heron('ibm_partial', 1, { average: 5, p50: 'soon', p95: null }),
			heron('ibm_list', 1, [1, 2, 3]),
			heron('ibm_text', 1, '42'),
			heron('ibm_full', 8, { average: 9, p50: 7, p95: 20 }),
		]);
		expect(result.leastBusy).toBe('ibm_full');
		const byName = Object.fromEntries(
			(result.candidates as Device[]).map((d) => [d.name, d.waitTimeSeconds]),
		);
		expect(byName.ibm_partial).toEqual({ average: 5, p50: null, p95: null });
		expect(byName.ibm_list).toBeNull();
		expect(byName.ibm_text).toBeNull();
	});

	it.each([['toString'], [['waitP50']], ['queue_length'], [42]])(
		'rejects a Rank By of %s before any request',
		async (rankBy) => {
			const { result, requests } = leastBusyWithRequests({ minQubits: 0, rankBy }, FLEET);
			await expect(result).rejects.toThrow(
				/Rank By must be one of queueLength, waitAverage, waitP50, waitP95\./,
			);
			expect(requests).toHaveLength(0);
		},
	);

	// An options value that arrives empty from an expression keeps the default, the rule this
	// release applies to every options and boolean field.
	it.each([[undefined], [null], [''], ['   ']])(
		'keeps the default ranking for a Rank By of %s',
		async (rankBy) => {
			const result = await leastBusy({ minQubits: 0, rankBy }, FLEET);
			expect(result.leastBusy).toBe('ibm_c');
		},
	);

	it('accepts a Rank By value with surrounding whitespace', async () => {
		const result = await leastBusy({ minQubits: 0, rankBy: ' waitAverage ' }, FLEET);
		expect(result.leastBusy).toBe('ibm_b');
	});

	it('filters by processor family case-insensitively and trims the input', async () => {
		const result = await leastBusy({ minQubits: 0, processorFamily: ' heron ' }, [
			{ ...online('ibm_miami', 0, 120), processor_type: { family: 'Nighthawk', revision: '1' } },
			heron('ibm_fez', 7, { average: 10, p50: 8, p95: 30 }),
			heron('ibm_boston', 3, { average: 10, p50: 8, p95: 30 }, '3'),
		]);
		expect(result.leastBusy).toBe('ibm_boston');
		expect((result.candidates as Device[]).map((d) => d.name)).toEqual(['ibm_boston', 'ibm_fez']);
	});

	it('drops a device that reports no family when a family is required', async () => {
		const result = await leastBusy({ minQubits: 0, processorFamily: 'Heron' }, [
			online('ibm_unknown', 0, 156),
			{ ...online('ibm_norev', 0, 156), processor_type: { revision: '2' } },
			{ ...online('ibm_text', 0, 156), processor_type: 'Heron' },
			heron('ibm_fez', 7, null),
		]);
		expect(result.leastBusy).toBe('ibm_fez');
		expect(result.candidates).toHaveLength(1);
	});

	it.each([[undefined], [null], [''], ['   ']])(
		'leaves the family filter off for %s',
		async (processorFamily) => {
			const result = await leastBusy({ minQubits: 0, processorFamily }, [
				{ ...online('ibm_miami', 0, 120), processor_type: { family: 'Nighthawk', revision: '1' } },
				heron('ibm_fez', 7, null),
			]);
			expect(result.leastBusy).toBe('ibm_miami');
		},
	);

	it.each([[['Heron']], [true], [{ family: 'Heron' }]])(
		'rejects a Processor Family of %s instead of dropping the filter',
		async (processorFamily) => {
			const { result, requests } = leastBusyWithRequests({ minQubits: 0, processorFamily }, FLEET);
			await expect(result).rejects.toThrow(
				/Processor Family must be text such as Heron or Nighthawk, or empty for any family\./,
			);
			expect(requests).toHaveLength(0);
		},
	);

	it('compares a numeric Processor Family as text', async () => {
		const result = await leastBusy({ minQubits: 0, processorFamily: 42 }, FLEET);
		expect(result.leastBusy).toBeNull();
		expect(result.candidates).toEqual([]);
	});

	it('reports family and revision on every candidate, null when IBM omits them', async () => {
		const result = await leastBusy({ minQubits: 0 }, [
			{ ...online('ibm_a', 0, 156), processor_type: { family: ' Nighthawk ' } },
			heron('ibm_b', 1, null),
			online('ibm_c', 2, 156),
		]);
		expect((result.candidates as Device[]).map((d) => [d.family, d.revision])).toEqual([
			['Nighthawk', null],
			['Heron', '2'],
			[null, null],
		]);
	});
});

describe('processorTypeOf', () => {
	it('returns nulls for anything that is not an object with text fields', () => {
		for (const processor_type of [
			undefined,
			null,
			'Heron',
			['Heron'],
			7,
			{ family: '', revision: ' ' },
		]) {
			expect(processorTypeOf({ processor_type })).toEqual({ family: null, revision: null });
		}
	});

	it('accepts a numeric revision as text', () => {
		expect(processorTypeOf({ processor_type: { family: 'Heron', revision: 3 } })).toEqual({
			family: 'Heron',
			revision: '3',
		});
	});

	it('names exactly the metrics the Rank By dropdown offers', () => {
		expect(Object.keys(RANK_METRICS).sort()).toEqual([
			'queueLength',
			'waitAverage',
			'waitP50',
			'waitP95',
		]);
	});
});
