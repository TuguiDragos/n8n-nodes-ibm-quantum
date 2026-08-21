import {
	NodeApiError,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type INode,
	type JsonObject,
} from 'n8n-workflow';

export interface RequestContext {
	baseUrl: string;
}

// Region hosts are the single source of truth for the API base. The credential test mirrors
// this mapping in a static expression; a unit test asserts the two stay in sync (see
// tests/credentials.test.ts) so adding a region without a host fails CI instead of silently
// falling back to us-east.
export const QUANTUM_HOST_US = 'https://quantum.cloud.ibm.com';
export const QUANTUM_HOST_EU = 'https://eu-de.quantum.cloud.ibm.com';

export const REGION_HOSTS: Record<string, string> = {
	'us-east': QUANTUM_HOST_US,
	'eu-de': QUANTUM_HOST_EU,
};

export function getBaseUrl(region: string): string {
	const host = REGION_HOSTS[region] ?? REGION_HOSTS['us-east'];
	return `${host}/api/v1`;
}

// The oldest IBM-API-Version that is not deprecated. Every earlier version still answers today but
// carries a published 2027 sunset date.
export const CURRENT_API_VERSION = '2026-04-15';

export interface ApiVersionProblem {
	fatal: boolean;
	message: string;
}

// A malformed version is fatal, because it reaches IBM as a header it cannot parse and the error
// that comes back names neither the field nor the cause. A deprecated but well-formed date only
// warns: those versions still answer, so refusing them would break a working credential years
// before IBM stops accepting it.
export function checkApiVersion(value: unknown): ApiVersionProblem | null {
	const version = typeof value === 'string' ? value.trim() : '';
	if (!version) {
		return {
			fatal: true,
			message: `The credential has no API Version. Set it to ${CURRENT_API_VERSION}.`,
		};
	}
	const date = /^\d{4}-\d{2}-\d{2}$/.test(version) ? new Date(`${version}T00:00:00Z`) : null;
	// Compare the round trip, so a date the pattern accepts but the calendar does not (2026-02-31,
	// which rolls forward to March) is rejected rather than silently shifted.
	const isRealDate =
		date !== null && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === version;
	if (!isRealDate) {
		return {
			fatal: true,
			message: `The credential's API Version "${version}" is not a YYYY-MM-DD date. Use ${CURRENT_API_VERSION}.`,
		};
	}
	if (version < CURRENT_API_VERSION) {
		return {
			fatal: false,
			message: `The credential's API Version ${version} is deprecated and IBM has scheduled it for removal. Update it to ${CURRENT_API_VERSION}.`,
		};
	}
	return null;
}

// A catch binding is typed `unknown`, so reading a message needs both arms even where only an
// Error is ever thrown.
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// Preserve the context-rich errors raised downstream and wrap only raw ones, so a failure always
// reaches the user as a node error rather than a bare exception.
export function asNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeApiError(node, error as JsonObject, itemIndex === undefined ? {} : { itemIndex });
}

// Guard against a hung connection stalling the execution.
const REQUEST_TIMEOUT_MS = 30000;

