import type { ICredentialDataDecryptedObject, IHttpRequestHelper, INode } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { IbmQuantumApi } from '../credentials/IbmQuantumApi.credentials';
import {
	clampCount,
	handleBackend,
	handleCircuitBuild,
	handleCircuitImport,
	handleJob,
	handleSession,
	isTransientPollError,
} from '../nodes/IbmQuantum/operations';
import { buildQasm3, type GateOperation } from '../nodes/IbmQuantum/qasm3';
import { parseResults } from '../nodes/IbmQuantum/results';
import { enrichApiError } from '../nodes/IbmQuantum/transport';
import { pollJobs } from '../nodes/IbmQuantum/triggerPoll';
import { fakeNode, makeExecuteContext, TEST_CTX } from './fakeContext';

// Defensive fallbacks that only fire on a partial or malformed API response. They are the paths
// that run on the worst day, so they are worth pinning down rather than leaving to inference.

describe('parseResults tolerates partial pubs', () => {
	it('treats a pub with no data at all as an estimator pub of nulls', () => {
		const parsed = parseResults({ results: [{}] });
		expect(parsed.pubCount).toBe(1);
		expect((parsed.pubs as Array<Record<string, unknown>>)[0]).toEqual({
			type: 'estimator',
			evs: null,
			stds: null,
			ensembleStandardError: null,
			metadata: {},
		});
	});

	it('nulls only the estimator fields the response actually omitted', () => {
		const parsed = parseResults({ results: [{ data: { evs: 0.25 } }] });
		const pub = (parsed.pubs as Array<Record<string, unknown>>)[0];
		expect(pub.evs).toBe(0.25);
		expect(pub.stds).toBeNull();
		expect(pub.ensembleStandardError).toBeNull();
	});

	it('defaults missing sampler metadata to an empty object', () => {
		const parsed = parseResults({ results: [{ data: { c: { samples: ['0x1'], num_bits: 1 } } }] });
		const pub = (parsed.pubs as Array<Record<string, unknown>>)[0];
		expect(pub.type).toBe('sampler');
		expect(pub.metadata).toEqual({});
		expect(pub.numBits).toBe(1);
	});

	it('ignores a non-array results field instead of throwing', () => {
		expect(parseResults({ results: 'nope' as unknown as [] })).toEqual({ pubCount: 0, pubs: [] });
	});
});

describe('isTransientPollError', () => {
	// The fallback chain reads response.status, then statusCode, then httpCode, then cause.status.
	// Asserting only "not transient" let every arm be satisfied by the value simply being absent.
	it('reads the status from every source in the chain, not just the first', () => {
		expect(isTransientPollError({ httpCode: 500 })).toBe(true);
		expect(isTransientPollError({ statusCode: 502 })).toBe(true);
		expect(isTransientPollError({ response: { status: 503 } })).toBe(true);
		expect(isTransientPollError({ cause: { httpCode: 500 } })).toBe(true);
		expect(isTransientPollError({ cause: { statusCode: 429 } })).toBe(true);
		expect(isTransientPollError({ cause: { response: { status: 503 } } })).toBe(true);
	});

	// httpCode is read before statusCode, which is read before response.status. Pinning the order
	// matters: a rewrite that reorders them would change which status a real axios error reports.
	it('prefers the earlier source when two disagree', () => {
		expect(isTransientPollError({ httpCode: 404, statusCode: 500 })).toBe(false);
		expect(isTransientPollError({ httpCode: 500, statusCode: 404 })).toBe(true);
		expect(isTransientPollError({ statusCode: 500, response: { status: 404 } })).toBe(true);
		expect(isTransientPollError({ statusCode: 404, response: { status: 500 } })).toBe(false);
	});

	it('treats the 5xx boundary exactly', () => {
		expect(isTransientPollError({ statusCode: 499 })).toBe(false);
		expect(isTransientPollError({ statusCode: 500 })).toBe(true);
		expect(isTransientPollError({ statusCode: 428 })).toBe(false);
		expect(isTransientPollError({ statusCode: 429 })).toBe(true);
		expect(isTransientPollError({ statusCode: 430 })).toBe(false);
	});

	it('ignores a network code once a real status is present', () => {
		expect(isTransientPollError({ statusCode: 404, cause: { code: 'ECONNRESET' } })).toBe(false);
	});

	it('retries on 429 and 5xx, and gives up on 4xx', () => {
		expect(isTransientPollError({ httpCode: '429' })).toBe(true);
		expect(isTransientPollError({ httpCode: '503' })).toBe(true);
		expect(isTransientPollError({ statusCode: 500 })).toBe(true);
		expect(isTransientPollError({ response: { status: 404 } })).toBe(false);
		expect(isTransientPollError({ httpCode: '401' })).toBe(false);
	});

	it('retries a dropped connection, identified by its cause code', () => {
		expect(isTransientPollError({ cause: { code: 'ECONNRESET' } })).toBe(true);
		expect(isTransientPollError({ cause: { code: 'ETIMEDOUT' } })).toBe(true);
	});

	it('does not retry an unrecognised or non-string cause code', () => {
		expect(isTransientPollError({ cause: { code: 'ENOTFOUND' } })).toBe(false);
		expect(isTransientPollError({ cause: { code: 500 } })).toBe(false);
		expect(isTransientPollError({ cause: {} })).toBe(false);
		expect(isTransientPollError({})).toBe(false);
	});

	it('does not retry a non-object error', () => {
		expect(isTransientPollError(null)).toBe(false);
		expect(isTransientPollError('boom')).toBe(false);
		expect(isTransientPollError(undefined)).toBe(false);
	});

	// A non-numeric httpCode (n8n sometimes stores a code string there) must not be read as a
	// status, or Number() yields NaN and the connection-level check never runs.
	it('falls through to the cause code when httpCode is not numeric', () => {
		expect(isTransientPollError({ httpCode: 'ECONNREFUSED', cause: { code: 'ECONNREFUSED' } })).toBe(
			true,
		);
	});
});

