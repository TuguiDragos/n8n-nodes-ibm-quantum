import {
	NodeOperationError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type INode,
} from 'n8n-workflow';

import { asNodeError, errorMessage, ibmQuantumApiRequest, type RequestContext } from './transport';
import { buildQasm3, parseNumberListStrict, validateGateInput, type GateOperation } from './qasm3';
import { parseResults } from './results';

const CONTROLLED_TWO = new Set(['cx', 'cz', 'crx', 'cry', 'crz']);

// IBM refuses a job cost above three hours and silently caps anything larger.
export const MAX_JOB_COST_SECONDS = 10800;

// Build a GateOperation from parsed, validated input.
function mapGate(gate: string, qubits: number[], params: number[], clbit?: number): GateOperation {
	// Normalize the missing-clbit case to 0 here, because that is the value validateGateInput
	// range-checked. Leaving it undefined let the renderer fall back to the qubit index instead,
	// which passed validation and then emitted a write past the end of the classical register.
	if (gate === 'measure')
		return { gate, targets: [qubits[0]], controls: [], params: [], clbit: clbit ?? 0 };
	if (gate === 'swap') return { gate, targets: [qubits[0], qubits[1]], controls: [], params: [] };
	if (gate === 'ccx') {
		return {
			gate,
			targets: [qubits[qubits.length - 1]],
			controls: qubits.slice(0, -1),
			params: [],
		};
	}
	if (CONTROLLED_TWO.has(gate))
		return { gate, targets: [qubits[1]], controls: [qubits[0]], params };
	return { gate, targets: qubits, controls: [], params };
}

// The UI minimum is only a hint. An expression can inject any value, so validate register
// sizes here and fail with a clear message instead of emitting an invalid program.
function requireRegisterSize(
	value: unknown,
	min: number,
	label: string,
	node: INode,
	itemIndex: number,
): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < min) {
		throw new NodeOperationError(node, `${label} must be an integer of at least ${min}.`, {
			itemIndex,
		});
	}
	return n;
}

export function handleCircuitBuild(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const node = this.getNode();
	const numQubits = requireRegisterSize(
		this.getNodeParameter('numQubits', itemIndex),
		1,
		'Number of Qubits',
		node,
		itemIndex,
	);
	const numClbits = requireRegisterSize(
		this.getNodeParameter('numClbits', itemIndex, 0),
		0,
		'Number of Classical Bits',
		node,
		itemIndex,
	);
	const gatesParam = this.getNodeParameter('gates', itemIndex, {}) as IDataObject;
	const rawGates = (gatesParam.gate as IDataObject[]) ?? [];

	const gates = rawGates.map((raw, idx) => {
		const gate = raw.gate as string;
		let qubits: number[];
		let params: number[];
		try {
			qubits = parseNumberListStrict((raw.qubits as string) ?? '', 'Qubits');
			params = parseNumberListStrict((raw.params as string) ?? '', 'Parameters');
		} catch (error) {
			const message = errorMessage(error);
			throw new NodeOperationError(node, `Gate #${idx + 1} (${gate}): ${message}`, {
				itemIndex,
			});
		}
		const clbit = raw.clbit as number | undefined;
		const problem = validateGateInput(gate, qubits, params, clbit, numQubits, numClbits);
		if (problem) {
			throw new NodeOperationError(node, `Gate #${idx + 1}: ${problem}`, { itemIndex });
		}
		return mapGate(gate, qubits, params, clbit);
	});

	const qasm3 = buildQasm3({ numQubits, numClbits, gates });
	return { qasm3, numQubits, numClbits, gateCount: gates.length };
}

// A real OpenQASM 3 version header, not just the substring somewhere in the text. Every valid
// program declares one, so this is safe to require on any path that hands a circuit to IBM.
const OPENQASM3_HEADER = /^\s*OPENQASM\s+3(\.\d+)?\s*;/m;

function requireQasm3Header(qasm3: string, label: string, node: INode, itemIndex: number): void {
	if (!OPENQASM3_HEADER.test(qasm3)) {
		throw new NodeOperationError(
			node,
			`${label} does not start with an OpenQASM 3 version header (expected a line like "OPENQASM 3.0;").`,
			{ itemIndex },
		);
	}
}

// Every QPY payload opens with the ASCII magic QISKIT. Six bytes fill two whole base64 groups, so
// an encoded file starts with exactly these eight characters and a prefix test is exact.
export const QPY_BASE64_MAGIC = 'UUlTS0lU';