// Auth (IAM bearer token plus Service-CRN and IBM-API-Version headers) is injected by the
// credential's preAuthentication and authenticate hooks, so none is set here and the token
// refreshes on a 401.
export async function ibmQuantumApiRequest(
	this: IExecuteFunctions,
	ctx: RequestContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${ctx.baseUrl}${endpoint}`,
		json: true,
		timeout: REQUEST_TIMEOUT_MS,
		// IBM expects a repeated key for array query parameters (tags=a&tags=b), which is what the
		// official client sends. n8n's default encodes them as tags[0]= or tags[]=, which the API
		// does not recognise and silently ignores, so a tag filter would quietly return everything.
		arrayFormat: 'repeat',
	};
	if (body !== undefined) options.body = body;
	if (qs !== undefined) options.qs = qs;

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'ibmQuantumApi',
			options,
		);
		// A 204, or any empty body, arrives here as null. Passing that on would put `json: null`
		// into the workflow, which n8n's execution engine dereferences without a null check and
		// crashes the whole run on. It also protects the handlers that read a field off the
		// response, such as getLeastBusy and submitJob.
		return (response ?? {}) as IDataObject;
	} catch (error) {
		throw enrichApiError(this.getNode(), error);
	}
}

export interface IbmErrorDetail {
	message: string;
	solution?: string;
}

// IBM error bodies look like { errors: [{ code, message, solution, more_info }], trace }.
// n8n's NodeApiError only inspects data.message / data.error.message, so it never reads the
// errors[] array and falls back to a generic "Bad request". Pull the real message back out.
// On a thrown request error n8n stores the parsed body on the error's context.data; the
// response/cause paths are defensive fallbacks for other error origins. Read by shape, not by
// class: at runtime n8n's NodeApiError comes from a different module copy than ours, so an
// instanceof check against our import would be false.
export function extractIbmError(error: unknown): IbmErrorDetail | null {
	const err = error as {
		context?: { data?: unknown };
		response?: { data?: unknown };
		cause?: { response?: { data?: unknown } };
	} | null;
	if (!err || typeof err !== 'object') return null;
	const data = (err.context?.data ?? err.response?.data ?? err.cause?.response?.data) as
		{ errors?: unknown; error?: unknown; message?: unknown } | undefined;
	if (!data || typeof data !== 'object') return null;

	const list: Array<{ message?: unknown; solution?: unknown }> = Array.isArray(data.errors)
		? (data.errors as Array<{ message?: unknown; solution?: unknown }>)
		: data.error && typeof data.error === 'object'
			? [data.error as { message?: unknown; solution?: unknown }]
			: [];
	const withMessage = list.filter(
		(e) => e && typeof e.message === 'string' && (e.message as string).trim() !== '',
	);

	if (withMessage.length === 0) {
		return typeof data.message === 'string' && data.message.trim() !== ''
			? { message: data.message }
			: null;
	}
	const message = withMessage.map((e) => e.message as string).join('; ');
	const solution = withMessage
		.map((e) => e.solution)
		.find((s): s is string => typeof s === 'string' && s.trim() !== '');
	return solution ? { message, solution } : { message };
}

// IBM's error bodies are inconsistent. A missing job or session comes back naming the identifier
// and carrying a `solution` ("Job not found. Job ID: da24...", "Verify the job ID is correct"),
// which reaches the user as a good message on its own. A missing device or log answers with a bare
// "device not found" that names nothing. This adds the value the user actually supplied, and where
// to look, only in that second case: an error that already names the value or carries a solution is
// returned untouched, and IBM's own wording is always kept.
export function explainTerseError(
	error: unknown,
	subject: string,
	value: string,
	hint: string,
): unknown {
	if (!(error instanceof NodeApiError)) return error;
	// Only a 404 is about the value. Adding "check the name" to a 401, a 429 or a 500 would send the
	// reader after the wrong thing: an expired token has nothing to do with the backend name.
	if (String(error.httpCode) !== '404') return error;
	const original = (error.message ?? '').trim();
	// Whether IBM named the value is the whole test. Its good errors quote it ("Job not found.
	// Job ID: da24..."), its terse ones do not. `description` cannot be used for this: n8n fills it
	// with a generic "Request failed with status code 404" whenever IBM supplies no solution.
	if (original === '' || original.includes(value)) return error;
	error.message = `${subject} "${value}": ${original}. ${hint}`;
	return error;
}

// Wrap a request error as a NodeApiError, surfacing the IBM error message when the response
// carried one. The message is passed as a constructor option so n8n does not overwrite it with
// the generic httpCode default. Extraction runs on the raw error because that is where n8n put
// the parsed body before our code (or the node's own catch) re-wraps it.
export function enrichApiError(node: INode, error: unknown): NodeApiError {
	const ibm = extractIbmError(error);
	if (!ibm) {
		return error instanceof NodeApiError ? error : new NodeApiError(node, error as JsonObject);
	}
	const options = ibm.solution
		? { message: ibm.message, description: ibm.solution }
		: { message: ibm.message };
	// A same-module NodeApiError is returned unchanged by the constructor (options ignored), so
	// set the fields directly; otherwise build a fresh one with the message option.
	if (error instanceof NodeApiError) {
		error.message = ibm.message;
		if (ibm.solution) error.description = ibm.solution;
		return error;
	}
	return new NodeApiError(node, error as JsonObject, options);
}
