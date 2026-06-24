import { NodeApiError, type INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { enrichApiError, extractIbmError } from '../nodes/IbmQuantum/transport';

const NODE = { name: 'IBM Quantum', type: 'ibmQuantum', typeVersion: 1, position: [0, 0], parameters: {} } as unknown as INode;

// The exact body IBM returns for the open-plan session error (code 1352).
const IBM_BODY = {
	errors: [
		{
			code: 1352,
			message: 'You are not authorized to run a session when using the open plan.',
			solution: 'Create an instance of a different plan type or use a different execution mode.',
			more_info: 'https://cloud.ibm.com/apidocs/quantum-computing#error-handling',
		},
	],
	trace: '6a103952-9232-4ffc-aac1-2367e8ca2091',
};

describe('extractIbmError', () => {
	it('reads errors[0].message and solution from context.data (the live runtime path)', () => {
		expect(extractIbmError({ context: { data: IBM_BODY } })).toEqual({
			message: 'You are not authorized to run a session when using the open plan.',
			solution: 'Create an instance of a different plan type or use a different execution mode.',
		});
	});

	it('joins multiple error messages and keeps the first solution', () => {
		const body = { errors: [{ message: 'first bad' }, { message: 'second bad', solution: 'fix it' }] };
		expect(extractIbmError({ context: { data: body } })).toEqual({
			message: 'first bad; second bad',
			solution: 'fix it',
		});
	});

	it('omits solution when none is present', () => {
		const body = { errors: [{ message: 'no solution here' }] };
		expect(extractIbmError({ context: { data: body } })).toEqual({ message: 'no solution here' });
	});

	it('falls back to a singular error object', () => {
		const body = { error: { message: 'single error', solution: 'do this' } };
		expect(extractIbmError({ context: { data: body } })).toEqual({
			message: 'single error',
			solution: 'do this',
		});
	});

	it('falls back to a top-level data.message', () => {
		expect(extractIbmError({ context: { data: { message: 'flat message' } } })).toEqual({
			message: 'flat message',
		});
	});

	it('reads from response.data and cause.response.data as fallbacks', () => {
		expect(extractIbmError({ response: { data: IBM_BODY } })?.message).toBe(
			'You are not authorized to run a session when using the open plan.',
		);
		expect(extractIbmError({ cause: { response: { data: IBM_BODY } } })?.message).toBe(
			'You are not authorized to run a session when using the open plan.',
		);
	});

	it('returns null when there is no usable detail', () => {
		expect(extractIbmError({})).toBeNull();
		expect(extractIbmError(null)).toBeNull();
		expect(extractIbmError({ context: { data: {} } })).toBeNull();
		expect(extractIbmError({ context: { data: { errors: [{ code: 1 }] } } })).toBeNull();
	});
});

describe('enrichApiError', () => {
	it('surfaces the IBM message and solution from a raw request error', () => {
		// n8n stores the parsed body on response.data when it first builds the error.
		const raw = { message: 'Request failed with status code 400', response: { data: IBM_BODY } };
		const enriched = enrichApiError(NODE, raw);
		expect(enriched).toBeInstanceOf(NodeApiError);
		expect(enriched.message).toBe('You are not authorized to run a session when using the open plan.');
		expect(enriched.description).toBe(
			'Create an instance of a different plan type or use a different execution mode.',
		);
	});

	it('reads context.data from a foreign-module NodeApiError shape (the production path)', () => {
		// At runtime the incoming error is n8n's own NodeApiError (different module copy): not an
		// instanceof ours, body lives on context.data. enrichApiError must still surface it.
		const foreign = { name: 'NodeApiError', message: 'Bad request - please check your parameters', context: { data: IBM_BODY } };
		const enriched = enrichApiError(NODE, foreign);
		expect(enriched).toBeInstanceOf(NodeApiError);
		expect(enriched.message).toBe('You are not authorized to run a session when using the open plan.');
	});

	it('enriches an already-wrapped same-module NodeApiError in place', () => {
		const apiError = new NodeApiError(NODE, { message: 'boom', response: { data: IBM_BODY } });
		const enriched = enrichApiError(NODE, apiError);
		expect(enriched).toBe(apiError);
		expect(enriched.message).toBe('You are not authorized to run a session when using the open plan.');
	});

	it('leaves the message untouched when the response carried no IBM detail', () => {
		const apiError = new NodeApiError(NODE, { message: 'Service Unavailable', httpCode: '503' });
		const before = apiError.message;
		const enriched = enrichApiError(NODE, apiError);
		expect(enriched.message).toBe(before);
	});
});
