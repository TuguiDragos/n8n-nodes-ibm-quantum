import { describe, expect, it } from 'vitest';

import {
	asNumberListInput,
	characterLength,
	asTrimmedString,
	handleAccount,
	parseCsvList,
	handleBackend,
	handleCircuitBuild,
	handleCircuitImport,
	MAX_IDENTIFIER_LENGTH,
	handleJob,
	handleSession,
	MAX_REGISTER_SIZE,
} from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

// An expression can put anything into a parameter the UI types as string or number. These tests
// pin the behaviour for values no UI control can produce but an expression can.

describe('asTrimmedString', () => {
	it('keeps text and numbers, trimming whitespace', () => {
		expect(asTrimmedString('  abc  ')).toBe('abc');
		expect(asTrimmedString(42)).toBe('42');
		expect(asTrimmedString(0)).toBe('0');
	});

	it('reduces every non-string, non-number value to the empty string', () => {
		expect(asTrimmedString(undefined)).toBe('');
		expect(asTrimmedString(null)).toBe('');
		expect(asTrimmedString({})).toBe('');
		expect(asTrimmedString([1, 2])).toBe('');
		expect(asTrimmedString(true)).toBe('');
		expect(asTrimmedString('   ')).toBe('');
	});
});

// A bare `/jobs/` is answered by IBM with its web app, not a 404, so an empty identifier used to
// come back as a successful result carrying 285 KB of HTML.
describe('a required identifier is rejected before the request goes out', () => {
	const cases: Array<[string, unknown]> = [
		['empty string', ''],
		['whitespace only', '   '],
		['undefined', undefined],
		['null', null],
		['an object', {}],
		['an array', []],
	];

	for (const [label, value] of cases) {
		it(`rejects a Job ID that is ${label}`, async () => {
			const { ctx, requests } = makeExecuteContext({ params: { jobId: value } });
			await expect(handleJob.call(ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
				/Job ID is required and cannot be empty/,
			);
			expect(requests).toHaveLength(0);
		});

		it(`rejects a Session ID that is ${label}`, async () => {
			const { ctx, requests } = makeExecuteContext({ params: { sessionId: value } });
			await expect(handleSession.call(ctx, TEST_CTX, 'get', 0)).rejects.toThrow(
				/Session ID is required and cannot be empty/,
			);
			expect(requests).toHaveLength(0);
		});

		it(`rejects a Backend Name that is ${label}`, async () => {
			const { ctx, requests } = makeExecuteContext({ params: { backendName: value } });
			await expect(handleBackend.call(ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
				/Backend Name is required and cannot be empty/,
			);
			expect(requests).toHaveLength(0);
		});
	}

	it('rejects an empty Backend on submit before any QPU time is reserved', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { backend: '', circuitFormat: 'qasm3', qasm3: 'OPENQASM 3.0;\nqubit[1] q;' },
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'submitSampler', 0)).rejects.toThrow(
			/Backend is required and cannot be empty/,
		);
		expect(requests).toHaveLength(0);
	});

	it('rejects an empty Backend on session create', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { sessionBackend: '', sessionMode: 'batch' },
		});
		await expect(handleSession.call(ctx, TEST_CTX, 'create', 0)).rejects.toThrow(
			/Backend is required and cannot be empty/,
		);
		expect(requests).toHaveLength(0);
	});

	it('accepts a numeric identifier by coercing it, rather than throwing a TypeError', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 12345 },
			http: () => ({ id: '12345' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		expect((requests[0] as HttpCall).url).toContain('/jobs/12345');
	});

	it('trims a padded identifier instead of sending the spaces', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: '  abc123  ' },
			http: () => ({ id: 'abc123' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		expect((requests[0] as HttpCall).url).toContain('/jobs/abc123');
	});
});

// Live traversals confirmed before the fix: `../backends` returned the device list, `../jobs`
// returned the job list, and `../../instances` escaped the /v1 prefix entirely.
describe('a path segment cannot traverse to another endpoint', () => {
	const traversals = ['../backends', '../../instances', 'a/b', 'a?limit=1', 'a#frag', 'a b'];

	for (const evil of traversals) {
		it(`encodes a Job ID of ${JSON.stringify(evil)}`, async () => {
			const { ctx, requests } = makeExecuteContext({
				params: { jobId: evil },
				http: () => ({ id: 'x' }),
			});
			await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
			const url = (requests[0] as HttpCall).url as string;
			expect(url).toBe(`${TEST_CTX.baseUrl}/jobs/${encodeURIComponent(evil)}`);
			// Dots stay literal because they are unreserved; what matters is that the separators are
			// encoded, so the whole value remains exactly one path segment.
			expect(url.split('/jobs/')[1]).not.toContain('/');
			expect(url.split('/jobs/')[1]).not.toContain('?');
			expect(url.split('/jobs/')[1]).not.toContain('#');
		});
	}

	it('keeps a destructive verb on its own resource', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: '../sessions/abc' },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'delete', 0);
		expect((requests[0] as HttpCall).method).toBe('DELETE');
		expect((requests[0] as HttpCall).url).not.toContain('/sessions/');
	});

	it('encodes a Session ID', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { sessionId: '../jobs' },
			http: () => ({}),
		});
		await handleSession.call(ctx, TEST_CTX, 'get', 0);
		expect((requests[0] as HttpCall).url).toBe(`${TEST_CTX.baseUrl}/sessions/..%2Fjobs`);
	});

	it('encodes a Backend Name', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { backendName: '../jobs' },
			http: () => ({}),
		});
		await handleBackend.call(ctx, TEST_CTX, 'getStatus', 0);
		expect((requests[0] as HttpCall).url).toBe(`${TEST_CTX.baseUrl}/backends/..%2Fjobs/status`);
	});

	it('leaves a normal identifier untouched', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'da24v6iein7c73be57eg' },
			http: () => ({ id: 'da24v6iein7c73be57eg' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		expect((requests[0] as HttpCall).url).toBe(`${TEST_CTX.baseUrl}/jobs/da24v6iein7c73be57eg`);
	});
});