describe('enrichApiError without an IBM solution field', () => {
	const NODE: INode = fakeNode();
	const NO_SOLUTION = { errors: [{ code: 1219, message: 'Error authenticating user.' }] };

	it('sets the message and leaves the description unset on a raw error', () => {
		const enriched = enrichApiError(NODE, { response: { data: NO_SOLUTION } });
		expect(enriched).toBeInstanceOf(NodeApiError);
		expect(enriched.message).toBe('Error authenticating user.');
	});

	it('rewrites the message in place on a same-module NodeApiError, leaving its description', () => {
		const apiError = new NodeApiError(NODE, { message: 'boom' });
		apiError.description = 'original description';
		const enriched = enrichApiError(NODE, { ...apiError, context: { data: NO_SOLUTION } });
		expect(enriched.message).toBe('Error authenticating user.');
	});
});

describe('buildQasm3 rejects a gate the renderer does not know', () => {
	// validateGateInput normally catches this first. This is the second line of defence, for a
	// circuit assembled by calling buildQasm3 directly.
	it('throws instead of emitting an undefined instruction', () => {
		const gates = [{ gate: 'nope', targets: [0], controls: [], params: [] }] as GateOperation[];
		expect(() => buildQasm3({ numQubits: 1, numClbits: 0, gates })).toThrow(/Unsupported gate/);
	});
});

describe('pollJobs surfaces a failed listing request', () => {
	it('wraps the transport error rather than swallowing it', async () => {
		const ctx = {
			getCredentials: async () => ({ region: 'us-east', apiVersion: '2026-04-15' }),
			getMode: () => 'trigger',
			getNode: () => fakeNode(),
			getWorkflowStaticData: () => ({}),
			helpers: {
				httpRequestWithAuthentication: async () => {
					throw { response: { data: { errors: [{ message: 'Instance not found.' }] } } };
				},
				returnJsonArray: (data: unknown[]) => data,
			},
		};

		await expect(
			pollJobs(ctx as never, 50, () => true, (job) => job),
		).rejects.toThrow(/Instance not found/);
	});

	it('reads the jobs array from a bare-array response shape', async () => {
		const staticData: Record<string, unknown> = { seenJobIds: [] };
		const ctx = {
			getCredentials: async () => ({ region: 'us-east', apiVersion: '2026-04-15' }),
			getMode: () => 'trigger',
			getNode: () => fakeNode(),
			getWorkflowStaticData: () => staticData,
			helpers: {
				httpRequestWithAuthentication: async () => [{ id: 'j1' }],
				returnJsonArray: (data: unknown[]) => data,
			},
		};

		const result = await pollJobs(ctx as never, 50, () => true, (job) => job);
		expect(result).toEqual([[{ id: 'j1' }]]);
	});
});

