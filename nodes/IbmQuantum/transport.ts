import {
	NodeApiError,
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

const REGION_HOSTS: Record<string, string> = {
	'us-east': 'https://quantum.cloud.ibm.com',
	'eu-de': 'https://eu-de.quantum.cloud.ibm.com',
};

export function getBaseUrl(region: string): string {
	const host = REGION_HOSTS[region] ?? REGION_HOSTS['us-east'];
	return `${host}/api/v1`;
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
	};
	if (body !== undefined) options.body = body;
	if (qs !== undefined) options.qs = qs;

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'ibmQuantumApi',
			options,
		)) as IDataObject;
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
		| { errors?: unknown; error?: unknown; message?: unknown }
		| undefined;
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

// Wrap a request error as a NodeApiError, surfacing the IBM error message when the response
// carried one. The message is passed as a constructor option so n8n does not overwrite it with
// the generic httpCode default. Extraction runs on the raw error because that is where n8n put
// the parsed body before our code (or the node's own catch) re-wraps it.
export function enrichApiError(node: INode, error: unknown): NodeApiError {
	const ibm = extractIbmError(error);
	if (!ibm) {
		return error instanceof NodeApiError ? error : new NodeApiError(node, error as JsonObject);
	}
	const options = ibm.solution ? { message: ibm.message, description: ibm.solution } : { message: ibm.message };
	// A same-module NodeApiError is returned unchanged by the constructor (options ignored), so
	// set the fields directly; otherwise build a fresh one with the message option.
	if (error instanceof NodeApiError) {
		error.message = ibm.message;
		if (ibm.solution) error.description = ibm.solution;
		return error;
	}
	return new NodeApiError(node, error as JsonObject, options);
}