describe('string parameters survive a non-string expression', () => {
	it('treats a numeric Tag Search as text rather than throwing', async () => {
		const { ctx } = makeExecuteContext({ params: { tagSearch: 12345 } });
		const result = (await handleJob.call(ctx, TEST_CTX, 'listTags', 0)) as Record<string, unknown>;
		expect(result).toBeDefined();
	});

	it('rejects an object Tag Search with the documented bounds message', async () => {
		const { ctx } = makeExecuteContext({ params: { tagSearch: {} } });
		await expect(handleJob.call(ctx, TEST_CTX, 'listTags', 0)).rejects.toThrow(
			/Search must be between 3 and 100 characters/,
		);
	});
});

// `endpoints[operation]` used a truthiness check, so an operation named after an inherited Object
// member resolved to a function and was sent as the endpoint.
describe('an operation named after an Object member is rejected', () => {
	const inherited = ['toString', 'constructor', 'valueOf', 'hasOwnProperty'];

	for (const name of inherited) {
		it(`rejects backend operation ${name}`, async () => {
			const { ctx, requests } = makeExecuteContext({ params: { backendName: 'ibm_kingston' } });
			await expect(handleBackend.call(ctx, TEST_CTX, name, 0)).rejects.toThrow(
				new RegExp(`Unsupported backend operation: ${name}`),
			);
			expect(requests).toHaveLength(0);
		});

		it(`rejects account operation ${name}`, async () => {
			const { ctx, requests } = makeExecuteContext({});
			await expect(handleAccount.call(ctx, TEST_CTX, name, 0)).rejects.toThrow(
				new RegExp(`Unsupported account operation: ${name}`),
			);
			expect(requests).toHaveLength(0);
		});
	}

	it('still routes the real operations', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { backendName: 'ibm_kingston' } });
		await handleBackend.call(ctx, TEST_CTX, 'getStatus', 0);
		expect((requests[0] as HttpCall).url).toContain('/backends/ibm_kingston/status');
	});
});

// The schema bounds a job tag list to 8 entries of at most 86 characters.
describe('job tags are bounded before the submit', () => {
	it('rejects a ninth tag', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'j1', jobTags: 'a,b,c,d,e,f,g,h,i' },
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'updateTags', 0)).rejects.toThrow(
			/9 entries; IBM accepts at most 8/,
		);
		expect(requests).toHaveLength(0);
	});

	it('accepts exactly eight', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'j1', jobTags: 'a,b,c,d,e,f,g,h' },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'updateTags', 0);
		expect((requests[0] as HttpCall).body).toEqual({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
	});

	it('rejects a tag longer than 86 characters', async () => {
		const { ctx } = makeExecuteContext({
			params: { jobId: 'j1', jobTags: 'ok,' + 'x'.repeat(87) },
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'updateTags', 0)).rejects.toThrow(
			/is 87 characters; IBM accepts at most 86/,
		);
	});

	it('accepts a tag of exactly 86 characters', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'j1', jobTags: 'x'.repeat(86) },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'updateTags', 0);
		expect(requests).toHaveLength(1);
	});

	it('still allows clearing every tag', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'j1', jobTags: '' },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'updateTags', 0);
		expect((requests[0] as HttpCall).body).toEqual({ tags: [] });
	});
});

describe('estimator numbers are bounded to what the schema accepts', () => {
	const submit = (params: Record<string, unknown>) => {
		const { ctx } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				circuitFormat: 'qasm3',
				qasm3: 'OPENQASM 3.0;\nqubit[1] q;',
				observables: '"ZZ"',
				...params,
			},
			http: () => ({ id: 'j1' }),
		});
		return handleJob.call(ctx, TEST_CTX, 'submitEstimator', 0);
	};

	it.each([['3'], [3], [-1], ['abc'], [1.5], [Number.POSITIVE_INFINITY]])(
		'rejects a Resilience Level of %s',
		async (given) => {
			await expect(submit({ resilienceLevel: given })).rejects.toThrow(
				/Resilience Level must be an integer between 0 and 2/,
			);
		},
	);

	it.each([[0], [1], [2]])('accepts a Resilience Level of %s', async (given) => {
		await expect(submit({ resilienceLevel: given })).resolves.toBeDefined();
	});

	it.each([[-0.1], ['abc'], [Number.NaN]])('rejects a Precision of %s', async (given) => {
		await expect(submit({ precision: given })).rejects.toThrow(
			/Precision must be a number at least 0/,
		);
	});

	it('sends a numeric precision, not the string an expression produced', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				circuitFormat: 'qasm3',
				qasm3: 'OPENQASM 3.0;\nqubit[1] q;',
				observables: '"ZZ"',
				precision: '0.01',
			},
			http: () => ({ id: 'j1' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitEstimator', 0);
		const pubs = ((requests[0] as HttpCall).body as { params: { pubs: unknown[][] } }).params.pubs;
		expect(typeof pubs[0][pubs[0].length - 1]).toBe('number');
	});
});