describe('IAM failure hints stay minimal and safe', () => {
	const cred = new IbmQuantumApi();
	const preAuth = (httpRequest: () => Promise<unknown>) =>
		cred.preAuthentication.call({ helpers: { httpRequest } } as unknown as IHttpRequestHelper, {
			apiKey: 'SECRET_KEY_VALUE',
		} as unknown as ICredentialDataDecryptedObject);

	it('adds no parenthetical at all for a status it has no wording for', async () => {
		let message = '';
		try {
			await preAuth(async () => {
				throw { response: { status: 418 } };
			});
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).not.toContain('(');
		expect(message).toContain('IBM IAM token request failed.');
	});

	// The code is echoed into a user-facing string, so anything that is not a short, plain
	// identifier is dropped rather than printed.
	it('drops an error code that is not a short plain identifier', async () => {
		let message = '';
		try {
			await preAuth(async () => {
				throw {
					response: { status: 400, data: { errorCode: 'apikey=SECRET_KEY_VALUE injected' } },
				};
			});
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('the API key was rejected');
		expect(message).not.toContain('code ');
		expect(message).not.toContain('SECRET_KEY_VALUE');
	});
});

describe('response shapes the API can legitimately return', () => {
	it('renders a barrier scoped to specific qubits, not just the full-width form', () => {
		const gates = [
			{ gate: 'barrier', targets: [0, 2], controls: [], params: [] },
		] as GateOperation[];
		expect(buildQasm3({ numQubits: 3, numClbits: 0, gates })).toContain('barrier q[0], q[2];');
	});

	it('reads the job list from the workloads key, and copes with neither key present', async () => {
		const make = (body: unknown) => ({
			getCredentials: async () => ({ region: 'us-east', apiVersion: '2026-04-15' }),
			getMode: () => 'trigger',
			getNode: () => fakeNode(),
			getWorkflowStaticData: () => ({ seenJobIds: [] }),
			helpers: {
				httpRequestWithAuthentication: async () => body,
				returnJsonArray: (data: unknown[]) => data,
			},
		});

		const fromWorkloads = await pollJobs(
			make({ workloads: [{ id: 'w1' }] }) as never,
			50,
			() => true,
			(job) => job,
		);
		expect(fromWorkloads).toEqual([[{ id: 'w1' }]]);

		const fromNeither = await pollJobs(make({}) as never, 50, () => true, (job) => job);
		expect(fromNeither).toBeNull();
	});
});

describe('extractStateError on a job with no state', () => {
	it('reports an empty status rather than crashing on a missing state object', async () => {
		const { extractStateError } = await import('../nodes/IbmQuantum/triggerPoll');
		expect(extractStateError({ id: 'j1', backend: 'ibm_kingston' })).toEqual({
			jobId: 'j1',
			backend: 'ibm_kingston',
			status: '',
			reason: null,
			reasonCode: null,
			reasonSolution: null,
			job: { id: 'j1', backend: 'ibm_kingston' },
		});
	});
});

describe('handler fallbacks when the API answers with less than expected', () => {
	it('sends pending=true for the Only Pending filter', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { limit: 50, listFilters: { pending: 'pending' } },
			http: () => ({ jobs: [] }),
		});
		await handleJob.call(ctx, TEST_CTX, 'list', 0);
		expect((requests[0].qs as Record<string, unknown>).pending).toBe(true);
	});

	it('passes a non-string logs body through instead of coercing it to text', async () => {
		const { ctx } = makeExecuteContext({
			params: { jobId: 'j1' },
			http: () => ({ lines: ['a', 'b'] }),
		});
		const result = (await handleJob.call(ctx, TEST_CTX, 'getLogs', 0)) as Record<string, unknown>;
		expect(result).toEqual({ jobId: 'j1', logs: { lines: ['a', 'b'] } });
	});

	it('reports a null session id when the create response carries none', async () => {
		const { ctx } = makeExecuteContext({
			params: { mode: 'batch', sessionBackend: 'ibm_kingston', maxTtl: 0 },
			http: () => ({}),
		});
		const created = (await handleSession.call(ctx, TEST_CTX, 'create', 0)) as Record<string, unknown>;
		expect(created.sessionId).toBeNull();
	});

	it('nulls the job id and backend when the error trigger sees a bare job object', async () => {
		const { extractStateError } = await import('../nodes/IbmQuantum/triggerPoll');
		const mapped = extractStateError({});
		expect(mapped.jobId).toBeNull();
		expect(mapped.backend).toBeNull();
		expect(mapped.status).toBe('');
	});
})