function requireQpyPayload(circuit: string, node: INode, itemIndex: number): void {
	if (!circuit.trimStart().startsWith(QPY_BASE64_MAGIC)) {
		throw new NodeOperationError(
			node,
			'QPY Circuit is not a base64-encoded QPY payload (the encoding of a QPY file starts with "UUlTS0lU"). Produce it with qiskit.qpy.dump into a BytesIO and base64-encode the bytes.',
			{ itemIndex },
		);
	}
}

// Submit validates the circuit locally whatever its format, because IBM queues a malformed job,
// charges QPU time for it and only then fails it on a parse error.
function requireSupportedCircuit(
	circuit: string,
	format: string,
	node: INode,
	itemIndex: number,
): void {
	if (format === 'qpy') {
		requireQpyPayload(circuit, node, itemIndex);
		return;
	}
	requireQasm3Header(circuit, 'OpenQASM 3 Circuit', node, itemIndex);
}

export function handleCircuitImport(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const qasm3 = (this.getNodeParameter('qasm3Input', itemIndex) as string) ?? '';
	requireQasm3Header(qasm3, 'Input', this.getNode(), itemIndex);
	return { qasm3 };
}

function statusName(device: IDataObject): string {
	const status = device.status as IDataObject | undefined;
	return (status?.name as string) ?? '';
}

function queueLengthOf(device: IDataObject): number | null {
	return typeof device.queue_length === 'number' ? (device.queue_length as number) : null;
}

// Devices with an unknown queue length sort last but keep their real (null) value in the output.
function queueRank(device: IDataObject): number {
	return queueLengthOf(device) ?? Number.MAX_SAFE_INTEGER;
}

// The backends list already carries status, qubit count and queue length per device.
async function getLeastBusy(
	this: IExecuteFunctions,
	ctx: RequestContext,
	itemIndex: number,
): Promise<IDataObject> {
	const minQubits = this.getNodeParameter('minQubits', itemIndex, 0) as number;
	const includeSimulators = this.getNodeParameter('includeSimulators', itemIndex, false) as boolean;

	const response = await ibmQuantumApiRequest.call(this, ctx, 'GET', '/backends');
	const devices = (response.devices as IDataObject[]) ?? [];

	const candidates = devices
		.filter((device) => {
			if (!includeSimulators && device.is_simulator === true) return false;
			// A device with an unknown qubit count cannot be proven to meet the minimum, so exclude it
			// rather than fail open and return a backend that may be smaller than the user asked for.
			if (
				minQubits > 0 &&
				(typeof device.qubits !== 'number' || (device.qubits as number) < minQubits)
			) {
				return false;
			}
			return statusName(device) === 'online';
		})
		.sort((a, b) => queueRank(a) - queueRank(b));

	const best = candidates[0];
	return {
		leastBusy: best ? (best.name as string) : null,
		queueLength: best ? queueLengthOf(best) : null,
		candidates: candidates.map((device) => ({
			name: device.name,
			queueLength: queueLengthOf(device),
			qubits: device.qubits,
			status: statusName(device),
		})),
	};
}

export async function handleBackend(
	this: IExecuteFunctions,
	ctx: RequestContext,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	if (operation === 'list') return ibmQuantumApiRequest.call(this, ctx, 'GET', '/backends');
	if (operation === 'getLeastBusy') return getLeastBusy.call(this, ctx, itemIndex);

	const backendName = this.getNodeParameter('backendName', itemIndex) as string;
	const endpoints: Record<string, string> = {
		getConfiguration: `/backends/${backendName}/configuration`,
		getDefaults: `/backends/${backendName}/defaults`,
		getProperties: `/backends/${backendName}/properties`,
		getStatus: `/backends/${backendName}/status`,
	};
	const endpoint = endpoints[operation];
	if (!endpoint) {
		throw new NodeOperationError(this.getNode(), `Unsupported backend operation: ${operation}`, {
			itemIndex,
		});
	}
	return ibmQuantumApiRequest.call(this, ctx, 'GET', endpoint);
}

function parseJsonParameter(value: string, node: INode, label: string, itemIndex: number): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		throw new NodeOperationError(node, `${label} must be valid JSON`, { itemIndex });
	}
}