describe('minimum qubits fails loudly instead of dropping the filter', () => {
	const leastBusy = (minQubits: unknown) => {
		const { ctx } = makeExecuteContext({
			params: { minQubits, includeSimulators: false },
			http: () => ({
				devices: [
					{ name: 'ibm_tiny', status: { name: 'online' }, queue_length: 0, qubits: 5 },
					{ name: 'ibm_big', status: { name: 'online' }, queue_length: 9, qubits: 127 },
				],
			}),
		});
		return handleBackend.call(ctx, TEST_CTX, 'getLeastBusy', 0);
	};

	it.each([['abc'], [Number.NaN], [-1], [1.5], [undefined]])(
		'rejects a Minimum Qubits of %s rather than returning any device',
		async (given) => {
			await expect(leastBusy(given)).rejects.toThrow(
				/Minimum Qubits must be an integer at least 0/,
			);
		},
	);

	it('still filters correctly for a valid minimum', async () => {
		const result = (await leastBusy(100)) as Record<string, unknown>;
		expect(result.leastBusy).toBe('ibm_big');
	});

	it('treats zero as no minimum', async () => {
		const result = (await leastBusy(0)) as Record<string, unknown>;
		expect(result.leastBusy).toBe('ibm_tiny');
	});
});

describe('register sizes are bounded at both ends', () => {
	const build = (params: Record<string, unknown>) => {
		const { ctx } = makeExecuteContext({ params });
		return () => handleCircuitBuild.call(ctx, 0);
	};

	it('accepts the maximum exactly', () => {
		const result = build({ numQubits: MAX_REGISTER_SIZE, numClbits: 0, gates: {} })();
		expect(result.numQubits).toBe(MAX_REGISTER_SIZE);
	});

	it('rejects one qubit above the maximum', () => {
		expect(build({ numQubits: MAX_REGISTER_SIZE + 1, numClbits: 0, gates: {} })).toThrow(
			/above the supported maximum/,
		);
	});

	it('rejects a runaway expression value', () => {
		expect(build({ numQubits: 1e7, numClbits: 0, gates: {} })).toThrow(
			/above the supported maximum of 4096/,
		);
	});

	it('bounds the classical register too', () => {
		expect(build({ numQubits: 1, numClbits: MAX_REGISTER_SIZE + 1, gates: {} })).toThrow(
			/Number of Classical Bits is 4097, above the supported maximum/,
		);
	});

	it('still rejects a value below the minimum', () => {
		expect(build({ numQubits: 0, numClbits: 0, gates: {} })).toThrow(/at least 1/);
	});
});

// The circuit builder is the last line of defence before a job is queued and charged.
describe('the circuit builder refuses a repeated qubit index', () => {
	const buildGate = (gate: string, qubits: string, params?: string) => {
		const { ctx } = makeExecuteContext({
			params: {
				numQubits: 3,
				numClbits: 3,
				gates: { gate: [{ gate, qubits, ...(params ? { params } : {}) }] },
			},
		});
		return () => handleCircuitBuild.call(ctx, 0);
	};

	it('reports the gate number and the repeated index', () => {
		expect(buildGate('cx', '0,0')).toThrow(
			/Gate #1: Gate 'cx' uses qubit index 0 more than once/,
		);
	});

	it('refuses every affected gate', () => {
		expect(buildGate('cz', '1,1')).toThrow(/more than once/);
		expect(buildGate('swap', '2,2')).toThrow(/more than once/);
		expect(buildGate('ccx', '0,1,1')).toThrow(/more than once/);
		expect(buildGate('crx', '0,0', '0.5')).toThrow(/more than once/);
		expect(buildGate('cry', '1,1', '0.5')).toThrow(/more than once/);
		expect(buildGate('crz', '2,2', '0.5')).toThrow(/more than once/);
	});

	// Number('0x1') is 1 and Number('1e0') is 1, so both used to collide with a plain 1.
	it('catches a collision produced by hex or exponent notation', () => {
		expect(buildGate('cx', '0x1,1')).toThrow(/uses qubit index 1 more than once/);
		expect(buildGate('cx', '1e0,1')).toThrow(/uses qubit index 1 more than once/);
	});

	it('still builds a valid two-qubit gate', () => {
		const result = buildGate('cx', '0,1')();
		expect(result.qasm3).toContain('cx q[0], q[1];');
	});
});

