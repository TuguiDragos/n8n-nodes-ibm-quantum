import { describe, expect, it } from 'vitest';

import { nodeProperties } from '../nodes/IbmQuantum/descriptions';
import { IbmQuantum } from '../nodes/IbmQuantum/IbmQuantum.node';
import { fakeNode, type HttpCall } from './fakeContext';

// The node dispatches on `resource` before any handler sees the operation. Two resources answer to
// the operation name `list`, so a routing mistake would not fail: it would quietly return the wrong
// collection. These tests pin the resource-to-endpoint mapping.
function runResource(
	resource: string,
	operation: string,
	params: Record<string, unknown> = {},
	respond: () => unknown = () => ({}),
) {
	const requests: HttpCall[] = [];
	const all: Record<string, unknown> = { resource, operation, ...params };
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNode: () => fakeNode(),
		continueOnFail: () => false,
		logger: { warn: () => {} },
		getCredentials: async () => ({ region: 'us-east', apiVersion: '2026-04-15' }),
		getNodeParameter: (name: string, _itemIndex?: number, fallback?: unknown) =>
			name in all ? all[name] : fallback,
		helpers: {
			httpRequestWithAuthentication: async (_name: string, options: HttpCall) => {
				requests.push(options);
				return respond();
			},
		},
	};
	return new IbmQuantum().execute.call(ctx as never).then(() => requests);
}

describe('resource routing', () => {
	it('sends Workload List to /workloads, not to the jobs listing', async () => {
		const requests = await runResource('workload', 'list');
		expect(requests[0].url).toContain('/workloads');
		expect(requests[0].url).not.toContain('/jobs');
	});

	it('sends Job List to /jobs', async () => {
		const requests = await runResource('job', 'list');
		expect(requests[0].url).toMatch(/\/jobs$/);
	});

	it.each([
		['backend', 'list', '/backends'],
		['account', 'getUsage', '/instances/usage'],
		['session', 'get', '/sessions/sess-1'],
	])('routes %s %s to %s', async (resource, operation, expected) => {
		const requests = await runResource(resource, operation, { sessionId: 'sess-1' });
		expect(requests[0].url).toContain(expected);
	});

	it('builds a circuit without touching the API', async () => {
		const requests = await runResource('circuit', 'build', {
			numQubits: 1,
			numClbits: 0,
			gates: { gate: [{ gate: 'x', qubits: '0' }] },
		});
		expect(requests).toHaveLength(0);
	});

	it('refuses a resource it does not know instead of falling through to a job operation', async () => {
		await expect(runResource('instance', 'list')).rejects.toThrow(/Unsupported resource: instance/);
	});
});

// Reads the operation lists straight out of the UI schema, so an operation added to the picker
// without a matching route fails here instead of reaching a user as "Unsupported operation".
function advertisedOperations(resource: string): string[] {
	const property = nodeProperties.find(
		(p) =>
			p.name === 'operation' &&
			((p.displayOptions?.show?.resource ?? []) as string[]).includes(resource),
	);
	return ((property?.options ?? []) as Array<{ value: string }>).map((option) => option.value);
}

const RESOURCES = ((nodeProperties[0]?.options ?? []) as Array<{ value: string }>).map(
	(option) => option.value,
);

describe('every operation the UI advertises is routed', () => {
	// One superset of parameters, so each operation finds whatever it requires.
	const PARAMS = {
		backendName: 'ibm_fez',
		backend: 'ibm_fez',
		sessionBackend: 'ibm_fez',
		qasm3: 'OPENQASM 3.0;\nqubit[1] q;',
		qasm3Input: 'OPENQASM 3.0;\nqubit[1] q;',
		observables: '"Z"',
		jobId: 'job-1',
		sessionId: 'sess-1',
		tagSearch: 'qa-run',
		numQubits: 1,
		numClbits: 1,
		gates: { gate: [{ gate: 'x', qubits: '0' }] },
		pollInterval: 1,
		maxWait: 1,
	};

	it('covers all six resources', () => {
		expect(RESOURCES).toEqual(['account', 'backend', 'circuit', 'job', 'session', 'workload']);
	});

	it.each(RESOURCES)('%s', async (resource) => {
		const operations = advertisedOperations(resource);
		expect(operations.length).toBeGreaterThan(0);
		for (const operation of operations) {
			// A terminal status keeps Get Results from polling, and satisfies every other reader.
			await expect(
				runResource(resource, operation, PARAMS, () => ({
					state: { status: 'completed' },
					results: [],
					devices: [],
				})),
			).resolves.toBeDefined();
		}
	});
});