// Gather the Pauli term strings from any of the accepted observable shapes: a bare string, an
// array of strings, or a coefficient map { "IIZII": 1.0 } (terms are the keys). Unrecognized
// leaves are ignored so the server still validates anything this does not understand.
function collectPauliTerms(value: unknown, out: string[]): void {
	if (typeof value === 'string') {
		out.push(value);
	} else if (Array.isArray(value)) {
		for (const entry of value) collectPauliTerms(entry, out);
	} else if (value && typeof value === 'object') {
		out.push(...Object.keys(value as Record<string, unknown>));
	}
}

// Catch a malformed Pauli string locally instead of after a wasted submit round-trip. The UI
// promises only the letters I, X, Y and Z; a stricter length-vs-qubits check is left to IBM.
function validateObservables(observables: unknown, node: INode, itemIndex: number): void {
	const terms: string[] = [];
	collectPauliTerms(observables, terms);
	const bad = terms.find((term) => !/^[IXYZ]+$/.test(term));
	if (bad !== undefined) {
		throw new NodeOperationError(
			node,
			`Observables: "${bad}" is not a valid Pauli string. Use only the letters I, X, Y and Z, one per qubit.`,
			{ itemIndex },
		);
	}
}

// Merge structured V2 toggles onto a base options object. Only keys the user set are added,
// since params.options is additionalProperties:false and rejects unknown keys.
export function mergePrimitiveOptions(
	base: IDataObject,
	dynamicalDecoupling: boolean,
	twirlGates: boolean,
	twirlMeasure: boolean,
): IDataObject {
	const options: IDataObject = { ...base };
	if (dynamicalDecoupling) {
		const dd = (options.dynamical_decoupling as IDataObject) ?? {};
		options.dynamical_decoupling = { ...dd, enable: true };
	}
	if (twirlGates || twirlMeasure) {
		const twirling = { ...((options.twirling as IDataObject) ?? {}) };
		if (twirlGates) twirling.enable_gates = true;
		if (twirlMeasure) twirling.enable_measure = true;
		options.twirling = twirling;
	}
	return options;
}

// Build the V2 PUB array for a primitive. Sampler is (circuit, parameters, shots); estimator is
// (circuit, observables, parameters?, precision?), extended past the required two items only when needed.
export function buildPubData(
	primitive: 'sampler' | 'estimator',
	circuit: string,
	observables: unknown,
	parameters: unknown,
	shots: number,
	precision: number,
): unknown[] {
	if (primitive === 'estimator') {
		const pub: unknown[] = [circuit, observables];
		if (parameters !== null || precision > 0) pub.push(parameters);
		if (precision > 0) pub.push(precision);
		return pub;
	}
	return [circuit, parameters, shots];
}

// The JSON escape hatch, shared by every program. Returns a fresh object so callers can extend it.
function readAdditionalOptions(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const additionalOptionsRaw = this.getNodeParameter(
		'additionalOptions',
		itemIndex,
		'{}',
	) as string;
	const parsed = parseJsonParameter(
		additionalOptionsRaw,
		this.getNode(),
		'Additional Options',
		itemIndex,
	);
	// An array or scalar would be spread into options as numeric-index keys and rejected by IBM, so
	// reject it inline with a clear message instead of sending a corrupt request. null means "no options".
	if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
		throw new NodeOperationError(
			this.getNode(),
			'Additional Options must be a JSON object, for example {"default_shots": 4096}.',
			{ itemIndex },
		);
	}
	return parsed && typeof parsed === 'object' ? { ...(parsed as IDataObject) } : {};
}

function buildPrimitiveOptions(this: IExecuteFunctions, itemIndex: number): IDataObject {
	return mergePrimitiveOptions(
		readAdditionalOptions.call(this, itemIndex),
		this.getNodeParameter('dynamicalDecoupling', itemIndex, false) as boolean,
		this.getNodeParameter('twirlingGates', itemIndex, false) as boolean,
		this.getNodeParameter('twirlingMeasure', itemIndex, false) as boolean,
	);
}