// IBM answers a wrong device or a job with no log file with a bare message that names nothing.
// These drive the two catch blocks that add the value the user supplied.
describe('a terse IBM error reaches the user with the value that caused it', () => {
	const failing = (message: string) => () => {
		throw Object.assign(new Error('Request failed with status code 404'), {
			httpCode: '404',
			context: { data: { errors: [{ code: 'not_found', message }] } },
		});
	};

	it('names the backend the user typed', async () => {
		const { ctx } = makeExecuteContext({
			params: { backendName: 'ibm_kingstn' },
			http: failing('device not found'),
		});
		await expect(handleBackend.call(ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
			/Backend "ibm_kingstn": device not found\. Check the name against Backend > Get Many/,
		);
	});

	it('names the job whose logs are missing', async () => {
		const { ctx } = makeExecuteContext({
			params: { jobId: 'da30no3otlns73993h50' },
			http: failing('logs not found'),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'getLogs', 0)).rejects.toThrow(
			/Logs for job "da30no3otlns73993h50": logs not found\./,
		);
	});

	it('leaves an error that already names the job untouched', async () => {
		const { ctx } = makeExecuteContext({
			params: { jobId: 'job-1' },
			http: failing('Job not found. Job ID: job-1'),
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'getLogs', 0)).rejects.toThrow(
			/^Job not found\. Job ID: job-1$/,
		);
	});
});

// Update Tags PUTs the full list, so anything parseCsvList drops is a tag deleted from the job.
// `{{ $json.tags }}` hands over an array, which used to reduce to [] and clear every tag.
describe('parseCsvList accepts what an expression really produces', () => {
	it('keeps an array of tags instead of clearing them', () => {
		expect(parseCsvList(['keep-me', 'and-me'])).toEqual(['keep-me', 'and-me']);
		expect(parseCsvList(['a'])).toEqual(['a']);
	});

	it('trims and drops empties inside an array', () => {
		expect(parseCsvList([' a ', '', 'b'])).toEqual(['a', 'b']);
	});

	// Each array entry is one tag, so a comma inside an entry is part of that tag.
	it('does not split an array entry on its commas', () => {
		expect(parseCsvList(['a,b', 'c'])).toEqual(['a,b', 'c']);
	});

	it('still splits the comma-separated string the UI field produces', () => {
		expect(parseCsvList('a, b ,c')).toEqual(['a', 'b', 'c']);
	});

	it('coerces a number rather than discarding it', () => {
		expect(parseCsvList(42)).toEqual(['42']);
	});

	it('returns nothing for a value with no sensible reading', () => {
		expect(parseCsvList(null)).toEqual([]);
		expect(parseCsvList(undefined)).toEqual([]);
		expect(parseCsvList({})).toEqual([]);
		expect(parseCsvList(true)).toEqual([]);
	});

	it('still lets an empty input clear every tag on purpose', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'job-1', jobTags: '' },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'updateTags', 0);
		expect((requests[0] as HttpCall).body).toEqual({ tags: [] });
	});

	it('preserves an array through Update Tags end to end', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'job-1', jobTags: ['keep-me', 'and-me'] },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'updateTags', 0);
		expect((requests[0] as HttpCall).body).toEqual({ tags: ['keep-me', 'and-me'] });
	});
});

// The header check runs on every circuit import and every submit, so a slow path here blocks the
// whole n8n process, not just the one execution.
describe('the OpenQASM header check stays linear', () => {
	const importCircuit = (qasm3Input: unknown) => {
		const { ctx } = makeExecuteContext({ params: { qasm3Input } });
		return () => handleCircuitImport.call(ctx, 0);
	};

	// \s matches 25 code points. Narrowing the leading run to [ \t] would have rejected 19 of them,
	// including U+FEFF, so a circuit saved as UTF-8 with a BOM would stop importing.
	it.each([
		['BOM', 0xfeff],
		['no-break space', 0x00a0],
		['form feed', 0x000c],
		['vertical tab', 0x000b],
		['ideographic space', 0x3000],
		['en quad', 0x2000],
		['narrow no-break space', 0x202f],
		['ogham space mark', 0x1680],
	])('still accepts a header prefixed with a %s', (_name, code) => {
		const prefixed = String.fromCharCode(code) + 'OPENQASM 3.0;';
		expect(importCircuit(prefixed)()).toBeTruthy();
	});

	it('accepts a header with any indentation and any number of blank lines before it', () => {
		expect(importCircuit('OPENQASM 3.0;')()).toBeTruthy();
		expect(importCircuit('   OPENQASM 3.0;')()).toBeTruthy();
		expect(importCircuit('\tOPENQASM 3.0;')()).toBeTruthy();
		expect(importCircuit('\n\n\nOPENQASM 3.0;')()).toBeTruthy();
		expect(importCircuit('// a note\nOPENQASM 3.0;')()).toBeTruthy();
		expect(importCircuit('\r\nOPENQASM 3.0;')()).toBeTruthy();
		expect(importCircuit('OPENQASM 3;')()).toBeTruthy();
		expect(importCircuit('OPENQASM 3.1;')()).toBeTruthy();
	});

	// The OpenQASM grammar allows a newline anywhere whitespace is allowed, so these stay valid.
	it('still accepts a newline inside the header statement', () => {
		expect(importCircuit('OPENQASM\n3.0;')()).toBeTruthy();
		expect(importCircuit('OPENQASM 3.0\n;')()).toBeTruthy();
	});

	it('still rejects what it always rejected', () => {
		expect(importCircuit('OPENQASM 2.0;')).toThrow(/OpenQASM 3 version header/);
		expect(importCircuit('OPENQASM 3.0')).toThrow(/OpenQASM 3 version header/);
		expect(importCircuit('// mentions OPENQASM 3.0; in a comment')).toThrow(
			/OpenQASM 3 version header/,
		);
		expect(importCircuit('')).toThrow(/OpenQASM 3 version header/);
	});

	// 160k newlines took 25 seconds before the leading run was narrowed to [ \t].
	it('rejects a flood of newlines promptly instead of backtracking', () => {
		const flood = '\n'.repeat(160_000) + 'x';
		const started = Date.now();
		expect(importCircuit(flood)).toThrow(/OpenQASM 3 version header/);
		expect(Date.now() - started).toBeLessThan(1000);
	});
});

