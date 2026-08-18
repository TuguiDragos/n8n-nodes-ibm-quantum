import { NodeApiError, NodeOperationError, type INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { IbmQuantum } from '../nodes/IbmQuantum/IbmQuantum.node';
import {
	extractJobStatus,
	handleJob,
	isZlibBase64,
	mergePrimitiveOptions,
} from '../nodes/IbmQuantum/operations';
import { parseSamplerPub } from '../nodes/IbmQuantum/results';
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

	it('falls back to the first register with samples when the preferred one has none', () => {
		const data = { empty: { num_bits: 2 }, c: { num_bits: 1, samples: ['0x1'] } };
		expect(parseSamplerPub(data, 'empty')).toMatchObject({ register: 'c', shots: 1 });
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