// Every program shares the same job envelope: which backend, which circuit, and the job-level
// fields that sit beside params rather than inside it.
function readSubmitEnvelope(
	this: IExecuteFunctions,
	itemIndex: number,
): { backend: string; circuit: string; sessionId: string; body: IDataObject } {
	const backend = this.getNodeParameter('backend', itemIndex) as string;
	// A workflow saved before the format selector existed stores no circuitFormat, so the default
	// keeps it on the OpenQASM 3 field it already filled in.
	const format = this.getNodeParameter('circuitFormat', itemIndex, 'qasm3') as string;
	const circuitParam = format === 'qpy' ? 'qpyCircuit' : 'qasm3';
	const circuit = (this.getNodeParameter(circuitParam, itemIndex) as string) ?? '';
	const sessionId = this.getNodeParameter('submitSessionId', itemIndex, '') as string;

	requireSupportedCircuit(circuit, format, this.getNode(), itemIndex);

	const body: IDataObject = {};
	// session_id is a sibling of program_id/backend/params, never inside params.
	if (sessionId) body.session_id = sessionId;
	const tags = parseCsvList(this.getNodeParameter('jobTags', itemIndex, '') as string);
	if (tags.length > 0) body.tags = tags;
	// The API expects the private flag only when set, matching the official client.
	if (this.getNodeParameter('privateJob', itemIndex, false) === true) body.private = true;
	// Zero means "omit and let the program decide", so the fallback is 0 rather than a default cap.
	const maxCost = clampCount(
		this.getNodeParameter('maxCost', itemIndex, 0),
		0,
		MAX_JOB_COST_SECONDS,
	);
	if (maxCost > 0) body.cost = maxCost;
	const logLevel = this.getNodeParameter('logLevel', itemIndex, '') as string;
	if (logLevel) body.log_level = logLevel;

	return { backend, circuit, sessionId, body };
}

async function submitJob(
	this: IExecuteFunctions,
	ctx: RequestContext,
	primitive: 'sampler' | 'estimator',
	itemIndex: number,
): Promise<IDataObject> {
	const { backend, circuit, sessionId, body } = readSubmitEnvelope.call(this, itemIndex);

	// Parameters is a JSON field but an expression may resolve it to an object. Handle both, and
	// treat empty string / {} as "no bindings" so a fixed circuit submits the same as before.
	const parametersParam = this.getNodeParameter('parameters', itemIndex, '');
	let parameters: unknown = null;
	if (typeof parametersParam === 'string') {
		const trimmed = parametersParam.trim();
		if (trimmed && trimmed !== '{}') {
			parameters = parseJsonParameter(trimmed, this.getNode(), 'Parameters', itemIndex);
		}
	} else if (parametersParam && typeof parametersParam === 'object') {
		if (Object.keys(parametersParam as IDataObject).length > 0) parameters = parametersParam;
	}

	const options = buildPrimitiveOptions.call(this, itemIndex);
	const params: IDataObject = { version: 2 };

	let pub: unknown[];
	if (primitive === 'estimator') {
		const observablesRaw = this.getNodeParameter('observables', itemIndex) as string;
		const observables = parseJsonParameter(
			observablesRaw,
			this.getNode(),
			'Observables',
			itemIndex,
		);
		validateObservables(observables, this.getNode(), itemIndex);
		params.resilience_level = this.getNodeParameter('resilienceLevel', itemIndex, 1) as number;
		const precision = this.getNodeParameter('precision', itemIndex, 0) as number;
		pub = buildPubData('estimator', circuit, observables, parameters, 0, precision);
	} else {
		const shots = clampCount(this.getNodeParameter('shots', itemIndex, 1024), 1024);
		pub = buildPubData('sampler', circuit, null, parameters, shots, 0);
	}

	params.pubs = [pub];
	if (Object.keys(options).length > 0) params.options = options;

	body.program_id = primitive;
	body.backend = backend;
	body.params = params;

	const response = await ibmQuantumApiRequest.call(this, ctx, 'POST', '/jobs', body);
	return { jobId: response.id ?? null, backend, primitive, sessionId: sessionId || null, response };
}