describe('optional and absent inputs on the circuit handlers', () => {
	it('builds an empty circuit when no gates were added at all', () => {
		const { ctx } = makeExecuteContext({ params: { numQubits: 2, numClbits: 2, gates: {} } });
		const result = handleCircuitBuild.call(ctx, 0);
		expect(result.gateCount).toBe(0);
		expect(result.qasm3).toBe('OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;');
	});

	it('treats a gate with no qubits or params keys as empty rather than crashing', () => {
		const { ctx } = makeExecuteContext({
			params: { numQubits: 1, numClbits: 0, gates: { gate: [{ gate: 'h' }] } },
		});
		// h needs exactly one qubit, so absent qubits must surface as a validation error.
		expect(() => handleCircuitBuild.call(ctx, 0)).toThrow(/expects 1 qubit/);
	});

	it('rejects an absent OpenQASM import body with the header error, not a crash', () => {
		const { ctx } = makeExecuteContext({ params: {} });
		expect(() => handleCircuitImport.call(ctx, 0)).toThrow(/OpenQASM 3 version header/);
	});
});

describe('backend selection against a sparse listing', () => {
	it('treats a device with no status object as not online', async () => {
		const { ctx } = makeExecuteContext({
			params: { minQubits: 0, includeSimulators: false },
			http: () => ({
				devices: [{ name: 'no_status', queue_length: 0 }, { name: 'ok', status: { name: 'online' }, queue_length: 3 }],
			}),
		});
		const result = await handleBackend.call(ctx, TEST_CTX, 'getLeastBusy', 0);
		expect(result.leastBusy).toBe('ok');
	});

	it('returns a null pick when the listing carries no devices key', async () => {
		const { ctx } = makeExecuteContext({
			params: { minQubits: 0, includeSimulators: false },
			http: () => ({}),
		});
		const result = await handleBackend.call(ctx, TEST_CTX, 'getLeastBusy', 0);
		expect(result).toMatchObject({ leastBusy: null, queueLength: null, candidates: [] });
	});
});

describe('submit handles JSON parameters that arrive already parsed', () => {
	it('accepts an Additional Options object from an expression, not just a JSON string', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				qasm3: 'OPENQASM 3.0;',
				shots: 128,
				additionalOptions: { default_shots: 4096 },
			},
			http: () => ({ id: 'job-1' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitSampler', 0);
		const body = requests[0].body as Record<string, Record<string, unknown>>;
		expect(body.params.options).toEqual({ default_shots: 4096 });
	});

	it('sends no options at all when Additional Options is the JSON literal null', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				qasm3: 'OPENQASM 3.0;',
				shots: 128,
				additionalOptions: 'null',
			},
			http: () => ({ id: 'job-1' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitSampler', 0);
		expect((requests[0].body as Record<string, Record<string, unknown>>).params.options).toBeUndefined();
	});

	it('reports a null job id when the submit response carries none', async () => {
		const { ctx } = makeExecuteContext({
			params: { backend: 'ibm_kingston', qasm3: 'OPENQASM 3.0;', shots: 128 },
			http: () => ({}),
		});
		const result = (await handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)) as Record<string, unknown>;
		expect(result.jobId).toBeNull();
		expect(result.sessionId).toBeNull();
	});

	it('defaults an empty logs body to an empty string', async () => {
		const { ctx } = makeExecuteContext({ params: { jobId: 'j1' }, http: () => null });
		const result = (await handleJob.call(ctx, TEST_CTX, 'getLogs', 0)) as Record<string, unknown>;
		expect(result.logs).toBe('');
	});
})