// Number(''), Number(null), Number([]) and Number(false) are all 0. Passing that off as a
// deliberate zero is not harmless: zero is "no error mitigation" for Resilience Level and
// "no filter" for Minimum Qubits, so an expression that resolved to nothing changed the job.
describe('an empty numeric parameter is not a deliberate zero', () => {
	const submitWith = (params: Record<string, unknown>) => {
		const { ctx } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				circuitFormat: 'qasm3',
				qasm3: 'OPENQASM 3.0;\nqubit[1] q;',
				observables: '"ZZ"',
				...params,
			},
			http: () => ({ id: 'j1' }),
		});
		return handleJob.call(ctx, TEST_CTX, 'submitEstimator', 0);
	};

	it.each([[''], ['   '], [null], [[]], [false], [true], [{}]])(
		'refuses a Resilience Level of %s instead of shipping 0',
		async (given) => {
			await expect(submitWith({ resilienceLevel: given })).rejects.toThrow(
				/Resilience Level must be an integer between 0 and 2/,
			);
		},
	);

	it('still accepts a zero the user actually chose', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				circuitFormat: 'qasm3',
				qasm3: 'OPENQASM 3.0;\nqubit[1] q;',
				observables: '"ZZ"',
				resilienceLevel: 0,
			},
			http: () => ({ id: 'j1' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitEstimator', 0);
		const body = (requests[0] as HttpCall).body as { params: { resilience_level: number } };
		expect(body.params.resilience_level).toBe(0);
	});

	it('accepts numeric text, which is what an expression usually yields', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				circuitFormat: 'qasm3',
				qasm3: 'OPENQASM 3.0;\nqubit[1] q;',
				observables: '"ZZ"',
				resilienceLevel: ' 2 ',
			},
			http: () => ({ id: 'j1' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitEstimator', 0);
		const body = (requests[0] as HttpCall).body as { params: { resilience_level: number } };
		expect(body.params.resilience_level).toBe(2);
	});

	it.each([[''], [null], [[]], [false]])(
		'refuses a Minimum Qubits of %s instead of dropping the filter',
		async (given) => {
			const { ctx } = makeExecuteContext({
				params: { minQubits: given, includeSimulators: false },
				http: () => ({ devices: [] }),
			});
			await expect(handleBackend.call(ctx, TEST_CTX, 'getLeastBusy', 0)).rejects.toThrow(
				/Minimum Qubits must be an integer at least 0/,
			);
		},
	);

	it('keeps working when the parameter is simply absent and the default applies', async () => {
		const { ctx } = makeExecuteContext({
			params: { includeSimulators: false },
			http: () => ({ devices: [{ name: 'ibm_a', status: { name: 'online' }, queue_length: 1, qubits: 5 }] }),
		});
		const result = (await handleBackend.call(ctx, TEST_CTX, 'getLeastBusy', 0)) as Record<string, unknown>;
		expect(result.leastBusy).toBe('ibm_a');
	});
});

// The Qubits and Parameters fields are comma-separated text, but `{{ [0, 1] }}` and `{{ 0 }}` are
// the natural expressions. Both used to surface the internal "value.trim is not a function".
describe('asNumberListInput', () => {
	it('flattens an array into the comma form the parser expects', () => {
		expect(asNumberListInput([0, 1])).toBe('0,1');
		expect(asNumberListInput([0.1, 0.2, 0.3])).toBe('0.1,0.2,0.3');
		expect(asNumberListInput(['0', ' 1 '])).toBe('0,1');
	});

	it('turns a lone number into a one-entry list', () => {
		expect(asNumberListInput(0)).toBe('0');
		expect(asNumberListInput(1.5708)).toBe('1.5708');
	});

	it('passes a string through and reduces anything else to empty', () => {
		expect(asNumberListInput('0,1')).toBe('0,1');
		expect(asNumberListInput(null)).toBe('');
		expect(asNumberListInput(undefined)).toBe('');
		expect(asNumberListInput({})).toBe('');
	});
});