// The noise learner characterises the noise on a backend's entangling layers. It takes bare
// circuits rather than PUBs, and its options object is declared additionalProperties:false, so the
// Sampler and Estimator toggles must never be merged into it.
async function submitNoiseLearnerJob(
	this: IExecuteFunctions,
	ctx: RequestContext,
	itemIndex: number,
): Promise<IDataObject> {
	const { backend, circuit, sessionId, body } = readSubmitEnvelope.call(this, itemIndex);
	const options = readAdditionalOptions.call(this, itemIndex);
	const learner = this.getNodeParameter('noiseLearnerOptions', itemIndex, {}) as IDataObject;

	const counts: Array<[string, string]> = [
		['maxLayersToLearn', 'max_layers_to_learn'],
		['numRandomizations', 'num_randomizations'],
		['shotsPerRandomization', 'shots_per_randomization'],
	];
	for (const [param, key] of counts) {
		// Zero means "leave it to IBM", so a missing or non-positive value simply drops the field.
		const value = clampCount(learner[param], 0);
		if (value > 0) options[key] = value;
	}

	const depthsInput = (learner.layerPairDepths as string) ?? '';
	if (depthsInput.trim()) {
		let depths: number[];
		try {
			depths = parseNumberListStrict(depthsInput, 'Layer Pair Depths');
		} catch (error) {
			const message = errorMessage(error);
			throw new NodeOperationError(this.getNode(), message, { itemIndex });
		}
		options.layer_pair_depths = depths;
	}

	const strategy = learner.twirlingStrategy;
	if (typeof strategy === 'string' && strategy) options.twirling_strategy = strategy;

	const params: IDataObject = { version: 2, circuits: [circuit] };
	if (Object.keys(options).length > 0) params.options = options;

	body.program_id = 'noise-learner';
	body.backend = backend;
	body.params = params;

	const response = await ibmQuantumApiRequest.call(this, ctx, 'POST', '/jobs', body);
	return {
		jobId: response.id ?? null,
		backend,
		primitive: 'noise-learner',
		sessionId: sessionId || null,
		response,
	};
}

// Split a comma-separated input into clean values. Used for tags, and for the list filters the
// analytics endpoints accept.
export function parseCsvList(value: unknown): string[] {
	if (typeof value !== 'string' || !value.trim()) return [];
	return value
		.split(',')
		.map((tag) => tag.trim())
		.filter((tag) => tag !== '');
}

// IBM V2 terminal statuses are completed, canceled and failed. The British spelling and 'error'
// are defensive aliases for schema variants.
export const TERMINAL = ['completed', 'cancelled', 'canceled', 'failed', 'error'];

// The job carries both a state object and a top level status string. Read either.
export function extractJobStatus(jobInfo: IDataObject): string {
	const state = jobInfo.state;
	if (state && typeof state === 'object') {
		const nested = (state as IDataObject).status;
		if (typeof nested === 'string') return nested.toLowerCase();
	}
	if (typeof state === 'string') return state.toLowerCase();
	if (typeof jobInfo.status === 'string') return (jobInfo.status as string).toLowerCase();
	return '';
}

// A job is finished if completed, failed, or any cancellation variant (the API also reports
// "Cancelled - Ran too long", which TERMINAL does not list literally).
export function isTerminalStatus(status: string): boolean {
	return TERMINAL.includes(status) || status.startsWith('cancel');
}

// Coerce a user-supplied seconds value to a usable positive number, falling back when it is
// non-finite or below 1. The field's minValue is only a UI hint, so an expression can bypass it
// with 0, a negative number, or a non-numeric value (NaN). Without this, pollInterval -> NaN
// busy-loops the API and maxWait -> NaN makes the deadline NaN so the loop never times out.
function clampSeconds(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n >= 1 ? n : fallback;
}

// Same reasoning as clampSeconds, for the fields that carry a plain count. minValue in the UI is
// only a hint, so an expression can deliver a string, a float, a negative or NaN. Passing any of
// those straight through costs a rejected request, or in the case of shots a wasted submission.
export function clampCount(value: unknown, fallback: number, max?: number): number {
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n) || n < 1) return fallback;
	return max !== undefined && n > max ? max : n;
}

// Connection-level failures that are safe to retry while polling.
const TRANSIENT_NETWORK_CODES = new Set([
	'ECONNABORTED',
	'ECONNREFUSED',
	'ECONNRESET',
	'EAI_AGAIN',
	'EPIPE',
	'ETIMEDOUT',
]);

function firstHttpStatus(err: {
	httpCode?: string | number;
	statusCode?: number;
	response?: { status?: number };
	cause?: { httpCode?: string | number; statusCode?: number; response?: { status?: number } };
}): number {
	const raw =
		err.httpCode ??
		err.statusCode ??
		err.response?.status ??
		err.cause?.httpCode ??
		err.cause?.statusCode ??
		err.cause?.response?.status;
	return Number(raw);
}

