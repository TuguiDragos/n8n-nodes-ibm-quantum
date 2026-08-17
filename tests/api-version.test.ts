import { describe, expect, it } from 'vitest';

import { IbmQuantum } from '../nodes/IbmQuantum/IbmQuantum.node';
import { checkApiVersion, CURRENT_API_VERSION } from '../nodes/IbmQuantum/transport';
import { pollJobs } from '../nodes/IbmQuantum/triggerPoll';
import { fakeNode, type HttpCall } from './fakeContext';

describe('checkApiVersion', () => {
	it('accepts the current version and anything newer', () => {
		expect(checkApiVersion(CURRENT_API_VERSION)).toBeNull();
		expect(checkApiVersion('2027-01-01')).toBeNull();
	});

	it('ignores surrounding whitespace', () => {
		expect(checkApiVersion(`  ${CURRENT_API_VERSION}  `)).toBeNull();
	});

	it('is fatal when the value is missing, blank or not a string', () => {
		for (const value of [undefined, null, '', '   ', 20260415]) {
			expect(checkApiVersion(value)).toMatchObject({ fatal: true });
		}
	});

	it('is fatal for anything that is not a YYYY-MM-DD date', () => {
		for (const value of ['latest', '2026/04/15', '26-04-15', '2026-4-15']) {
			expect(checkApiVersion(value)).toMatchObject({ fatal: true });
		}
	});

	it('is fatal for a date the calendar does not have', () => {
		// The pattern alone accepts these; Date would roll 2026-02-31 forward to 2026-03-03 and
		// carry the typo into every request instead of naming it.
		expect(checkApiVersion('2026-02-31')).toMatchObject({ fatal: true });
		expect(checkApiVersion('2026-13-01')).toMatchObject({ fatal: true });
	});

	it('warns without failing for a deprecated version that still answers', () => {
		const problem = checkApiVersion('2025-05-01');
		expect(problem).toMatchObject({ fatal: false });
		expect(problem?.message).toContain(CURRENT_API_VERSION);
	});
});

describe('the API version guard on the polling path', () => {
	const pollWith = (apiVersion: unknown) => {
		const requests: HttpCall[] = [];
		const ctx = {
			getCredentials: async () => ({ region: 'us-east', apiVersion }),
			getMode: () => 'trigger',
			getNode: () => fakeNode(),
			getWorkflowStaticData: () => ({}),
			helpers: {
				httpRequestWithAuthentication: async (_name: string, options: HttpCall) => {
					requests.push(options);
					return { jobs: [] };
				},
				returnJsonArray: (data: unknown[]) => data,
			},
		};
		return { run: () => pollJobs(ctx as never, 50, () => true, (job) => job), requests };
	};

	it('refuses to poll on a malformed version, before any request goes out', async () => {
		const { run, requests } = pollWith('nonsense');
		await expect(run()).rejects.toThrow(/not a YYYY-MM-DD date/);
		expect(requests).toHaveLength(0);
	});

	it('still polls on a deprecated version, which IBM continues to accept', async () => {
		const { run, requests } = pollWith('2025-05-01');
		await expect(run()).resolves.toBeNull();
		expect(requests).toHaveLength(1);
	});
});

describe('the API version guard on the execute path', () => {
	const runNode = (apiVersion: unknown, logs: string[] = []) => {
		const params: Record<string, unknown> = { resource: 'backend', operation: 'list' };
		const ctx = {
			getInputData: () => [{ json: {} }],
			getNode: () => fakeNode(),
			continueOnFail: () => false,
			logger: { warn: (message: string) => logs.push(message) },
			getCredentials: async () => ({ region: 'us-east', apiVersion }),
			getNodeParameter: (name: string, _itemIndex?: number, fallback?: unknown) =>
				name in params ? params[name] : fallback,
			helpers: { httpRequestWithAuthentication: async () => ({ devices: [] }) },
		};
		return new IbmQuantum().execute.call(ctx as never);
	};

	it('fails the run on a malformed version', async () => {
		await expect(runNode('nonsense')).rejects.toThrow(/not a YYYY-MM-DD date/);
	});

	it('logs one warning and still runs on a deprecated version', async () => {
		const logs: string[] = [];
		const result = await runNode('2025-05-01', logs);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain('deprecated');
		expect(result[0]).toHaveLength(1);
	});
});