describe('the circuit builder accepts what an expression produces', () => {
	const build = (gate: Record<string, unknown>, numQubits = 2) => {
		const { ctx } = makeExecuteContext({
			params: { numQubits, numClbits: 2, gates: { gate: [gate] } },
		});
		return () => handleCircuitBuild.call(ctx, 0);
	};

	it('takes an array of qubit indices', () => {
		expect(build({ gate: 'cx', qubits: [0, 1] })().qasm3).toContain('cx q[0], q[1];');
	});

	it('takes a lone number as a single index', () => {
		expect(build({ gate: 'x', qubits: 0 })().qasm3).toContain('x q[0];');
	});

	it('takes a lone number as a single parameter', () => {
		expect(build({ gate: 'rx', qubits: '0', params: 1.5708 })().qasm3).toContain('rx(1.5708)');
	});

	it('takes an array of parameters', () => {
		expect(build({ gate: 'u', qubits: '0', params: [0.1, 0.2, 0.3] })().qasm3).toContain(
			'U(0.1, 0.2, 0.3)',
		);
	});

	it('never surfaces the internal trim error', () => {
		for (const gate of [
			{ gate: 'cx', qubits: [0, 1] },
			{ gate: 'rx', qubits: '0', params: 1.5708 },
			{ gate: 'u', qubits: '0', params: [0.1, 0.2, 0.3] },
		]) {
			expect(build(gate)).not.toThrow(/trim is not a function/);
		}
	});

	it('keeps every guard working on array input', () => {
		expect(build({ gate: 'cx', qubits: [1, 1] })).toThrow(/more than once/);
		expect(build({ gate: 'x', qubits: [5] })).toThrow(/qubit index 5/);
		expect(build({ gate: 'x', qubits: ['abc'] })).toThrow(/is not a valid number/);
	});

	it('still treats a missing field as no values', () => {
		expect(build({ gate: 'x', qubits: null })).toThrow(/expects 1 qubit index/);
	});
});

// Set Cost Limit removes the instance spend cap when it sends null. A value the node cannot read
// must therefore fail rather than fall through to that, which is the opposite of the intent.
describe('Set Cost Limit never clears the cap by accident', () => {
	const setLimit = (instanceLimit: unknown) => {
		const { ctx, requests } = makeExecuteContext({ params: { instanceLimit }, http: () => ({}) });
		return { run: () => handleAccount.call(ctx, TEST_CTX, 'setCostLimit', 0), requests };
	};

	it.each([['abc'], [''], ['   '], [null], [-5], [1.5], [[]], [false], [{}]])(
		'refuses %s instead of sending instance_limit null',
		async (given) => {
			const { run, requests } = setLimit(given);
			await expect(run()).rejects.toThrow(/Cost Limit must be an integer at least 0/);
			expect(requests).toHaveLength(0);
		},
	);

	it('clears the cap only for a deliberate zero', async () => {
		const { run, requests } = setLimit(0);
		await run();
		expect((requests[0] as HttpCall).body).toEqual({ instance_limit: null });
	});

	it('sets the cap for a positive value', async () => {
		const { run, requests } = setLimit(600);
		await run();
		expect((requests[0] as HttpCall).body).toEqual({ instance_limit: 600 });
	});

	it('accepts numeric text from an expression', async () => {
		const { run, requests } = setLimit('600');
		await run();
		expect((requests[0] as HttpCall).body).toEqual({ instance_limit: 600 });
	});
});

// encodeURIComponent leaves a dot alone because it is unreserved, and URL resolution then removes
// the segment: /api/v1/jobs/.. resolves to /api/v1/. Encoding does not help either, since Node's
// URL decodes %2E before removing dot segments. Such a value is refused instead.
describe('an identifier of nothing but dots is refused', () => {
	it.each([['..'], ['.'], ['...'], ['....']])('refuses a Job ID of %s', async (given) => {
		const { ctx, requests } = makeExecuteContext({ params: { jobId: given } });
		await expect(handleJob.call(ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
			/is not a valid identifier/,
		);
		expect(requests).toHaveLength(0);
	});

	it('refuses it on every identifier, not just the job', async () => {
		const session = makeExecuteContext({ params: { sessionId: '..' } });
		await expect(handleSession.call(session.ctx, TEST_CTX, 'get', 0)).rejects.toThrow(
			/Session ID "\.\." is not a valid identifier/,
		);
		const backend = makeExecuteContext({ params: { backendName: '..' } });
		await expect(handleBackend.call(backend.ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
			/Backend Name "\.\." is not a valid identifier/,
		);
	});

	// Only a segment that is ENTIRELY dots is meaningless; a dot inside a value is ordinary.
	it.each([['job.1'], ['..a'], ['a..'], ['da24v6iein7c73be57eg']])(
		'still accepts %s',
		async (given) => {
			const { ctx, requests } = makeExecuteContext({
				params: { jobId: given },
				http: () => ({ id: given }),
			});
			await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
			expect((requests[0] as HttpCall).url).toBe(`${TEST_CTX.baseUrl}/jobs/${given}`);
		},
	);

	it('leaves a traversal with a separator as one encoded segment', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: '../backends' },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		const url = new URL((requests[0] as HttpCall).url as string);
		expect(url.pathname).toBe('/api/v1/jobs/..%2Fbackends');
	});
});