// A poll iteration should survive rate limits, gateway errors and dropped connections.
// Anything else (bad job id, revoked key, malformed request) keeps failing fast.
export function isTransientPollError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const err = error as Parameters<typeof firstHttpStatus>[0] & { cause?: { code?: string } };
	const status = firstHttpStatus(err);
	if (Number.isFinite(status) && status > 0) return status === 429 || status >= 500;
	const code = err.cause?.code;
	return typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code);
}

async function getResults(
	this: IExecuteFunctions,
	ctx: RequestContext,
	itemIndex: number,
): Promise<IDataObject> {
	const jobId = this.getNodeParameter('jobId', itemIndex) as string;
	const intervalSec = clampSeconds(this.getNodeParameter('pollInterval', itemIndex, 5), 5);
	const maxWaitSec = clampSeconds(this.getNodeParameter('maxWait', itemIndex, 300), 300);
	const registerName = this.getNodeParameter('registerName', itemIndex, '') as string;

	const deadline = Date.now() + maxWaitSec * 1000;
	let status = '';
	let jobInfo: IDataObject = {};

	// Poll at least once, break on a terminal status, and never sleep past the deadline.
	// A transient failure (429, 5xx, dropped connection) retries until the deadline instead
	// of killing a poll that may already have waited many minutes.
	while (true) {
		try {
			jobInfo = await ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${jobId}`);
		} catch (error) {
			const remaining = deadline - Date.now();
			if (remaining <= 0 || !isTransientPollError(error)) {
				throw asNodeError(this.getNode(), error, itemIndex);
			}
			await sleep(Math.min(intervalSec * 1000, remaining));
			continue;
		}
		status = extractJobStatus(jobInfo);
		if (isTerminalStatus(status)) break;
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		await sleep(Math.min(intervalSec * 1000, remaining));
	}

	if (!isTerminalStatus(status)) return { jobId, status, timedOut: true, job: jobInfo };
	if (status !== 'completed') return { jobId, status, job: jobInfo };

	const results = await ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${jobId}/results`);
	const parsed = parseResults(results, registerName || undefined);
	return { jobId, status, ...parsed, raw: results };
}

export async function handleJob(
	this: IExecuteFunctions,
	ctx: RequestContext,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	if (operation === 'submitSampler') return submitJob.call(this, ctx, 'sampler', itemIndex);
	if (operation === 'submitEstimator') return submitJob.call(this, ctx, 'estimator', itemIndex);
	if (operation === 'submitNoiseLearner') return submitNoiseLearnerJob.call(this, ctx, itemIndex);
	if (operation === 'getResults') return getResults.call(this, ctx, itemIndex);
	if (operation === 'list') {
		// IBM caps GET /jobs at 200 and silently substitutes its default above that.
		const limit = clampCount(this.getNodeParameter('limit', itemIndex, 50), 50, 200);
		const filters = this.getNodeParameter('listFilters', itemIndex, {}) as IDataObject;
		// exclude_params drops each job's circuit payload from the listing, matching the
		// official client's default. The filter toggle brings it back when needed.
		const qs: IDataObject = { limit, exclude_params: filters.includeParams !== true };
		const stringFilters: Array<[string, string]> = [
			['backend', 'backend'],
			['sessionId', 'session_id'],
			['createdAfter', 'created_after'],
			['createdBefore', 'created_before'],
			['program', 'program'],
		];
		for (const [param, qsKey] of stringFilters) {
			const value = filters[param];
			if (typeof value === 'string' && value.trim() !== '') qs[qsKey] = value.trim();
		}
		// tags is an array on the API (up to eight), so a comma-separated input becomes several
		// values rather than one string that would never match. A single tag still sends one value.
		const tagFilters = parseCsvList(filters.tag);
		if (tagFilters.length > 0) qs.tags = tagFilters;
		if (filters.pending === 'pending') qs.pending = true;
		else if (filters.pending === 'finished') qs.pending = false;
		if (filters.sort === 'asc') qs.sort = 'ASC';
		const offset = Number(filters.offset);
		if (Number.isInteger(offset) && offset > 0) qs.offset = offset;
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/jobs', undefined, qs);
	}

	if (operation === 'listTags') {
		// The API requires both parameters. `type` has only one value today, so it is sent rather
		// than offered, and an empty search would be rejected, so it falls back to matching all.
		const search = (this.getNodeParameter('tagSearch', itemIndex, '') as string).trim();
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/tags', undefined, {
			type: 'job',
			search: search || '',
		});
	}

	const jobId = this.getNodeParameter('jobId', itemIndex) as string;
	if (operation === 'getStatus')
		return ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${jobId}`);
	if (operation === 'getMetrics') {
		return ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${jobId}/metrics`);
	}
	if (operation === 'getLogs') {
		// The logs endpoint returns plain text, not JSON, so wrap it for a structured item.
		const response = (await ibmQuantumApiRequest.call(
			this,
			ctx,
			'GET',
			`/jobs/${jobId}/logs`,
		)) as unknown;
		const logs = typeof response === 'string' ? response : ((response as IDataObject) ?? '');
		return { jobId, logs };
	}
	if (operation === 'updateTags') {
		const tags = parseCsvList(this.getNodeParameter('jobTags', itemIndex, '') as string);
		// PUT replaces the full tag list and returns 204, so an empty input clears all tags.
		await ibmQuantumApiRequest.call(this, ctx, 'PUT', `/jobs/${jobId}/tags`, { tags });
		return { jobId, tags };
	}
	if (operation === 'cancel') {
		await ibmQuantumApiRequest.call(this, ctx, 'POST', `/jobs/${jobId}/cancel`);
		return { jobId, cancelled: true };
	}
	// Destructive requests only run on an exact match. An unknown operation must fail loudly
	// instead of falling through to a delete.
	if (operation === 'delete') {
		await ibmQuantumApiRequest.call(this, ctx, 'DELETE', `/jobs/${jobId}`);
		return { jobId, deleted: true };
	}
	throw new NodeOperationError(this.getNode(), `Unsupported job operation: ${operation}`, {
		itemIndex,
	});
}

