import {
	NodeOperationError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type INode,
} from 'n8n-workflow';

import {
	asNodeError,
	errorMessage,
	explainTerseError,
	ibmQuantumApiRequest,
	type RequestContext,
} from './transport';
import { buildQasm3, parseNumberListStrict, validateGateInput, type GateOperation } from './qasm3';
import { parseResults } from './results';

const CONTROLLED_TWO = new Set(['cx', 'cz', 'crx', 'cry', 'crz']);

// IBM refuses a job cost above three hours and silently caps anything larger.
export const MAX_JOB_COST_SECONDS = 10800;

// The tag search endpoint accepts a term of 3 to 100 characters and rejects anything else.
export const TAG_SEARCH_MIN = 3;
export const TAG_SEARCH_MAX = 100;

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

// Far above any announced QPU (the largest today is 156 qubits), so this only stops a runaway
// expression from emitting a register no backend can accept.
export const MAX_REGISTER_SIZE = 4096;

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
	if (n > MAX_REGISTER_SIZE) {
		throw new NodeOperationError(
			node,
			`${label} is ${n}, above the supported maximum of ${MAX_REGISTER_SIZE}.`,
			{ itemIndex },
		);
	}
	return n;
}

// A parameter the UI types as `string` still arrives as whatever an expression produced, so coerce
// before any string method runs. Anything that is not text or a number becomes '' and is then
// rejected by the caller, rather than throwing "value.trim is not a function".
export function asTrimmedString(value: unknown): string {
	return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

// The Qubits and Parameters fields are comma-separated text, but the natural expressions to write
// are `{{ [0, 1] }}` and `{{ 0 }}`. Both used to reach String.trim as a non-string and surface as
// "value.trim is not a function", and a bare number silently parsed as an empty list, which then
// failed with a confusing arity error.
export function asNumberListInput(value: unknown): string {
	if (Array.isArray(value)) return value.map((entry) => asTrimmedString(entry)).join(',');
	return asTrimmedString(value);
}

// Identifiers land in the URL path. IBM serves its web app for `/jobs/` rather than returning an
// error, so an empty one came back as 285 KB of HTML reported as a successful job status. Reject it
// here instead of sending the request.
function requireIdentifier(value: unknown, label: string, node: INode, itemIndex: number): string {
	const text = asTrimmedString(value);
	if (text === '') {
		throw new NodeOperationError(node, `${label} is required and cannot be empty.`, { itemIndex });
	}
	if (DOTS_ONLY.test(text)) {
		throw new NodeOperationError(node, `${label} "${text}" is not a valid identifier.`, {
			itemIndex,
		});
	}
	// An unpaired surrogate cannot be percent-encoded, so pathSegment would throw a bare URIError
	// that reaches the user as "URI malformed" with nothing naming the parameter. Checked with a
	// pattern rather than String.isWellFormed, which would require raising the tsconfig lib to
	// es2024 for this one call.
	if (UNPAIRED_SURROGATE.test(text)) {
		throw new NodeOperationError(
			node,
			`${label} contains an unpaired surrogate and is not valid text.`,
			{ itemIndex },
		);
	}
	// Bounded so a runaway expression cannot build a multi-megabyte URL, since percent-encoding
	// multiplies the length again. See MAX_IDENTIFIER_LENGTH for why the number is what it is.
	const length = characterLength(text);
	if (length > MAX_IDENTIFIER_LENGTH) {
		throw new NodeOperationError(
			node,
			`${label} is ${length} characters, longer than the ${MAX_IDENTIFIER_LENGTH} this node allows.`,
			{ itemIndex },
		);
	}
	return text;
}

// Encode anything that becomes one path segment. Without this a Job ID of `../backends` resolved to
// a different endpoint, and the credential's bearer token and Service-CRN went along with it. The
// node is also an AI Agent tool, so these identifiers can come straight from a model.
export function pathSegment(value: string): string {
	return encodeURIComponent(value);
}

// A segment of nothing but dots is removed by URL resolution: /api/v1/jobs/.. resolves to
// /api/v1/. Encoding does not help, because a normaliser may decode %2E before removing dot
// segments, which is what Node's URL does. Such a value is never a real identifier, so it is
// refused instead. Anything else stays one segment once encodeURIComponent has escaped the
// separators, so "../backends" is already safe as "..%2Fbackends".
const DOTS_ONLY = /^\.+$/;

// A high surrogate not followed by a low one, or a low surrogate not preceded by a high one.
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// A safety bound against a runaway expression, not a mirror of the spec. The spec is not uniform:
// the seven /jobs/{id} endpoints allow 1000, the four /backends/{id} ones and /sessions/{id}/close
// allow 500, and GET and PATCH /sessions/{id} declare no bound at all. Taking the loosest documented
// value means this never refuses something IBM would have accepted, while still stopping the
// megabyte identifier that built a multi-megabyte URL. IBM enforces its own per-endpoint limits.
export const MAX_IDENTIFIER_LENGTH = 1000;

// A collection parameter reads as an object of set fields. getNodeParameter's fallback only applies
// when the parameter is absent, so an expression resolving to null went straight through and the
// first field read threw a raw TypeError. An array is rejected too: it has no named fields, so
// treating it as a collection would silently read nothing.
export function asCollection(value: unknown): IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: {};
}

