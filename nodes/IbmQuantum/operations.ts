import {
	NodeOperationError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type INode,
} from 'n8n-workflow';

import { ibmQuantumApiRequest, type RequestContext } from './transport';
import {
	buildQasm3,
	parseNumberListStrict,
	validateGateInput,
	type GateOperation,
} from './qasm3';
import { parseResults } from './results';

const CONTROLLED_TWO = new Set(['cx', 'cz', 'crx', 'cry', 'crz']);

// Build a GateOperation from parsed, validated input.
function mapGate(gate: string, qubits: number[], params: number[], clbit?: number): GateOperation {
	if (gate === 'measure') return { gate, targets: [qubits[0]], controls: [], params: [], clbit };
	if (gate === 'swap') return { gate, targets: [qubits[0], qubits[1]], controls: [], params: [] };
	if (gate === 'ccx') {
		return { gate, targets: [qubits[qubits.length - 1]], controls: qubits.slice(0, -1), params: [] };
	}
	if (CONTROLLED_TWO.has(gate)) return { gate, targets: [qubits[1]], controls: [qubits[0]], params };
	return { gate, targets: qubits, controls: [], params };
}

export function handleCircuitBuild(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const numQubits = this.getNodeParameter('numQubits', itemIndex) as number;
	const numClbits = this.getNodeParameter('numClbits', itemIndex) as number;
	const gatesParam = this.getNodeParameter('gates', itemIndex, {}) as IDataObject;
	const rawGates = (gatesParam.gate as IDataObject[]) ?? [];
	const node = this.getNode();

	const gates = rawGates.map((raw, idx) => {
		const gate = raw.gate as string;
		let qubits: number[];
		let params: number[];
		try {
			qubits = parseNumberListStrict((raw.qubits as string) ?? '', 'Qubits');
			params = parseNumberListStrict((raw.params as string) ?? '', 'Parameters');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
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

export function handleCircuitImport(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const qasm3 = (this.getNodeParameter('qasm3Input', itemIndex) as string) ?? '';
	// Require a real OpenQASM 3 version header, not just the substring anywhere in the text.
	if (!/^\s*OPENQASM\s+3(\.\d+)?\s*;/m.test(qasm3)) {
		throw new NodeOperationError(
			this.getNode(),
			'Input does not start with an OpenQASM 3 version header (expected a line like "OPENQASM 3.0;").',
			{ itemIndex },
		);
	}
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
			if (minQubits > 0 && (typeof device.qubits !== 'number' || (device.qubits as number) < minQubits)) {
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
		getProperties: `/backends/${backendName}/properties`,
		getStatus: `/backends/${backendName}/status`,
	};
	return ibmQuantumApiRequest.call(this, ctx, 'GET', endpoints[operation]);
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
	qasm3: string,
	observables: unknown,
	parameters: unknown,
	shots: number,
	precision: number,
): unknown[] {
	if (primitive === 'estimator') {
		const pub: unknown[] = [qasm3, observables];
		if (parameters !== null || precision > 0) pub.push(parameters);
		if (precision > 0) pub.push(precision);
		return pub;
	}
	return [qasm3, parameters, shots];
}

function buildPrimitiveOptions(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const additionalOptionsRaw = this.getNodeParameter('additionalOptions', itemIndex, '{}') as string;
	const parsed = parseJsonParameter(additionalOptionsRaw, this.getNode(), 'Additional Options', itemIndex);
	// An array or scalar would be spread into options as numeric-index keys and rejected by IBM, so
	// reject it inline with a clear message instead of sending a corrupt request. null means "no options".
	if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
		throw new NodeOperationError(
			this.getNode(),
			'Additional Options must be a JSON object, for example {"default_shots": 4096}.',
			{ itemIndex },
		);
	}
	const base: IDataObject =
		parsed && typeof parsed === 'object' ? (parsed as IDataObject) : {};
	return mergePrimitiveOptions(
		base,
		this.getNodeParameter('dynamicalDecoupling', itemIndex, false) as boolean,
		this.getNodeParameter('twirlingGates', itemIndex, false) as boolean,
		this.getNodeParameter('twirlingMeasure', itemIndex, false) as boolean,
	);
}

async function submitJob(
	this: IExecuteFunctions,
	ctx: RequestContext,
	primitive: 'sampler' | 'estimator',
	itemIndex: number,
): Promise<IDataObject> {
	const backend = this.getNodeParameter('backend', itemIndex) as string;
	const qasm3 = this.getNodeParameter('qasm3', itemIndex) as string;
	const sessionId = this.getNodeParameter('submitSessionId', itemIndex, '') as string;

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
		const observables = parseJsonParameter(observablesRaw, this.getNode(), 'Observables', itemIndex);
		validateObservables(observables, this.getNode(), itemIndex);
		params.resilience_level = this.getNodeParameter('resilienceLevel', itemIndex, 1) as number;
		const precision = this.getNodeParameter('precision', itemIndex, 0) as number;
		pub = buildPubData('estimator', qasm3, observables, parameters, 0, precision);
	} else {
		const shots = this.getNodeParameter('shots', itemIndex, 1024) as number;
		pub = buildPubData('sampler', qasm3, null, parameters, shots, 0);
	}

	params.pubs = [pub];
	if (Object.keys(options).length > 0) params.options = options;

	const body: IDataObject = { program_id: primitive, backend, params };
	// session_id is a sibling of program_id/backend/params, never inside params.
	if (sessionId) body.session_id = sessionId;

	const response = await ibmQuantumApiRequest.call(this, ctx, 'POST', '/jobs', body);
	return { jobId: response.id ?? null, backend, primitive, sessionId: sessionId || null, response };
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
	while (true) {
		jobInfo = await ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${jobId}`);
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
	if (operation === 'getResults') return getResults.call(this, ctx, itemIndex);
	if (operation === 'list') {
		const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/jobs', undefined, { limit });
	}

	const jobId = this.getNodeParameter('jobId', itemIndex) as string;
	if (operation === 'getStatus') return ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${jobId}`);
	if (operation === 'cancel') {
		await ibmQuantumApiRequest.call(this, ctx, 'POST', `/jobs/${jobId}/cancel`);
		return { jobId, cancelled: true };
	}
	await ibmQuantumApiRequest.call(this, ctx, 'DELETE', `/jobs/${jobId}`);
	return { jobId, deleted: true };
}

export async function handleSession(
	this: IExecuteFunctions,
	ctx: RequestContext,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	if (operation === 'create') {
		const mode = this.getNodeParameter('mode', itemIndex, 'batch') as string;
		const backend = this.getNodeParameter('sessionBackend', itemIndex) as string;
		const maxTtl = this.getNodeParameter('maxTtl', itemIndex, 28800) as number;
		const body: IDataObject = { mode, backend };
		if (maxTtl > 0) body.max_ttl = maxTtl;
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
	// close: DELETE returns 204 with no body.
	await ibmQuantumApiRequest.call(this, ctx, 'DELETE', `/sessions/${sessionId}/close`);
	return { sessionId, closed: true };
}

export async function handleAccount(
	this: IExecuteFunctions,
	ctx: RequestContext,
	operation: string,
): Promise<IDataObject> {
	if (operation === 'getUsage') {
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/instances/usage');
	}
	// getInstance
	return ibmQuantumApiRequest.call(this, ctx, 'GET', '/instance');
}