export async function handleSession(
	this: IExecuteFunctions,
	ctx: RequestContext,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	if (operation === 'create') {
		// Version 2 renamed this parameter to sessionMode; version 1 workflows still store `mode`.
		const modeParam = this.getNode().typeVersion >= 2 ? 'sessionMode' : 'mode';
		const mode = this.getNodeParameter(modeParam, itemIndex, 'batch') as string;
		const backend = this.getNodeParameter('sessionBackend', itemIndex) as string;
		// Zero deliberately means "omit max_ttl and let IBM pick", so this coerces without
		// substituting a fallback: anything not a positive number simply drops the field.
		const maxTtl = Math.floor(Number(this.getNodeParameter('maxTtl', itemIndex, 28800)));
		const body: IDataObject = { mode, backend };
		if (Number.isFinite(maxTtl) && maxTtl > 0) body.max_ttl = maxTtl;
		const response = await ibmQuantumApiRequest.call(this, ctx, 'POST', '/sessions', body);
		return { sessionId: response.id ?? null, mode, backend, response };
	}

	const sessionId = this.getNodeParameter('sessionId', itemIndex) as string;
	if (operation === 'get') {
		return ibmQuantumApiRequest.call(this, ctx, 'GET', `/sessions/${sessionId}`);
	}
	if (operation === 'setAccepting') {
		const acceptingJobs = this.getNodeParameter('acceptingJobs', itemIndex, true) as boolean;
		// PATCH returns 204 with no body, so report the requested state.
		await ibmQuantumApiRequest.call(this, ctx, 'PATCH', `/sessions/${sessionId}`, {
			accepting_jobs: acceptingJobs,
		});
		return { sessionId, acceptingJobs };
	}
	// close: DELETE returns 204 with no body. Exact match only, so an unknown operation
	// cannot close a session by accident.
	if (operation === 'close') {
		await ibmQuantumApiRequest.call(this, ctx, 'DELETE', `/sessions/${sessionId}/close`);
		return { sessionId, closed: true };
	}
	throw new NodeOperationError(this.getNode(), `Unsupported session operation: ${operation}`, {
		itemIndex,
	});
}

// The workloads listing caps at 50, far below the 200 the jobs listing allows.
export const MAX_WORKLOAD_LIMIT = 50;

// IBM returns workloads oldest first. Jobs List and both triggers all present newest first, so the
// node sends the descending sort unless the user picks otherwise.
const DEFAULT_WORKLOAD_SORT = '-createdAt';