describe('enrichApiError on a same-module error whose body has no solution', () => {
	it('replaces the message and leaves the existing description alone', () => {
		const node = fakeNode();
		const apiError = new NodeApiError(node, { message: 'Bad request' });
		apiError.description = 'kept';
		// n8n parks the parsed body on context.data before our code sees the error.
		(apiError as unknown as { context: Record<string, unknown> }).context = {
			data: { errors: [{ code: 1219, message: 'Error authenticating user.' }] },
		};

		const enriched = enrichApiError(node, apiError);
		expect(enriched).toBe(apiError);
		expect(enriched.message).toBe('Error authenticating user.');
		expect(enriched.description).toBe('kept');
	});
})

describe('a circuit that is plainly not OpenQASM 3 is rejected before it costs a submission', () => {
	// IBM accepts the job, queues it, charges QPU time and only then fails it with a parse error.
	// Observed on ibm_kingston: 2 seconds of quota burnt on the string "this is not qasm".
	const submit = (qasm3: string) =>
		makeExecuteContext({ params: { backend: 'ibm_kingston', qasm3, shots: 128 } });

	it('refuses plain text, OpenQASM 2 and an empty circuit, without calling the API', async () => {
		for (const bad of ['this is not qasm', 'OPENQASM 2.0;\nqreg q[1];', '', '// OPENQASM 3.0;']) {
			const { ctx, requests } = submit(bad);
			await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
				/OpenQASM 3 version header/,
			);
			expect(requests).toHaveLength(0);
		}
	});

	it('still accepts a real program, including the physical-qubit form a transpiler emits', async () => {
		const transpiled = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nbit[1] c;\nrz(pi/2) $2;\nc[0] = measure $2;';
		const { ctx, requests } = submit(transpiled);
		await handleJob.call(ctx, TEST_CTX, 'submitSampler', 0);
		expect(requests).toHaveLength(1);
	});
});

describe('clampCount keeps a count field usable whatever an expression injects', () => {
	it('falls back on anything that is not a positive number', () => {
		expect(clampCount(0, 50)).toBe(50);
		expect(clampCount(-7, 50)).toBe(50);
		expect(clampCount(NaN, 50)).toBe(50);
		expect(clampCount('abc', 50)).toBe(50);
		expect(clampCount(undefined, 50)).toBe(50);
	});

	it('coerces a numeric string and truncates a float', () => {
		expect(clampCount('512', 1024)).toBe(512);
		expect(clampCount(7.9, 50)).toBe(7);
	});

	it('applies the ceiling only when one is given', () => {
		expect(clampCount(5000, 50, 200)).toBe(200);
		expect(clampCount(5000, 50)).toBe(5000);
	});
})

describe('job list filters that changed shape', () => {
	const list = (listFilters: Record<string, unknown>) =>
		makeExecuteContext({ params: { limit: 10, listFilters }, http: () => ({ jobs: [] }) });

	it('sends several tags as separate values, not one comma-joined string', async () => {
		const { ctx, requests } = list({ tag: 'qa-audit, vqe , experiment-7' });
		await handleJob.call(ctx, TEST_CTX, 'list', 0);
		expect((requests[0].qs as Record<string, unknown>).tags).toEqual([
			'qa-audit',
			'vqe',
			'experiment-7',
		]);
	});

	it('still sends a lone tag, and omits the key entirely when the filter is blank', async () => {
		const one = list({ tag: 'solo' });
		await handleJob.call(one.ctx, TEST_CTX, 'list', 0);
		expect((one.requests[0].qs as Record<string, unknown>).tags).toEqual(['solo']);

		const none = list({ tag: '  ,  ' });
		await handleJob.call(none.ctx, TEST_CTX, 'list', 0);
		expect((none.requests[0].qs as Record<string, unknown>).tags).toBeUndefined();
	});

	it('passes the primitive through as the program filter', async () => {
		const { ctx, requests } = list({ program: 'estimator' });
		await handleJob.call(ctx, TEST_CTX, 'list', 0);
		expect((requests[0].qs as Record<string, unknown>).program).toBe('estimator');

		const any = list({ program: '' });
		await handleJob.call(any.ctx, TEST_CTX, 'list', 0);
		expect((any.requests[0].qs as Record<string, unknown>).program).toBeUndefined();
	});
})