// String.length counts UTF-16 code units, so one emoji counts as two. JSON Schema minLength and
// maxLength count characters, and that is what IBM validates against.
describe('lengths are counted in characters, not UTF-16 units', () => {
	const EMOJI = '\u{1F600}';

	it('characterLength counts code points', () => {
		expect(EMOJI.length).toBe(2);
		expect(characterLength(EMOJI)).toBe(1);
		expect(characterLength(EMOJI.repeat(86))).toBe(86);
		expect(characterLength('abc')).toBe(3);
		expect(characterLength('')).toBe(0);
	});

	it('accepts a tag of 86 emoji, which IBM accepts too', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'j1', jobTags: EMOJI.repeat(86) },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'updateTags', 0);
		expect(requests).toHaveLength(1);
	});

	it('still refuses a tag of 87 characters', async () => {
		const { ctx } = makeExecuteContext({ params: { jobId: 'j1', jobTags: EMOJI.repeat(87) } });
		await expect(handleJob.call(ctx, TEST_CTX, 'updateTags', 0)).rejects.toThrow(
			/is 87 characters; IBM accepts at most 86/,
		);
	});

	it('refuses a 2-emoji search, which IBM would answer with a bare 400', async () => {
		const { ctx } = makeExecuteContext({ params: { tagSearch: EMOJI.repeat(2) } });
		await expect(handleJob.call(ctx, TEST_CTX, 'listTags', 0)).rejects.toThrow(
			/between 3 and 100 characters/,
		);
	});

	it('accepts a 3-emoji search', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { tagSearch: EMOJI.repeat(3) },
			http: () => ({}),
		});
		await handleJob.call(ctx, TEST_CTX, 'listTags', 0);
		expect(requests).toHaveLength(1);
	});

	it('still refuses a 101-character search', async () => {
		const { ctx } = makeExecuteContext({ params: { tagSearch: EMOJI.repeat(101) } });
		await expect(handleJob.call(ctx, TEST_CTX, 'listTags', 0)).rejects.toThrow(
			/between 3 and 100 characters/,
		);
	});
});

