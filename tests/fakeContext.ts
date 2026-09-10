import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { CURRENT_API_VERSION } from '../nodes/IbmQuantum/transport';

// A minimal IExecuteFunctions stand-in for unit-testing the operation handlers. getNodeParameter
// reads from a flat params map (falling back to the handler's default), and every API call made
// through helpers.httpRequestWithAuthentication is recorded so a test can assert the exact
// method, endpoint, body and query string the handler built.

export interface HttpCall {
	method?: string;
	url?: string;
	body?: unknown;
	qs?: unknown;
	[key: string]: unknown;
}

export interface FakeContextOptions {
	params?: Record<string, unknown>;
	credentials?: Record<string, unknown>;
	// Defaults to 1, so the existing suite keeps proving that version 1 workflows still run.
	typeVersion?: number;
	// Return the response body for a request; receives the recorded call and its zero-based index.
	http?: (call: HttpCall, callIndex: number) => unknown;
	// n8n returns true here when the user ticked "Continue on Fail". Hardcoding false made the
	// whole continue-on-fail path unreachable from the suite.
	continueOnFail?: boolean;
	// Per-item parameter values, keyed by item index; falls back to `params` when absent. Needed to
	// drive the node with more than one input item.
	itemParams?: Array<Record<string, unknown>>;
}

export const TEST_CTX = { baseUrl: 'https://quantum.cloud.ibm.com/api/v1' };

// The account id inside TEST_CRN, which is the path segment GET /accounts/{id} is called with.
export const TEST_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';

// One instance CRN for every test that needs the credential's `instanceCrn`: account scoped, with
// the id above as its seventh colon-separated field.
export const TEST_CRN = `crn:v1:bluemix:public:quantum-computing:us-east:a/${TEST_ACCOUNT_ID}:0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b::`;

// Every OpenQASM 3 submit reads the backend configuration before posting the job, so the POST
// is never the first call. Find it rather than assume its position.
export function jobPost(requests: HttpCall[]): HttpCall {
	return requests.find(
		(call) => call.method === 'POST' && String(call.url).endsWith('/jobs'),
	) as HttpCall;
}

export function fakeNode(typeVersion = 1): INode {
	return {
		name: 'IBM Quantum',
		type: 'ibmQuantum',
		typeVersion,
		position: [0, 0],
		parameters: {},
	} as INode;
}

export function makeExecuteContext(opts: FakeContextOptions = {}): {
	ctx: IExecuteFunctions;
	requests: HttpCall[];
} {
	const params = opts.params ?? {};
	const requests: HttpCall[] = [];
	const respond = opts.http ?? (() => ({}));
	const node = fakeNode(opts.typeVersion ?? 1);

	const ctx = {
		getNode: () => node,
		continueOnFail: () => opts.continueOnFail ?? false,
		logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
		getCredentials: async () =>
			opts.credentials ?? { region: 'us-east', apiVersion: CURRENT_API_VERSION },
		getNodeParameter: (name: string, itemIndex?: number, fallback?: unknown) => {
			const perItem = opts.itemParams?.[itemIndex ?? 0];
			if (perItem && name in perItem) return perItem[name];
			return name in params ? params[name] : fallback;
		},
		helpers: {
			// The credential name is recorded, not discarded: a wrong identifier in transport.ts or
			// triggerPoll.ts would otherwise pass every test while failing at runtime.
			httpRequestWithAuthentication: async (credName: string, options: HttpCall) => {
				requests.push({ ...options, credentialName: credName });
				return respond(options, requests.length - 1);
			},
		},
	} as unknown as IExecuteFunctions;

	return { ctx, requests };
}