export interface NumberBounds {
	min: number;
	max?: number;
	integer?: boolean;
}

// A numeric parameter that changes what IBM receives has to fail loudly rather than fall back. A
// silent default here meant either the wrong backend (Minimum Qubits) or an error-mitigation
// setting sent verbatim as a string (Resilience Level, Precision).
export function requireBoundedNumber(
	value: unknown,
	label: string,
	bounds: NumberBounds,
	node: INode,
	itemIndex: number,
): number {
	// Number(''), Number(null), Number([]) and Number(false) are all 0, so a parameter an expression
	// left empty used to pass as a deliberate zero. That is not harmless: zero means no error
	// mitigation for Resilience Level and no filter for Minimum Qubits. Only a real number, or text
	// that is entirely a number, counts.
	const isNumeric =
		typeof value === 'number' ||
		(typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)));
	const n = isNumeric ? Number(value) : Number.NaN;
	const withinMax = bounds.max === undefined || n <= bounds.max;
	const isWholeIfRequired = !bounds.integer || Number.isInteger(n);
	if (!Number.isFinite(n) || !isWholeIfRequired || n < bounds.min || !withinMax) {
		const kind = bounds.integer ? 'an integer' : 'a number';
		const range =
			bounds.max === undefined
				? `at least ${bounds.min}`
				: `between ${bounds.min} and ${bounds.max}`;
		throw new NodeOperationError(node, `${label} must be ${kind} ${range}.`, { itemIndex });
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
	const gatesParam = asCollection(this.getNodeParameter('gates', itemIndex, {}));
	const rawGates = (gatesParam.gate as IDataObject[]) ?? [];

	const gates = rawGates.map((raw, idx) => {
		const gate = raw.gate as string;
		let qubits: number[];
		let params: number[];
		try {
			qubits = parseNumberListStrict(asNumberListInput(raw.qubits), 'Qubits');
			params = parseNumberListStrict(asNumberListInput(raw.params), 'Parameters');
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
// The leading run excludes line terminators on purpose. \s matches a newline, and under /m every
// line start is another place to try from, so a run of newlines made this quadratic: 160k of them
// blocked the event loop, and with it the whole n8n process, for 28 seconds. Excluding only the
// four line terminators keeps it linear while still matching every other space character \s does,
// which matters because a file saved with a UTF-8 BOM starts with U+FEFF and \s matches that.
// Narrowing to [ \t] instead would have rejected 19 code points the original accepted.
const OPENQASM3_HEADER = /^[^\S\n\r\u2028\u2029]*OPENQASM\s+3(\.\d+)?\s*;/m;

function requireQasm3Header(qasm3: string, label: string, node: INode, itemIndex: number): void {
	if (!OPENQASM3_HEADER.test(qasm3)) {
		throw new NodeOperationError(
			node,
			`${label} does not start with an OpenQASM 3 version header (expected a line like "OPENQASM 3.0;").`,
			{ itemIndex },
		);
	}
}

// Base64 of the ASCII magic QISKIT, which is how an *uncompressed* QPY file starts. IBM does not
// accept that: it decompresses the payload before reading it, so this prefix means the circuit was
// encoded a step too early. Recognising it lets the error say exactly what is missing.
export const QPY_UNCOMPRESSED_PREFIX = 'UUlTS0lU';

// A zlib stream starts with a two byte header whose first byte is 0x78 and whose 16 bit value is a
// multiple of 31. Four base64 characters carry three bytes, which is enough to check both.
export function isZlibBase64(value: string): boolean {
	if (value.length < 4) return false;
	const head = Buffer.from(value.slice(0, 4), 'base64');
	if (head.length < 2 || head[0] !== 0x78) return false;
	return ((head[0] << 8) | head[1]) % 31 === 0;
}

// IBM refuses a bare QPY string: the official client wraps every circuit as
// { __type__: 'QuantumCircuit', __value__: base64(zlib(qpy)) } and the server decompresses without
// asking, so an uncompressed payload cannot work. Verified against qiskit-ibm-runtime 0.49.0 and
// against a live job that came back with reason code 1603, complaining that it could not load the
// base64 text as QASM.
export function qpyCircuitPayload(value: string): IDataObject {
	return { __type__: 'QuantumCircuit', __value__: value.trim() };
}

function requireQpyPayload(circuit: string, node: INode, itemIndex: number): void {
	const value = circuit.trim();
	if (value.startsWith(QPY_UNCOMPRESSED_PREFIX)) {
		throw new NodeOperationError(
			node,
			'QPY Circuit is uncompressed. IBM decompresses the payload before reading it, so the QPY bytes must be zlib compressed and only then base64 encoded. In Python: base64.b64encode(zlib.compress(buffer.getvalue())).',
			{ itemIndex },
		);
	}
	if (!isZlibBase64(value)) {
		throw new NodeOperationError(
			node,
			'QPY Circuit is not base64 encoded zlib compressed QPY. Produce it with qiskit.qpy.dump into a BytesIO, zlib compress the bytes, then base64 encode them.',
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
	const minQubits = requireBoundedNumber(
		this.getNodeParameter('minQubits', itemIndex, 0),
		'Minimum Qubits',
		{ min: 0, integer: true },
		this.getNode(),
		itemIndex,
	);
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

	const backendName = requireIdentifier(
		this.getNodeParameter('backendName', itemIndex),
		'Backend Name',
		this.getNode(),
		itemIndex,
	);
	const endpoints: Record<string, string> = {
		getConfiguration: `/backends/${pathSegment(backendName)}/configuration`,
		getDefaults: `/backends/${pathSegment(backendName)}/defaults`,
		getProperties: `/backends/${pathSegment(backendName)}/properties`,
		getStatus: `/backends/${pathSegment(backendName)}/status`,
	};
	// hasOwn, not a truthiness check: `operation` reaches here as a raw string, and a name like
	// 'toString' would otherwise resolve to an inherited Object member and pass as an endpoint.
	const endpoint = Object.hasOwn(endpoints, operation) ? endpoints[operation] : undefined;
	if (endpoint === undefined) {
		throw new NodeOperationError(this.getNode(), `Unsupported backend operation: ${operation}`, {
			itemIndex,
		});
	}
	try {
		return await ibmQuantumApiRequest.call(this, ctx, 'GET', endpoint);
	} catch (error) {
		throw explainTerseError(
			error,
			'Backend',
			backendName,
			'Check the name against Backend > Get Many; names are lowercase, for example ibm_kingston.',
		);
	}
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
	circuit: unknown,
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
// Every IBM device reports the same basis today (cz, id, rx, rz, rzz, sx, x), plus measure, reset,
// delay and barrier among its supported instructions. Qiskit Runtime does NOT transpile: a circuit
// using anything else is accepted, queued, and only then fails. The node cannot transpile either,
// so it says so rather than letting the job fail minutes later.
const ISA_INSTRUCTIONS = new Set([
	'cz',
	'id',
	'rx',
	'rz',
	'rzz',
	'sx',
	'x',
	'measure',
	'reset',
	'delay',
	'barrier',
]);

// Read the instruction names out of an OpenQASM 3 program: the first identifier on each statement,
// skipping the header, includes and declarations. Only used to warn, never to reject, so a name
// this misses costs nothing.
export function nonIsaInstructions(qasm3: string): string[] {
	const found = new Set<string>();
	// Only statements at the top level are instructions the device runs. Qiskit's exporter writes a
	// definition block for anything outside stdgates, so a fully ISA circuit using rzz arrives with
	// `gate rzz(p0) a, b { cx a, b; rz(p0) b; cx a, b; }` in front of it. Reading those body lines
	// reported `gate` and `cx` and told the user a correct circuit would fail.
	let depth = 0;
	for (const rawLine of qasm3.split('\n')) {
		const line = rawLine.trim();
		const opens = (line.match(/\{/g) ?? []).length;
		const closes = (line.match(/\}/g) ?? []).length;
		const wasInsideBlock = depth > 0;
		depth += opens - closes;
		if (depth < 0) depth = 0;
		if (wasInsideBlock || opens > 0) continue;
		if (!line || line.startsWith('//')) continue;
		if (
			/^(OPENQASM|include|qubit|bit|creg|qreg|let|const|input|output|gate|def|defcal|defcalgrammar|extern|cal)\b/.test(
				line,
			)
		) {
			continue;
		}
		// `c[0] = measure q[0];` puts the instruction after the assignment.
		const statement = line.includes('=') ? line.slice(line.indexOf('=') + 1).trim() : line;
		const name = statement.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
		if (name && !ISA_INSTRUCTIONS.has(name)) found.add(name);
	}
	return [...found];
}

// Warn, never block. IBM accepts a non-ISA circuit, queues it, and fails it minutes later with an
// opaque message, so saying it up front costs nothing and saves the wait. QPY is compressed, so
// only an OpenQASM 3 program can be inspected.
function isaWarnings(format: string, source: string, backend: string): string[] {
	if (format === 'qpy') return [];
	const offISA = nonIsaInstructions(source);
	if (offISA.length === 0) return [];
	const verb = offISA.length === 1 ? 'is' : 'are';
	return [
		`Circuit uses ${offISA.join(', ')}, which ${verb} not in the IBM basis (cz, id, rx, rz, rzz, sx, x). Qiskit Runtime does not transpile, so this job will most likely fail. Transpile the circuit for ${backend} before submitting.`,
	];
}

function readSubmitEnvelope(
	this: IExecuteFunctions,
	itemIndex: number,
): {
	backend: string;
	circuit: unknown;
	sessionId: string;
	body: IDataObject;
	format: string;
	source: string;
} {
	const backend = requireIdentifier(
		this.getNodeParameter('backend', itemIndex),
		'Backend',
		this.getNode(),
		itemIndex,
	);
	// A workflow saved before the format selector existed stores no circuitFormat, so the default
	// keeps it on the OpenQASM 3 field it already filled in.
	const format = this.getNodeParameter('circuitFormat', itemIndex, 'qasm3') as string;
	const circuitParam = format === 'qpy' ? 'qpyCircuit' : 'qasm3';
	const circuitValue = this.getNodeParameter(circuitParam, itemIndex);
	const circuit = typeof circuitValue === 'string' ? circuitValue : asTrimmedString(circuitValue);
	// Optional, so an empty value simply means no session. Coerced rather than required, because a
	// numeric expression otherwise put session_id on the wire as a JSON number, where the schema
	// asks for a string.
	const sessionId = asTrimmedString(this.getNodeParameter('submitSessionId', itemIndex, ''));

	requireSupportedCircuit(circuit, format, this.getNode(), itemIndex);
	// QPY travels as the wrapper the official client sends, not as a bare string.
	const payload = format === 'qpy' ? qpyCircuitPayload(circuit) : circuit;

	const body: IDataObject = {};
	// session_id is a sibling of program_id/backend/params, never inside params.
	if (sessionId) body.session_id = sessionId;
	const tags = requireJobTags(
		this.getNodeParameter('jobTags', itemIndex, ''),
		this.getNode(),
		itemIndex,
	);
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

	return { backend, circuit: payload, sessionId, body, format, source: circuit };
}

async function submitJob(
	this: IExecuteFunctions,
	ctx: RequestContext,
	primitive: 'sampler' | 'estimator',
	itemIndex: number,
): Promise<IDataObject> {
	const { backend, circuit, sessionId, body, format, source } = readSubmitEnvelope.call(
		this,
		itemIndex,
	);

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
		// The spec bounds this to an integer in [0, 2]; anything else reached IBM verbatim.
		params.resilience_level = requireBoundedNumber(
			this.getNodeParameter('resilienceLevel', itemIndex, 1),
			'Resilience Level',
			{ min: 0, max: 2, integer: true },
			this.getNode(),
			itemIndex,
		);
		// Zero means "let IBM pick"; the spec otherwise requires a number strictly above zero.
		const precision = requireBoundedNumber(
			this.getNodeParameter('precision', itemIndex, 0),
			'Precision',
			{ min: 0 },
			this.getNode(),
			itemIndex,
		);
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

	const warnings = isaWarnings(format, source, backend);
	for (const warning of warnings) this.logger.warn(warning);

	const response = await ibmQuantumApiRequest.call(this, ctx, 'POST', '/jobs', body);
	return {
		jobId: response.id ?? null,
		backend,
		primitive,
		sessionId: sessionId || null,
		...(warnings.length > 0 ? { warnings } : {}),
		response,
	};
}

// The noise learner characterises the noise on a backend's entangling layers. It takes bare
// circuits rather than PUBs, and its options object is declared additionalProperties:false, so the
// Sampler and Estimator toggles must never be merged into it.
async function submitNoiseLearnerJob(
	this: IExecuteFunctions,
	ctx: RequestContext,
	itemIndex: number,
): Promise<IDataObject> {
	const { backend, circuit, sessionId, body, format, source } = readSubmitEnvelope.call(
		this,
		itemIndex,
	);
	const options = readAdditionalOptions.call(this, itemIndex);
	const learner = asCollection(this.getNodeParameter('noiseLearnerOptions', itemIndex, {}));

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

	const depthsInput = asNumberListInput(learner.layerPairDepths);
	if (depthsInput) {
		let depths: number[];
		try {
			depths = parseNumberListStrict(depthsInput, 'Layer Pair Depths');
		} catch (error) {
			const message = errorMessage(error);
			throw new NodeOperationError(this.getNode(), message, { itemIndex });
		}
		// The schema types these as integers. Without the check a fraction went through unchanged
		// and Infinity reached IBM as JSON null, since JSON has no way to write it.
		const notWhole = depths.find((depth) => !Number.isInteger(depth));
		if (notWhole !== undefined) {
			throw new NodeOperationError(
				this.getNode(),
				`Layer Pair Depths must be whole numbers; got ${notWhole}.`,
				{ itemIndex },
			);
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

	const warnings = isaWarnings(format, source, backend);
	for (const warning of warnings) this.logger.warn(warning);

	const response = await ibmQuantumApiRequest.call(this, ctx, 'POST', '/jobs', body);
	return {
		jobId: response.id ?? null,
		backend,
		primitive: 'noise-learner',
		sessionId: sessionId || null,
		...(warnings.length > 0 ? { warnings } : {}),
		response,
	};
}

// Split a comma-separated input into clean values. Used for tags, and for the list filters the
// analytics endpoints accept.
export function parseCsvList(value: unknown): string[] {
	// The UI field is comma-separated text, but `{{ $json.tags }}` hands over the array itself, which
	// is the natural expression to write. Returning [] for it was silent data loss: Update Tags PUTs
	// the full list, so an array input cleared every tag on the job. A number is coerced for the same
	// reason. Anything else has no sensible reading and stays [].
	const parts = Array.isArray(value)
		? value.map((entry) => asTrimmedString(entry))
		: asTrimmedString(value).split(',');
	return parts.map((tag) => tag.trim()).filter((tag) => tag !== '');
}

// IBM V2 terminal statuses are completed, canceled and failed. The British spelling and 'error'
// are defensive aliases for schema variants.
export const TERMINAL = ['completed', 'cancelled', 'canceled', 'failed', 'error'];

// The job carries both a state object and a top level status string. Read either.
// IBM's schema bounds a job tag list to 8 entries of at most 86 characters. Exceeding either fails
// the whole submit with a message that names neither the tag nor the bound, so check it here.
export const MAX_JOB_TAGS = 8;
export const MAX_JOB_TAG_LENGTH = 86;

// String.length counts UTF-16 code units, so one emoji counts as two. JSON Schema maxLength and
// minLength count characters, which is what IBM validates against, so an 86-emoji tag is legal and
// a 2-emoji search term is too short. Spreading the string iterates by code point.
export function characterLength(value: string): number {
	return [...value].length;
}

function requireJobTags(value: unknown, node: INode, itemIndex: number): string[] {
	// Update Tags PUTs the whole list, so an empty result deletes every tag on the job. Text and
	// arrays can say that deliberately, and a number is one tag. Anything else means the expression
	// did not resolve to a tag list, and wiping the job's tags is not a reasonable reading of that.
	const isTagList =
		typeof value === 'string' ||
		typeof value === 'number' ||
		Array.isArray(value) ||
		value === undefined;
	if (!isTagList) {
		throw new NodeOperationError(
			node,
			'Tags must be text or a list. Leave it empty to remove every tag from the job.',
			{ itemIndex },
		);
	}
	const tags = parseCsvList(value);
	if (tags.length > MAX_JOB_TAGS) {
		throw new NodeOperationError(
			node,
			`Tags has ${tags.length} entries; IBM accepts at most ${MAX_JOB_TAGS}.`,
			{ itemIndex },
		);
	}
	const tooLong = tags.find((tag) => characterLength(tag) > MAX_JOB_TAG_LENGTH);
	if (tooLong !== undefined) {
		throw new NodeOperationError(
			node,
			`Tag "${[...tooLong].slice(0, 20).join('')}..." is ${characterLength(tooLong)} characters; IBM accepts at most ${MAX_JOB_TAG_LENGTH}.`,
			{ itemIndex },
		);
	}
	return tags;
}

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
// Read the failure details the API buries under state, defaulting to null when absent. Shared
// so the trigger and Get Results can never report a failure differently.
export function stateError(job: IDataObject): IDataObject {
	const state = (job.state as IDataObject) ?? {};
	return {
		reason: state.reason ?? null,
		reasonCode: state.reason_code ?? null,
		reasonSolution: state.reason_solution ?? null,
	};
}

export function isTerminalStatus(status: string): boolean {
	return TERMINAL.includes(status) || status.startsWith('cancel');
}

// Coerce a user-supplied seconds value to a usable positive number, falling back when it is
// non-finite or below 1. The field's minValue is only a UI hint, so an expression can bypass it
// with 0, a negative number, or a non-numeric value (NaN). Without this, pollInterval -> NaN
// busy-loops the API and maxWait -> NaN makes the deadline NaN so the loop never times out.
// setTimeout takes a 32 bit signed delay: anything above 2^31-1 ms fires after 1 ms instead of
// waiting. Without an upper bound a poll interval past about 24.9 days therefore turned the wait
// into no wait at all, and the loop hammered the API until the deadline. An hour between checks and
// a day of waiting are both far beyond any real use and stay well inside that limit.
export const MAX_POLL_INTERVAL_SECONDS = 3600;
export const MAX_WAIT_SECONDS = 86400;

function clampSeconds(value: unknown, fallback: number, max: number): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return n > max ? max : n;
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
	const jobId = requireIdentifier(
		this.getNodeParameter('jobId', itemIndex),
		'Job ID',
		this.getNode(),
		itemIndex,
	);
	const intervalSec = clampSeconds(
		this.getNodeParameter('pollInterval', itemIndex, 5),
		5,
		MAX_POLL_INTERVAL_SECONDS,
	);
	const maxWaitSec = clampSeconds(
		this.getNodeParameter('maxWait', itemIndex, 300),
		300,
		MAX_WAIT_SECONDS,
	);
	const registerName = asTrimmedString(this.getNodeParameter('registerName', itemIndex, ''));

	const deadline = Date.now() + maxWaitSec * 1000;
	let status = '';
	let jobInfo: IDataObject = {};

	// Poll at least once, break on a terminal status, and never sleep past the deadline.
	// A transient failure (429, 5xx, dropped connection) retries until the deadline instead
	// of killing a poll that may already have waited many minutes.
	while (true) {
		try {
			jobInfo = await ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${pathSegment(jobId)}`);
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
	if (status !== 'completed') {
		// A job that failed or was cancelled has no results, and the reason sits two levels down in
		// the raw body. Lift it next to the status so the failure is readable without digging, the
		// same fields the trigger emits. The raw job stays untouched.
		return {
			jobId,
			status,
			...stateError(jobInfo),
			job: jobInfo,
		};
	}

	const results = await ibmQuantumApiRequest.call(
		this,
		ctx,
		'GET',
		`/jobs/${pathSegment(jobId)}/results`,
	);
	let parsed: IDataObject;
	try {
		parsed = parseResults(results, registerName || undefined);
	} catch (error) {
		// parseResults raises a plain Error for a Register Name the result does not carry.
		throw new NodeOperationError(this.getNode(), errorMessage(error), { itemIndex });
	}
	// IBM documents a 204 on this endpoint as "Job's final result not found". The transport turns
	// that empty body into {}, which parses to zero pubs and used to read as a completed job that
	// simply produced nothing. Saying which of the two it was costs one field.
	const resultsMissing = !Array.isArray(results.results);
	return {
		jobId,
		status,
		...parsed,
		...(resultsMissing ? { resultsAvailable: false } : {}),
		raw: results,
	};
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
		const filters = asCollection(this.getNodeParameter('listFilters', itemIndex, {}));
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
		// IBM rejects a search shorter than 3 characters with a bare 400 that names neither the
		// field nor the limit, so the bound is enforced here instead. There is no way to ask for
		// every tag: the endpoint always wants a term. `type` has one value today, so it is sent
		// rather than offered.
		const search = asTrimmedString(this.getNodeParameter('tagSearch', itemIndex, ''));
		const searchLength = characterLength(search);
		if (searchLength < TAG_SEARCH_MIN || searchLength > TAG_SEARCH_MAX) {
			throw new NodeOperationError(
				this.getNode(),
				`Search must be between ${TAG_SEARCH_MIN} and ${TAG_SEARCH_MAX} characters. IBM cannot list every tag, so a term is always required.`,
				{ itemIndex },
			);
		}
		return ibmQuantumApiRequest.call(this, ctx, 'GET', '/tags', undefined, {
			type: 'job',
			search,
		});
	}

	const jobId = requireIdentifier(
		this.getNodeParameter('jobId', itemIndex),
		'Job ID',
		this.getNode(),
		itemIndex,
	);
	if (operation === 'getStatus')
		return ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${pathSegment(jobId)}`);
	if (operation === 'getMetrics') {
		return ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${pathSegment(jobId)}/metrics`);
	}
	if (operation === 'getLogs') {
		// The logs endpoint returns plain text, not JSON, so wrap it for a structured item.
		let response: unknown;
		try {
			response = (await ibmQuantumApiRequest.call(
				this,
				ctx,
				'GET',
				`/jobs/${pathSegment(jobId)}/logs`,
			)) as unknown;
		} catch (error) {
			// IBM answers a job with no log file with a bare "logs not found", which reads as if the
			// job itself were missing.
			throw explainTerseError(
				error,
				'Logs for job',
				jobId,
				'A job that failed before it started running usually has none; check Get Status for the reason.',
			);
		}
		// Plain text comes back as a string. The transport turns an empty body into {}, which here
		// means no logs rather than an object worth returning.
		const body = response as IDataObject;
		const hasFields = Boolean(body) && Object.keys(body).length > 0;
		const logs = typeof response === 'string' ? response : hasFields ? body : '';
		return { jobId, logs };
	}
	if (operation === 'updateTags') {
		const tags = requireJobTags(
			this.getNodeParameter('jobTags', itemIndex, ''),
			this.getNode(),
			itemIndex,
		);
		// PUT replaces the full tag list and returns 204, so an empty input clears all tags.
		await ibmQuantumApiRequest.call(this, ctx, 'PUT', `/jobs/${pathSegment(jobId)}/tags`, { tags });
		return { jobId, tags };
	}
	if (operation === 'cancel') {
		await ibmQuantumApiRequest.call(this, ctx, 'POST', `/jobs/${pathSegment(jobId)}/cancel`);
		return { jobId, cancelled: true };
	}
	// Destructive requests only run on an exact match. An unknown operation must fail loudly
	// instead of falling through to a delete.
	if (operation === 'delete') {
		await ibmQuantumApiRequest.call(this, ctx, 'DELETE', `/jobs/${pathSegment(jobId)}`);
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
		const backend = requireIdentifier(
			this.getNodeParameter('sessionBackend', itemIndex),
			'Backend',
			this.getNode(),
			itemIndex,
		);
		// Zero deliberately means "omit max_ttl and let IBM pick", so this coerces without
		// substituting a fallback: anything not a positive number simply drops the field.
		const maxTtl = Math.floor(Number(this.getNodeParameter('maxTtl', itemIndex, 28800)));
		const body: IDataObject = { mode, backend };
		if (Number.isFinite(maxTtl) && maxTtl > 0) body.max_ttl = maxTtl;
		const response = await ibmQuantumApiRequest.call(this, ctx, 'POST', '/sessions', body);
		return { sessionId: response.id ?? null, mode, backend, response };
	}

	const sessionId = requireIdentifier(
		this.getNodeParameter('sessionId', itemIndex),
		'Session ID',
		this.getNode(),
		itemIndex,
	);
	if (operation === 'get') {
		return ibmQuantumApiRequest.call(this, ctx, 'GET', `/sessions/${pathSegment(sessionId)}`);
	}
	if (operation === 'setAccepting') {
		const acceptingJobs = this.getNodeParameter('acceptingJobs', itemIndex, true) as boolean;
		// PATCH returns 204 with no body, so report the requested state.
		await ibmQuantumApiRequest.call(this, ctx, 'PATCH', `/sessions/${pathSegment(sessionId)}`, {
			accepting_jobs: acceptingJobs,
		});
		return { sessionId, acceptingJobs };
	}
	// close: DELETE returns 204 with no body. Exact match only, so an unknown operation
	// cannot close a session by accident.
	if (operation === 'close') {
		await ibmQuantumApiRequest.call(
			this,
			ctx,
			'DELETE',
			`/sessions/${pathSegment(sessionId)}/close`,
		);
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
	const filters = asCollection(this.getNodeParameter('workloadFilters', itemIndex, {}));
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
	// The UI control is multiOptions, so it hands over an array, but an expression or an AI tool
	// sends a string. Requiring an array dropped the filter silently, which returns every workload
	// instead of the ones asked for. parseCsvList reads both shapes.
	const statuses = parseCsvList(filters.status);
	if (statuses.length > 0) qs.status = statuses;
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
	const filters = asCollection(this.getNodeParameter('analyticsFilters', itemIndex, {}));
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
		// IBM marks GET and PUT /instances/configuration deprecated in the live OpenAPI spec, in
		// favour of the Resource Controller API. Both still answer. Get Instance already reads the
		// same fields from /instance, which is not deprecated, so prefer that for reads.
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
	// See the note in handleBackend: an inherited Object member must not pass for an endpoint.
	const analyticsEndpoint = Object.hasOwn(ANALYTICS_ENDPOINTS, operation)
		? ANALYTICS_ENDPOINTS[operation]
		: undefined;
	if (analyticsEndpoint !== undefined) {
		const qs = analyticsQuery.call(this, itemIndex);
		if (operation === 'getAnalyticsGrouped') {
			qs.group_by = this.getNodeParameter('groupBy', itemIndex, 'backend') as string;
		}
		// The by-date endpoint requires group_by and accepts only this one value.
		if (operation === 'getAnalyticsByDate') qs.group_by = 'instance';
		return ibmQuantumApiRequest.call(this, ctx, 'GET', analyticsEndpoint, undefined, qs);
	}
	if (operation === 'setCostLimit') {
		// This write removes the spend cap when it sends null, so a value it cannot read must fail
		// rather than fall through to that. 'abc', '', null and a negative all used to clear the cap
		// silently, which is the opposite of what someone setting a limit intended.
		const requested = requireBoundedNumber(
			this.getNodeParameter('instanceLimit', itemIndex, 0),
			'Cost Limit',
			{ min: 0, integer: true },
			this.getNode(),
			itemIndex,
		);
		// Zero clears the limit, which the API expresses as an explicit null rather than an absent key.
		const instanceLimit = requested > 0 ? requested : null;
		// Deprecated by IBM alongside the GET above; there is no replacement write endpoint yet.
		await ibmQuantumApiRequest.call(this, ctx, 'PUT', '/instances/configuration', {
			instance_limit: instanceLimit,
		});
		return { instanceLimit };
	}
	throw new NodeOperationError(this.getNode(), `Unsupported account operation: ${operation}`, {
		itemIndex,
	});
}
