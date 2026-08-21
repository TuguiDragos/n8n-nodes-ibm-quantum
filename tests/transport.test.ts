import { NodeApiError, type INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { enrichApiError, explainTerseError, extractIbmError } from '../nodes/IbmQuantum/transport';

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

// IBM's 404 bodies are inconsistent. A missing job or session names the identifier and carries a
// solution; a missing device or log answers with a bare "device not found" that names nothing.
describe('explainTerseError', () => {
	const wrap = (message: string, solution?: string, status = '404') =>
		enrichApiError(
			NODE,
			Object.assign(new Error(`Request failed with status code ${status}`), {
				httpCode: status,
				context: { data: { errors: [{ code: 'not_found', message, ...(solution ? { solution } : {}) }] } },
			}),
		);

	it('adds the value and where to look when IBM names neither', () => {
		const error = explainTerseError(
			wrap('device not found'),
			'Backend',
			'ibm_kingstn',
			'Check the name against Backend > Get Many.',
		) as NodeApiError;
		expect(error.message).toBe(
			'Backend "ibm_kingstn": device not found. Check the name against Backend > Get Many.',
		);
	});

	it("keeps IBM's own wording inside the new message", () => {
		const error = explainTerseError(wrap('logs not found'), 'Logs for job', 'job-1', 'Hint.') as NodeApiError;
		expect(error.message).toContain('logs not found');
		expect(error.message).toContain('job-1');
	});

	// n8n sets description to a generic "Request failed with status code 404" whenever IBM supplies
	// no solution, so the decision cannot be based on description being present.
	it('does not treat n8n generic description as an IBM solution', () => {
		const wrapped = wrap('device not found');
		expect(wrapped.description).toBeTruthy();
		const error = explainTerseError(wrapped, 'Backend', 'ibm_x', 'Hint.') as NodeApiError;
		expect(error.message).toContain('Backend "ibm_x"');
	});

	it('leaves a message that already names the value untouched', () => {
		const original = 'Job not found. Job ID: da24eX';
		const error = explainTerseError(
			wrap(original, 'Verify the job ID is correct.'),
			'Job',
			'da24eX',
			'Hint.',
		) as NodeApiError;
		expect(error.message).toBe(original);
		expect(error.description).toBe('Verify the job ID is correct.');
	});

	// A NodeApiError built from an error with no message at all has nothing to enrich.
	it('leaves an error with no message untouched', () => {
		const empty = new NodeApiError(NODE, {} as never);
		empty.message = '';
		expect((explainTerseError(empty, 'Backend', 'x', 'Hint.') as NodeApiError).message).toBe('');
	});

	it('survives an error whose message property is missing entirely', () => {
		const noMessage = wrap('device not found');
		(noMessage as { message?: string }).message = undefined;
		expect(explainTerseError(noMessage, 'Backend', 'x', 'Hint.')).toBe(noMessage);
	});

	it('returns anything that is not a node API error unchanged', () => {
		const plain = new Error('boom');
		expect(explainTerseError(plain, 'Backend', 'x', 'Hint.')).toBe(plain);
		expect(explainTerseError(null, 'Backend', 'x', 'Hint.')).toBeNull();
	});
});

// Only a missing resource is about the value the user typed. Telling someone to check the backend
// name when their token expired sends them after the wrong thing.
describe('explainTerseError only speaks about the value on a 404', () => {
	const at = (status: string, message: string) =>
		enrichApiError(
			NODE,
			Object.assign(new Error(`Request failed with status code ${status}`), {
				httpCode: status,
				context: { data: { errors: [{ code: 'x', message }] } },
			}),
		);

	it.each([
		['401', 'Token is expired'],
		['403', 'Forbidden'],
		['429', 'Too many requests'],
		['500', 'Internal server error'],
		['400', 'Bad request'],
	])('leaves a %s untouched', (status, message) => {
		const error = explainTerseError(
			at(status, message),
			'Backend',
			'ibm_kingstn',
			'Check the name.',
		) as NodeApiError;
		expect(error.message).toBe(message);
	});

	it('still enriches the 404 it exists for', () => {
		const error = explainTerseError(
			at('404', 'device not found'),
			'Backend',
			'ibm_kingstn',
			'Check the name.',
		) as NodeApiError;
		expect(error.message).toBe('Backend "ibm_kingstn": device not found. Check the name.');
	});
});
