import { NodeApiError, NodeOperationError, type INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { IbmQuantum } from '../nodes/IbmQuantum/IbmQuantum.node';
import {
	extractJobStatus,
	handleCircuitBuild,
	handleJob,
	isZlibBase64,
	mergePrimitiveOptions,
} from '../nodes/IbmQuantum/operations';
import { parseResults, parseSamplerPub } from '../nodes/IbmQuantum/results';
import { asNodeError, errorMessage } from '../nodes/IbmQuantum/transport';
import { fakeNode, makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

// These paths exist because a catch binding is `unknown` and because n8n hands parameters back
// untyped. They are cheap to get wrong and impossible to notice, so each one is pinned here.

describe('errorMessage', () => {
	it('reads the message off an Error', () => {
		expect(errorMessage(new Error('circuit rejected'))).toBe('circuit rejected');
	});

	it('stringifies anything else, so a thrown non-Error still reads sensibly', () => {
		expect(errorMessage('plain string')).toBe('plain string');
		expect(errorMessage(404)).toBe('404');
		expect(errorMessage(null)).toBe('null');
	});
});

describe('asNodeError', () => {
	const node = fakeNode();

	it('passes an n8n error through untouched, keeping its message and description', () => {
		const original = new NodeApiError(node, { message: 'IBM says no' } as never);
		expect(asNodeError(node, original)).toBe(original);

		const operational = new NodeOperationError(node, 'bad gate');
		expect(asNodeError(node, operational)).toBe(operational);
	});

	it('wraps a raw throw so the user sees a node error rather than an exception', () => {
		const wrapped = asNodeError(node, { message: 'socket hang up' }, 2);
		expect(wrapped).toBeInstanceOf(NodeApiError);
		expect(wrapped).not.toBeInstanceOf(NodeOperationError);
	});

	it('wraps without an item index too, for the callers that have none', () => {
		// The polling triggers run one item at a time and have no index to attach.
		expect(asNodeError(node, { message: 'socket hang up' })).toBeInstanceOf(NodeApiError);
	});
});

describe('parseSamplerPub without a usable register', () => {
	it('reports zero shots instead of throwing when no register carries samples', () => {
		expect(parseSamplerPub({ c: { num_bits: 2 } })).toEqual({
			register: null,
			counts: {},
			shots: 0,
		});
	});

	// Returning another register's counts under the requested name is worse than failing, so a pub
	// that lacks the requested register reads its own but says so. The error for a name no pub
	// carries is raised by parseResults, which is the only caller that sees every pub.
	it('marks a fallback rather than passing another register off as the requested one', () => {
		const data = { empty: { num_bits: 2 }, c: { num_bits: 1, samples: ['0x1'] } };
		expect(parseSamplerPub(data, 'empty')).toMatchObject({
			register: 'c',
			requestedRegister: 'empty',
			registerFallback: true,
		});
	});

	it('reports zero shots when the pub carries no register with samples at all', () => {
		expect(parseSamplerPub({ empty: { num_bits: 2 } }, 'c')).toEqual({
			register: null,
			counts: {},
			shots: 0,
		});
	});

	it('still auto-selects when no register was requested', () => {
		const data = { empty: { num_bits: 2 }, c: { num_bits: 1, samples: ['0x1'] } };
		expect(parseSamplerPub(data)).toMatchObject({ register: 'c', shots: 1 });
	});

	it('uses the requested register when it does carry samples', () => {
		const data = {
			meas: { num_bits: 2, samples: ['0x1'] },
			syndrome: { num_bits: 3, samples: ['0x5', '0x5'] },
		};
		expect(parseSamplerPub(data, 'syndrome')).toMatchObject({
			register: 'syndrome',
			shots: 2,
			counts: { '101': 2 },
		});
	});
});

describe('extractJobStatus on partial job bodies', () => {
	it('ignores a state object whose status is not a string', () => {
		expect(extractJobStatus({ state: { status: 42 } })).toBe('');
		expect(extractJobStatus({ state: { status: 42 }, status: 'Completed' })).toBe('completed');
	});

	it('still reads a bare string state and a top level status', () => {
		expect(extractJobStatus({ state: 'Running' })).toBe('running');
		expect(extractJobStatus({ status: 'Failed' })).toBe('failed');
		expect(extractJobStatus({})).toBe('');
	});
});

describe('mergePrimitiveOptions with one twirling flag at a time', () => {
	it('enables measurement twirling without touching gate twirling', () => {
		expect(mergePrimitiveOptions({}, false, false, true)).toEqual({
			twirling: { enable_measure: true },
		});
	});

	it('enables gate twirling on its own', () => {
		expect(mergePrimitiveOptions({}, false, true, false)).toEqual({
			twirling: { enable_gates: true },
		});
	});

	it('leaves options alone when every flag is off', () => {
		expect(mergePrimitiveOptions({}, false, false, false)).toEqual({});
	});
});

describe('submit with parameters n8n did not resolve to a string or object', () => {
	const QASM = 'OPENQASM 3.0;\nqubit[1] q;';

	it('treats a scalar binding as no bindings rather than sending it', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_fez', qasm3: QASM, parameters: 42, shots: 8 },
			http: () => ({ id: 'j1' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitSampler', 0);
		const params = (requests[0].body as Record<string, unknown>).params as Record<string, unknown>;
		expect(params.pubs).toEqual([[QASM, null, 8]]);
	});

	it('treats a missing circuit as empty and fails the local guard', async () => {
		// getNodeParameter returns undefined when a required field was never filled in, which must
		// reach the OpenQASM check as an empty string rather than throwing on the cast.
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_fez', qasm3: undefined },
			http: () => ({ id: 'j1' }),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
			/does not start with an OpenQASM 3 version header/,
		);
		expect(requests).toHaveLength(0);
	});

	it('accepts an observable that is not a Pauli container without inventing terms', async () => {
		// collectPauliTerms walks strings, arrays and objects; a number matches none of them and is
		// left for IBM to reject, rather than being reported as a malformed Pauli string.
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_fez', qasm3: QASM, observables: '7' },
			http: () => ({ id: 'j2' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitEstimator', 0);
		const params = (requests[0].body as Record<string, unknown>).params as Record<string, unknown>;
		expect(params.pubs).toEqual([[QASM, 7]]);
	});
});

describe('node identity used by the helpers', () => {
	it('builds a node stub the error helpers accept', () => {
		const node: INode = fakeNode(2);
		expect(node.typeVersion).toBe(2);
	});
});

describe('an empty response body never reaches n8n as null', () => {
	// Found on live hardware: IBM answers GET /backends/{id}/defaults with no content for some
	// devices. The node used to pass that straight through as `json: null`, and n8n's execution
	// engine reads `json.$error` off every result without a null check, so a single empty body
	// failed the whole run with "Cannot read properties of null".
	const runBackend = (respond: () => unknown) => {
		const requests: HttpCall[] = [];
		const all: Record<string, unknown> = {
			resource: 'backend',
			operation: 'getDefaults',
			backendName: 'ibm_marrakesh',
		};
		const ctx = {
			getInputData: () => [{ json: {} }],
			getNode: () => fakeNode(2),
			continueOnFail: () => false,
			logger: { warn: () => {} },
			getCredentials: async () => ({ region: 'us-east', apiVersion: '2026-04-15' }),
			getNodeParameter: (name: string, _i?: number, fallback?: unknown) =>
				name in all ? all[name] : fallback,
			helpers: {
				httpRequestWithAuthentication: async (_n: string, o: HttpCall) => {
					requests.push(o);
					return respond();
				},
			},
		};
		return new IbmQuantum().execute.call(ctx as never);
	};

	it.each([
		['null', () => null],
		['undefined', () => undefined],
	])('turns a %s body into an empty object', async (_label, respond) => {
		const result = await runBackend(respond);
		expect(result[0]).toHaveLength(1);
		expect(result[0][0].json).toEqual({});
		expect(result[0][0].json).not.toBeNull();
	});

	it('leaves a real body untouched', async () => {
		const result = await runBackend(() => ({ rz: 0.1 }));
		expect(result[0][0].json).toEqual({ rz: 0.1 });
	});
});

describe('isZlibBase64', () => {
	// A zlib stream opens with 0x78 and a two byte header that is a multiple of 31. The guard reads
	// only the first four base64 characters, so every rejection path needs its own case.
	it('accepts each compression level zlib emits', () => {
		for (const second of [0x01, 0x5e, 0x9c, 0xda]) {
			expect(isZlibBase64(Buffer.from([0x78, second, 0, 0]).toString('base64'))).toBe(true);
		}
	});

	it('rejects a string too short to carry a header', () => {
		expect(isZlibBase64('')).toBe(false);
		expect(isZlibBase64('eJ')).toBe(false);
	});

	it('rejects a first byte that is not 0x78', () => {
		expect(isZlibBase64(Buffer.from([0x51, 0x49, 0x53, 0x4b]).toString('base64'))).toBe(false);
	});

	it('rejects a header whose checksum does not divide by 31', () => {
		expect(isZlibBase64(Buffer.from([0x78, 0x00, 0, 0]).toString('base64'))).toBe(false);
	});
});

// A job can hold several pubs, and different circuits can name their classical registers
// differently. The node itself submits one pub, but Get Results reads any job, including one
// submitted from Qiskit.
describe('a requested register across several pubs', () => {
	const twoPubs = {
		results: [
			{ data: { meas: { samples: ['0x1'], num_bits: 1 } }, metadata: {} },
			{ data: { syndrome: { samples: ['0x3'], num_bits: 2 } }, metadata: {} },
		],
	};

	it('reads the requested register where it exists and falls back where it does not', () => {
		const parsed = parseResults(twoPubs, 'meas');
		const pubs = parsed.pubs as Array<Record<string, unknown>>;
		expect(pubs[0].register).toBe('meas');
		expect(pubs[0]).not.toHaveProperty('registerFallback');
		expect(pubs[1].register).toBe('syndrome');
		expect(pubs[1].registerFallback).toBe(true);
		expect(pubs[1].requestedRegister).toBe('meas');
	});

	it('raises only when no pub carries the register, listing all of them', () => {
		expect(() => parseResults(twoPubs, 'nope')).toThrow(
			/Register "nope" is not in this result\. Available: meas, syndrome\./,
		);
	});

	it('still raises for a single pub that does not carry it', () => {
		expect(() => parseResults({ results: [twoPubs.results[0]] }, 'syndrome')).toThrow(
			/Available: meas\./,
		);
	});

	it('leaves the output untouched when no register is requested', () => {
		const pubs = parseResults(twoPubs).pubs as Array<Record<string, unknown>>;
		expect(pubs.map((p) => p.register)).toEqual(['meas', 'syndrome']);
		expect(pubs[0]).not.toHaveProperty('registerFallback');
		expect(pubs[1]).not.toHaveProperty('registerFallback');
	});

	// A pub with no data key at all must not break the scan that collects the register names.
	it('skips a pub that carries no data while scanning for the register', () => {
		const mixed = { results: [{ metadata: {} }, twoPubs.results[0]] };
		const pubs = parseResults(mixed, 'meas').pubs as Array<Record<string, unknown>>;
		expect(pubs).toHaveLength(2);
		expect(pubs[1].register).toBe('meas');
	});

	it('ignores a register name on an estimator-only result', () => {
		const parsed = parseResults({ results: [{ data: { evs: 1 }, metadata: {} }] }, 'meas');
		expect((parsed.pubs as Array<Record<string, unknown>>)[0].type).toBe('estimator');
	});
});

// num_bits comes from the response. A huge value made padStart throw "Invalid string length", a
// raw RangeError with nothing in it to tell the user what happened.
describe('a register width the response cannot justify', () => {
	const twoSamples = (numBits?: unknown) => ({
		c: { samples: ['0x1', '0x3'], ...(numBits === undefined ? {} : { num_bits: numBits }) },
	});

	it.each([[1e9], [-5], [1.5], [4097], ['3'], [null], [Number.NaN], [Number.POSITIVE_INFINITY]])(
		'falls back to the measured width for num_bits %s',
		(given) => {
			const parsed = parseSamplerPub(twoSamples(given));
			expect(parsed.numBits).toBe(2);
			expect(parsed.counts).toEqual({ '11': 1, '01': 1 });
		},
	);

	it('trusts a plausible width', () => {
		expect(parseSamplerPub(twoSamples(4)).numBits).toBe(4);
		expect(parseSamplerPub(twoSamples(4)).counts).toEqual({ '0011': 1, '0001': 1 });
	});

	it('trusts the widest register the builder can produce', () => {
		expect(parseSamplerPub(twoSamples(4096)).numBits).toBe(4096);
	});

	it('measures the width when num_bits is absent', () => {
		expect(parseSamplerPub(twoSamples()).numBits).toBe(2);
	});
});

// getNodeParameter's fallback only applies when the parameter is absent, so an expression that
// resolved to null went straight through and the first field read threw a raw TypeError.
describe('a collection parameter an expression did not resolve to an object', () => {
	const listJobs = (listFilters: unknown) => {
		const { ctx, requests } = makeExecuteContext({
			params: { listFilters, limit: 5 },
			http: () => ({ jobs: [] }),
		});
		return handleJob.call(ctx, TEST_CTX, 'list', 0).then(() => requests);
	};

	it.each([[null], [undefined], ['text'], [42], [[]], [true]])(
		'treats %s as no filters instead of throwing',
		async (given) => {
			const requests = await listJobs(given);
			expect(requests[0].qs).toEqual({ limit: 5, exclude_params: true });
		},
	);

	it('still applies a real filter object', async () => {
		const requests = await listJobs({ backend: 'ibm_kingston' });
		expect(requests[0].qs).toEqual({
			limit: 5,
			exclude_params: true,
			backend: 'ibm_kingston',
		});
	});

	it('treats a null gate collection as an empty circuit', () => {
		const { ctx } = makeExecuteContext({ params: { numQubits: 1, numClbits: 0, gates: null } });
		const result = handleCircuitBuild.call(ctx, 0) as Record<string, unknown>;
		expect(result.gateCount).toBe(0);
	});
});