// encodeURIComponent throws URIError on an unpaired surrogate, which used to reach the user as a
// NodeApiError reading "URI malformed" with nothing naming the parameter.
describe('an identifier that is not valid text is refused by name', () => {
	it.each([['\uD800'], ['\uDC00'], ['ab\uD800cd'], ['\uDFFFx']])(
		'refuses an unpaired surrogate',
		async (given) => {
			const { ctx, requests } = makeExecuteContext({ params: { jobId: given } });
			await expect(handleJob.call(ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
				/Job ID contains an unpaired surrogate and is not valid text/,
			);
			expect(requests).toHaveLength(0);
		},
	);

	it('still accepts text with real emoji, which encode fine', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'job-\u{1F600}' },
			http: () => ({ id: 'x' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		expect((requests[0] as HttpCall).url).toContain('%F0%9F%98%80');
	});

	it('applies to every identifier', async () => {
		const session = makeExecuteContext({ params: { sessionId: '\uD800' } });
		await expect(handleSession.call(session.ctx, TEST_CTX, 'get', 0)).rejects.toThrow(
			/Session ID contains an unpaired surrogate/,
		);
		const backend = makeExecuteContext({ params: { backendName: '\uD800' } });
		await expect(handleBackend.call(backend.ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
			/Backend Name contains an unpaired surrogate/,
		);
	});
});

describe('optional submit fields are coerced, not cast', () => {
	const submit = async (extra: Record<string, unknown>) => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				circuitFormat: 'qasm3',
				qasm3: 'OPENQASM 3.0;\nqubit[1] q;',
				shots: 1,
				...extra,
			},
			http: () => ({ id: 'j1' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitSampler', 0);
		return (requests[0] as HttpCall).body as Record<string, unknown>;
	};

	// The schema types session_id as a string; a numeric expression used to put a JSON number there.
	it('sends a numeric session id as text', async () => {
		expect((await submit({ submitSessionId: 12345 })).session_id).toBe('12345');
	});

	it('trims a padded session id', async () => {
		expect((await submit({ submitSessionId: '  abc-123  ' })).session_id).toBe('abc-123');
	});

	it.each([[''], [null], [{}], [[]]])('omits session_id for %s', async (given) => {
		expect(await submit({ submitSessionId: given })).not.toHaveProperty('session_id');
	});
});

// The schema types layer_pair_depths as an array of integers. A fraction went through unchanged,
// and Infinity reached IBM as JSON null because JSON cannot represent it.
describe('Layer Pair Depths must be whole numbers', () => {
	const submitLearner = async (layerPairDepths: unknown) => {
		const { ctx, requests } = makeExecuteContext({
			params: {
				backend: 'ibm_kingston',
				circuitFormat: 'qasm3',
				qasm3: 'OPENQASM 3.0;\nqubit[1] q;',
				noiseLearnerOptions: { layerPairDepths },
			},
			http: () => ({ id: 'j1' }),
		});
		await handleJob.call(ctx, TEST_CTX, 'submitNoiseLearner', 0);
		const body = (requests[0] as HttpCall).body as {
			params: { options?: { layer_pair_depths?: number[] } };
		};
		return body.params.options?.layer_pair_depths;
	};

	it.each([['1.5'], ['Infinity'], ['1e400'], ['0,2.5']])('refuses %s', async (given) => {
		await expect(submitLearner(given)).rejects.toThrow(/must be whole numbers/);
	});

	it('accepts the documented default shape', async () => {
		expect(await submitLearner('0,1,2,4,16,32')).toEqual([0, 1, 2, 4, 16, 32]);
	});

	it('accepts an array or a lone number from an expression', async () => {
		expect(await submitLearner([0, 1, 2])).toEqual([0, 1, 2]);
		expect(await submitLearner(16)).toEqual([16]);
	});

	it('omits the option entirely when the field is empty', async () => {
		expect(await submitLearner('')).toBeUndefined();
	});
});

// The spec bounds every path id to 500 characters. Percent-encoding multiplies the length again,
// so a runaway expression built a multi-megabyte URL and sent it.
describe('an identifier longer than the spec allows is refused', () => {
	it('accepts exactly the maximum', async () => {
		const id = 'a'.repeat(MAX_IDENTIFIER_LENGTH);
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: id },
			http: () => ({ id }),
		});
		await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		expect(requests).toHaveLength(1);
	});

	it('refuses one character past it, before any request', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'a'.repeat(MAX_IDENTIFIER_LENGTH + 1) },
		});
		await expect(handleJob.call(ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
			new RegExp(`Job ID is ${MAX_IDENTIFIER_LENGTH + 1} characters`),
		);
		expect(requests).toHaveLength(0);
	});

	// The spec is not uniform: /jobs/{id} allows 1000, /backends/{id} allows 500, and
	// /sessions/{id} declares no bound. The node takes the loosest, so it never refuses
	// something IBM would have accepted.
	it('takes the loosest bound the spec documents', () => {
		expect(MAX_IDENTIFIER_LENGTH).toBe(1000);
	});

	it('refuses a megabyte identifier without building the URL', async () => {
		const { ctx, requests } = makeExecuteContext({ params: { jobId: 'a'.repeat(1_048_576) } });
		await expect(handleJob.call(ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
			/longer than the 1000 this node allows/,
		);
		expect(requests).toHaveLength(0);
	});

	it('counts characters, so emoji are not penalised twice', async () => {
		const id = '\u{1F600}'.repeat(MAX_IDENTIFIER_LENGTH);
		const { ctx, requests } = makeExecuteContext({ params: { jobId: id }, http: () => ({}) });
		await handleJob.call(ctx, TEST_CTX, 'getStatus', 0);
		expect(requests).toHaveLength(1);
	});

	it('applies to every identifier', async () => {
		const long = 'a'.repeat(MAX_IDENTIFIER_LENGTH + 1);
		const session = makeExecuteContext({ params: { sessionId: long } });
		await expect(handleSession.call(session.ctx, TEST_CTX, 'get', 0)).rejects.toThrow(
			/Session ID is 1001 characters/,
		);
		const backend = makeExecuteContext({ params: { backendName: long } });
		await expect(handleBackend.call(backend.ctx, TEST_CTX, 'getStatus', 0)).rejects.toThrow(
			/Backend Name is 1001 characters/,
		);
	});
});

// Update Tags PUTs the whole list, so an empty result deletes every tag on the job. Text and arrays
// can say that deliberately; a null or an object means the expression did not resolve to a tag list.
describe('Update Tags will not wipe a job because an expression failed', () => {
	const update = (jobTags: unknown) => {
		const { ctx, requests } = makeExecuteContext({
			params: { jobId: 'job-1', jobTags },
			http: () => ({}),
		});
		return { run: () => handleJob.call(ctx, TEST_CTX, 'updateTags', 0), requests };
	};

	it.each([[null], [{}], [true], [false]])('refuses %s instead of clearing the tags', async (given) => {
		const { run, requests } = update(given);
		await expect(run()).rejects.toThrow(/Tags must be text or a list/);
		expect(requests).toHaveLength(0);
	});

	it.each([[''], ['   '], [[]]])('still clears on a deliberate empty value: %s', async (given) => {
		const { run, requests } = update(given);
		await run();
		expect((requests[0] as HttpCall).body).toEqual({ tags: [] });
	});

	it('still writes a real list', async () => {
		const { run, requests } = update(['keep-me', 'and-me']);
		await run();
		expect((requests[0] as HttpCall).body).toEqual({ tags: ['keep-me', 'and-me'] });
	});

	// A filter has no destructive meaning, so an unusable value there is simply no filter.
	it('leaves the tag FILTER permissive, since an empty filter is harmless', async () => {
		const { ctx, requests } = makeExecuteContext({
			params: { listFilters: { tag: null }, limit: 5 },
			http: () => ({ jobs: [] }),
		});
		await handleJob.call(ctx, TEST_CTX, 'list', 0);
		expect((requests[0] as HttpCall).qs).not.toHaveProperty('tags');
	});
});