export async function handleWorkload(
	this: IExecuteFunctions,
	ctx: RequestContext,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	if (operation !== 'list') {
		throw new NodeOperationError(this.getNode(), `Unsupported workload operation: ${operation}`, {
			itemIndex,
		});
	}
	const limit = clampCount(
		this.getNodeParameter('limit', itemIndex, MAX_WORKLOAD_LIMIT),
		MAX_WORKLOAD_LIMIT,
		MAX_WORKLOAD_LIMIT,
	);
	const filters = this.getNodeParameter('workloadFilters', itemIndex, {}) as IDataObject;
	const qs: IDataObject = { limit };

	const stringFilters: Array<[string, string]> = [
		['backend', 'backend'],
		['createdAfter', 'created_after'],
		['createdBefore', 'created_before'],
		['next', 'next'],
		['previous', 'previous'],
		['search', 'search'],
		['workloadMode', 'mode'],
	];
	for (const [param, key] of stringFilters) {
		const value = filters[param];
		if (typeof value === 'string' && value.trim() !== '') qs[key] = value.trim();
	}

	const tags = parseCsvList(filters.tags);
	if (tags.length > 0) qs.tags = tags;
	if (Array.isArray(filters.status) && filters.status.length > 0) qs.status = filters.status;
	qs.sort = typeof filters.sort === 'string' && filters.sort ? filters.sort : DEFAULT_WORKLOAD_SORT;

	return ibmQuantumApiRequest.call(this, ctx, 'GET', '/workloads', undefined, qs);
}

const ANALYTICS_ENDPOINTS: Record<string, string> = {
	getAnalytics: '/analytics/usage',
	getAnalyticsGrouped: '/analytics/usage_grouped',
	getAnalyticsByDate: '/analytics/usage_grouped_by_date',
};

// The three usage analytics endpoints take one shared filter set. List values go out as repeated
// keys, the encoding transport already applies and the only one the API reads.
function analyticsQuery(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const filters = this.getNodeParameter('analyticsFilters', itemIndex, {}) as IDataObject;
	const qs: IDataObject = {};

	const listFilters: Array<[string, string]> = [
		['backend', 'backend'],
		['instance', 'instance'],
		['plan', 'plan'],
		['subscriptionId', 'subscription_id'],
		['userId', 'user_id'],
	];
	for (const [param, key] of listFilters) {
		const values = parseCsvList(filters[param]);
		if (values.length > 0) qs[key] = values;
	}

	const dateFilters: Array<[string, string]> = [
		['intervalStart', 'interval_start'],
		['intervalEnd', 'interval_end'],
	];
	for (const [param, key] of dateFilters) {
		const value = filters[param];
		if (typeof value === 'string' && value.trim() !== '') qs[key] = value.trim();
	}

	// The API already defaults simulators to true, so only the opt-out needs sending.
	if (filters.simulators === false) qs.simulators = false;
	return qs;
}

export async function handleAccount(
	this: IExecuteFunctions,
	ctx: RequestContext,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	if (operation === 'getUsage') {
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/instances/usage');
	}
	if (operation === 'getConfiguration') {
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/instances/configuration');
	}
	if (operation === 'getInstance') {
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/instance');
	}
	if (operation === 'getAnalyticsFilters') {
		// Returns the filter values this caller may use, so it takes no query of its own.
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/analytics/filters');
	}
	if (operation === 'getApiVersions') {
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/versions');
	}
	const analyticsEndpoint = ANALYTICS_ENDPOINTS[operation];
	if (analyticsEndpoint) {
		const qs = analyticsQuery.call(this, itemIndex);
		if (operation === 'getAnalyticsGrouped') {
			qs.group_by = this.getNodeParameter('groupBy', itemIndex, 'backend') as string;
		}
		// The by-date endpoint requires group_by and accepts only this one value.
		if (operation === 'getAnalyticsByDate') qs.group_by = 'instance';
		return ibmQuantumApiRequest.call(this, ctx, 'GET', analyticsEndpoint, undefined, qs);
	}
	if (operation === 'setCostLimit') {
		const requested = Math.floor(Number(this.getNodeParameter('instanceLimit', itemIndex, 0)));
		// Zero clears the limit, which the API expresses as an explicit null rather than an absent key.
		const instanceLimit = Number.isFinite(requested) && requested > 0 ? requested : null;
		await ibmQuantumApiRequest.call(this, ctx, 'PUT', '/instances/configuration', {
			instance_limit: instanceLimit,
		});
		return { instanceLimit };
	}
	throw new NodeOperationError(this.getNode(), `Unsupported account operation: ${operation}`, {
		itemIndex,
	});
}
