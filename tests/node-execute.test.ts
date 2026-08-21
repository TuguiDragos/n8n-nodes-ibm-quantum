import { describe, expect, it } from 'vitest';

import { IbmQuantum } from '../nodes/IbmQuantum/IbmQuantum.node';
import { fakeNode, type HttpCall } from './fakeContext';

// These cover the node wrapper itself: per-item indexing, pairedItem, continue-on-fail and the
// @version gate. All four were reachable only through execute(), so none was covered before.

interface RunOptions {
	items: number;
	perItem?: Array<Record<string, unknown>>;
	shared?: Record<string, unknown>;
	continueOnFail?: boolean;
	typeVersion?: number;
	respond?: (call: HttpCall, index: number) => unknown;
}

function run(opts: RunOptions) {
	const requests: HttpCall[] = [];
	const node = fakeNode(opts.typeVersion ?? 2);
	const ctx = {
		getInputData: () => Array.from({ length: opts.items }, (_, i) => ({ json: { i } })),
		getNode: () => node,
		continueOnFail: () => opts.continueOnFail ?? false,
		logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
		getCredentials: async () => ({ region: 'us-east', apiVersion: '2026-04-15' }),
		getNodeParameter: (name: string, itemIndex?: number, fallback?: unknown) => {
			const per = opts.perItem?.[itemIndex ?? 0];
			if (per && name in per) return per[name];
			const shared = opts.shared ?? {};
			return name in shared ? shared[name] : fallback;
		},
		helpers: {
			httpRequestWithAuthentication: async (_name: string, options: HttpCall) => {
				requests.push(options);
				return opts.respond ? opts.respond(options, requests.length - 1) : {};
			},
		},
	};
	return new IbmQuantum().execute
		.call(ctx as never)
		.then((out) => ({ out: out as Array<Array<{ json: unknown; pairedItem?: unknown }>>, requests }));
}

describe('the node processes every input item, not just the first', () => {
	it('makes one request per item, reading that item own parameters', async () => {
		const { out, requests } = await run({
			items: 3,
			shared: { resource: 'job', operation: 'getStatus' },
			perItem: [{ jobId: 'a1' }, { jobId: 'b2' }, { jobId: 'c3' }],
			respond: (call) => ({ id: String(call.url).split('/').pop() }),
		});
		expect(requests).toHaveLength(3);
		expect(requests.map((r) => String(r.url).split('/').pop())).toEqual(['a1', 'b2', 'c3']);
		expect(out[0]).toHaveLength(3);
	});

	it('tags every output item with the input item it came from', async () => {
		const { out } = await run({
			items: 4,
			shared: { resource: 'job', operation: 'getStatus' },
			perItem: [{ jobId: 'a' }, { jobId: 'b' }, { jobId: 'c' }, { jobId: 'd' }],
			respond: () => ({ ok: true }),
		});
		expect(out[0].map((item) => item.pairedItem)).toEqual([
			{ item: 0 },
			{ item: 1 },
			{ item: 2 },
			{ item: 3 },
		]);
	});

	it('builds a circuit per item without collapsing them', async () => {
		const { out } = await run({
			items: 2,
			shared: { resource: 'circuit', operation: 'build', numClbits: 0, gates: {} },
			perItem: [{ numQubits: 1 }, { numQubits: 3 }],
		});
		expect((out[0][0].json as { numQubits: number }).numQubits).toBe(1);
		expect((out[0][1].json as { numQubits: number }).numQubits).toBe(3);
	});
});

describe('continue on fail isolates a failing item', () => {
	it('emits an error item in place and keeps processing the rest', async () => {
		const { out } = await run({
			items: 3,
			continueOnFail: true,
			shared: { resource: 'circuit', operation: 'build', numClbits: 1, gates: {} },
			// The middle item asks for an impossible register.
			perItem: [{ numQubits: 1 }, { numQubits: 0 }, { numQubits: 2 }],
		});
		expect(out[0]).toHaveLength(3);
		expect((out[0][0].json as { numQubits: number }).numQubits).toBe(1);
		expect((out[0][1].json as { error?: string }).error).toMatch(/at least 1/);
		expect((out[0][2].json as { numQubits: number }).numQubits).toBe(2);
	});

	it('keeps the failing item pointed at its own input index', async () => {
		const { out } = await run({
			items: 3,
			continueOnFail: true,
			shared: { resource: 'circuit', operation: 'build', numClbits: 1, gates: {} },
			perItem: [{ numQubits: 1 }, { numQubits: 0 }, { numQubits: 2 }],
		});
		expect(out[0][1].pairedItem).toEqual({ item: 1 });
	});

	it('aborts the whole run when continue on fail is off', async () => {
		await expect(
			run({
				items: 2,
				continueOnFail: false,
				shared: { resource: 'circuit', operation: 'build', numClbits: 1, gates: {} },
				perItem: [{ numQubits: 0 }, { numQubits: 2 }],
			}),
		).rejects.toThrow(/at least 1/);
	});

	it('reports an unknown resource rather than guessing one', async () => {
		const { out } = await run({
			items: 1,
			continueOnFail: true,
			shared: { resource: 'nonsense', operation: 'list' },
		});
		expect((out[0][0].json as { error?: string }).error).toMatch(/Unsupported resource: nonsense/);
	});

	it('reports an unknown circuit operation rather than falling through to build', async () => {
		const { out } = await run({
			items: 1,
			continueOnFail: true,
			shared: { resource: 'circuit', operation: 'transpile' },
		});
		expect((out[0][0].json as { error?: string }).error).toMatch(
			/Unsupported circuit operation: transpile/,
		);
	});
});

// Version 2 renamed the session parameter because n8n's MCP server drops any parameter called
// `mode`. Both must keep working, and neither may read the other.
describe('the @version gate keeps mode and sessionMode apart', () => {
	const sessionParams = { resource: 'session', operation: 'create', sessionBackend: 'ibm_kingston' };

	it('version 1 sends the value stored under mode', async () => {
		const { requests } = await run({
			items: 1,
			typeVersion: 1,
			shared: { ...sessionParams, mode: 'dedicated' },
			respond: () => ({ id: 's1' }),
		});
		expect((requests[0].body as { mode: string }).mode).toBe('dedicated');
	});

	it('version 2 sends the value stored under sessionMode', async () => {
		const { requests } = await run({
			items: 1,
			typeVersion: 2,
			shared: { ...sessionParams, sessionMode: 'dedicated' },
			respond: () => ({ id: 's1' }),
		});
		expect((requests[0].body as { mode: string }).mode).toBe('dedicated');
	});

	it('version 2 ignores a stale mode left over from a version 1 workflow', async () => {
		const { requests } = await run({
			items: 1,
			typeVersion: 2,
			shared: { ...sessionParams, mode: 'dedicated' },
			respond: () => ({ id: 's1' }),
		});
		expect((requests[0].body as { mode: string }).mode).toBe('batch');
	});

	it('version 1 ignores sessionMode, which it cannot have stored', async () => {
		const { requests } = await run({
			items: 1,
			typeVersion: 1,
			shared: { ...sessionParams, sessionMode: 'dedicated' },
			respond: () => ({ id: 's1' }),
		});
		expect((requests[0].body as { mode: string }).mode).toBe('batch');
	});
});
