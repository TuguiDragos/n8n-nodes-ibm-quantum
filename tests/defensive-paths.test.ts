import { NodeApiError, NodeOperationError, type INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { extractJobStatus, handleJob, mergePrimitiveOptions } from '../nodes/IbmQuantum/operations';
import { parseSamplerPub } from '../nodes/IbmQuantum/results';
import { asNodeError, errorMessage } from '../nodes/IbmQuantum/transport';
import { fakeNode, makeExecuteContext, TEST_CTX } from './fakeContext';

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
