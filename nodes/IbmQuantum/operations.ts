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
	resourceControllerRequest,
	type RequestContext,
} from './transport';
import {
	buildQasm3,
	parseAngleList,
	parseNumberListStrict,
	parseParameterNames,
	renderInstructions,
	validateGateInput,
	type GateOperation,
} from './qasm3';
import { parseResults } from './results';

const CONTROLLED_TWO = new Set(['cx', 'cz', 'crx', 'cry', 'crz']);

// IBM refuses a job cost above three hours and silently caps anything larger.
export const MAX_JOB_COST_SECONDS = 10800;

// IBM caps GET /jobs at 200 and silently substitutes its default above that, so the same figure
// is the Limit ceiling and the page size Return All walks with.
export const MAX_JOB_LIST_LIMIT = 200;

// Fifty pages of 200 is 10,000 jobs, beyond any working set, and bounds Return All at fifty
// sequential requests should the server's count ever disagree with what it returns.
export const MAX_JOB_LIST_PAGES = 50;

// POST /jobs declares session_id as 1 to 36 characters, which is the length of the UUIDs Session
// Create returns. Every other bound in that schema is applied locally; this one was sent as typed.
export const MAX_SESSION_ID_LENGTH = 36;

// The tag search endpoint accepts a term of 3 to 100 characters and rejects anything else.
export const TAG_SEARCH_MIN = 3;
export const TAG_SEARCH_MAX = 100;

// Build a GateOperation from parsed, validated input.
function mapGate(
	gate: string,
	qubits: number[],
	params: Array<number | string>,
	clbit?: number,
	duration?: string,
): GateOperation {
	// Normalize the missing-clbit case to 0 here, because that is the value validateGateInput
	// range-checked. Leaving it undefined let the renderer fall back to the qubit index instead,
	// which passed validation and then emitted a write past the end of the classical register.
	if (gate === 'measure')
		return { gate, targets: [qubits[0]], controls: [], params: [], clbit: clbit ?? 0 };
	if (gate === 'delay') return { gate, targets: [qubits[0]], controls: [], params: [], duration };
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

function isPlainObject(value: unknown): value is IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A collection parameter reads as an object of set fields. getNodeParameter's fallback only applies
// when the parameter is absent, so an expression resolving to null went straight through and the
// first field read threw a raw TypeError. An array is rejected too: it has no named fields, so
// treating it as a collection would silently read nothing.
export function asCollection(value: unknown): IDataObject {
	return isPlainObject(value) ? value : {};
}

export interface NumberBounds {
	min: number;
	max?: number;
	integer?: boolean;
}

// The spec types every count inside params.options as int32, and the twirling counts also accept
// the literal "auto", which is what the official client sends by default.
export const INT32_MAX = 2147483647;
const COUNT_BOUNDS: NumberBounds = { min: 1, max: INT32_MAX, integer: true };

function boundsPhrase(bounds: NumberBounds): string {
	const kind = bounds.integer ? 'an integer' : 'a number';
	const range =
		bounds.max === undefined ? `at least ${bounds.min}` : `between ${bounds.min} and ${bounds.max}`;
	return `${kind} ${range}`;
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
		throw new NodeOperationError(node, `${label} must be ${boundsPhrase(bounds)}.`, { itemIndex });
	}
	return n;
}

// Twirling counts and the PEC noise gain take a number or the literal "auto". A value that is not
// there, an entry never added or an expression that resolved to nothing, and text the user cleared
// leave the key out; nothing else does. asTrimmedString flattens a boolean, an array and an object
// to '' as well, and reading those as "cleared" dropped the requested error mitigation from a job
// that still ran on hardware, with nothing in the output to say so.
export function requireBoundedNumberOrAuto(
	value: unknown,
	label: string,
	bounds: NumberBounds,
	node: INode,
	itemIndex: number,
): number | 'auto' | undefined {
	if (value === undefined) return undefined;
	const readable = typeof value === 'string' || typeof value === 'number';
	const text = asTrimmedString(value);
	if (readable && text === '') return undefined;
	if (text.toLowerCase() === 'auto') return 'auto';
	if (!readable || Number.isNaN(Number(text))) {
		throw new NodeOperationError(node, `${label} must be "auto" or ${boundsPhrase(bounds)}.`, {
			itemIndex,
		});
	}
	return requireBoundedNumber(text, label, bounds, node, itemIndex);
}

// n8n type-checks a parameter only while the user is typing it; a value an expression produced
// reaches the node exactly as the expression left it, so a switch can arrive as text, a number or
// an object. Every reading the node used was wrong for one of those: read for truth, the string
// 'false' turned a switch on; compared with the boolean, 'true' left it off; passed straight
// through, an object travelled to IBM in place of a flag. Only the last of the three echoed the raw
// value straight back into the output item. A value that is not there, an entry never added or an
// expression that resolved to nothing, keeps the field's own default; anything else is refused, an
// array and an object included, rather than run through Number() the way n8n's own parser would.
export function optionalBoolean(
	value: unknown,
	label: string,
	node: INode,
	itemIndex: number,
): boolean | undefined {
	if (typeof value === 'boolean') return value;
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string' || typeof value === 'number') {
		const text = String(value).trim();
		if (text === '') return undefined;
		const lower = text.toLowerCase();
		if (lower === 'true') return true;
		if (lower === 'false') return false;
		if (Number(text) === 1) return true;
		if (Number(text) === 0) return false;
	}
	throw new NodeOperationError(
		node,
		`${label} must be true or false. An expression may also hand over "true", "false", 1 or 0.`,
		{ itemIndex },
	);
}

export function requireBoolean(
	value: unknown,
	label: string,
	fallback: boolean,
	node: INode,
	itemIndex: number,
): boolean {
	return optionalBoolean(value, label, node, itemIndex) ?? fallback;
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
	let parameterNames: string[];
	try {
		parameterNames = parseParameterNames(
			asNumberListInput(this.getNodeParameter('circuitParameters', itemIndex, '')),
		);
	} catch (error) {
		throw new NodeOperationError(node, errorMessage(error), { itemIndex });
	}
	const declared = new Set(parameterNames);
	const gatesParam = asCollection(this.getNodeParameter('gates', itemIndex, {}));
	// An expression can set the whole collection, so the entry list is no more trusted to be a list
	// than the collection is to be an object. An entry that is not one reads as empty rather than
	// being dropped, so it is still refused by its number instead of shortening the circuit.
	const rawGates = (Array.isArray(gatesParam.gate) ? (gatesParam.gate as unknown[]) : []).map(
		asCollection,
	);

	const gates = rawGates.map((raw, idx) => {
		const gate = raw.gate as string;
		let qubits: number[];
		let params: Array<number | string>;
		try {
			qubits = parseNumberListStrict(asNumberListInput(raw.qubits), 'Qubits');
			params = parseAngleList(asNumberListInput(raw.params), 'Parameters', declared);
		} catch (error) {
			const message = errorMessage(error);
			throw new NodeOperationError(node, `Gate #${idx + 1} (${gate}): ${message}`, {
				itemIndex,
			});
		}
		const clbit = raw.clbit as number | undefined;
		const duration = asTrimmedString(raw.duration);
		const problem = validateGateInput(gate, qubits, params, clbit, numQubits, numClbits, duration);
		if (problem) {
			throw new NodeOperationError(node, `Gate #${idx + 1}: ${problem}`, { itemIndex });
		}
		return mapGate(gate, qubits, params, clbit, duration);
	});

	const circuit = { numQubits, numClbits, gates, parameters: parameterNames };
	return {
		qasm3: buildQasm3(circuit),
		numQubits,
		numClbits,
		gateCount: gates.length,
		instructionCount: renderInstructions(circuit).length,
		...(parameterNames.length > 0 ? { parameterNames } : {}),
	};
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

// Read rather than copied: a field IBM omits would put `undefined` in the item, and a key holding
// `undefined` is gone once n8n has serialised it, so an expression testing the documented null
// finds no key at all. IBM declares `qubits` nullable and leaves it out of the required device
// fields; `name` is required there, but nothing else here trusts the body's shape either.
function deviceName(device: IDataObject): string | null {
	return typeof device.name === 'string' ? (device.name as string) : null;
}

function qubitsOf(device: IDataObject): number | null {
	return typeof device.qubits === 'number' ? (device.qubits as number) : null;
}

// Devices with an unknown queue length sort last but keep their real (null) value in the output.
function queueRank(device: IDataObject): number {
	return queueLengthOf(device) ?? Number.MAX_SAFE_INTEGER;
}

export interface ProcessorType {
	family: string | null;
	revision: string | null;
}

export function processorTypeOf(device: IDataObject): ProcessorType {
	const raw = device.processor_type;
	const processor =
		raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as IDataObject) : {};
	const family = asTrimmedString(processor.family);
	const revision = asTrimmedString(processor.revision);
	return { family: family === '' ? null : family, revision: revision === '' ? null : revision };
}

export interface WaitTimeSeconds {
	average: number | null;
	p50: number | null;
	p95: number | null;
}

// Only present when the listing was asked for fields=wait_time_seconds. Read field by field, so a
// partial object still ranks on whatever figure it does carry.
function waitTimeOf(device: IDataObject): WaitTimeSeconds | null {
	const raw = device.wait_time_seconds;
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const wait = raw as IDataObject;
	const pick = (key: keyof WaitTimeSeconds) =>
		typeof wait[key] === 'number' ? (wait[key] as number) : null;
	return { average: pick('average'), p50: pick('p50'), p95: pick('p95') };
}

// Rank By value to the wait_time_seconds field it reads; null means queue_length.
export const RANK_METRICS: Record<string, keyof WaitTimeSeconds | null> = {
	queueLength: null,
	waitAverage: 'average',
	waitP50: 'p50',
	waitP95: 'p95',
};

// A device without the chosen figure sorts last but keeps its real (null) value in the output.
function rankValue(device: IDataObject, metric: keyof WaitTimeSeconds | null): number {
	const value = metric === null ? queueLengthOf(device) : waitTimeOf(device)?.[metric];
	return value ?? Number.MAX_SAFE_INTEGER;
}

// The backends list carries status, qubit count, queue length and processor type per device; the
// wait figures need fields=wait_time_seconds on the same call, which costs nothing extra.
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
	const includeSimulators = requireBoolean(
		this.getNodeParameter('includeSimulators', itemIndex, false),
		'Include Simulators',
		false,
		this.getNode(),
		itemIndex,
	);

	const rankByInput = this.getNodeParameter('rankBy', itemIndex, 'queueLength');
	// An expression that resolves to nothing keeps the default ranking, the release-wide rule for
	// options fields; only a value that is really there and is not one of the four is refused.
	const rankByEmpty =
		rankByInput === undefined ||
		rankByInput === null ||
		(typeof rankByInput === 'string' && rankByInput.trim() === '');
	const rankBy = rankByEmpty ? 'queueLength' : asTrimmedString(rankByInput);
	// hasOwn for the same reason as the endpoint map in handleBackend: the value is a raw string
	// from an expression and 'toString' would otherwise resolve to an inherited member.
	if (!Object.hasOwn(RANK_METRICS, rankBy)) {
		throw new NodeOperationError(
			this.getNode(),
			`Rank By must be one of ${Object.keys(RANK_METRICS).join(', ')}.`,
			{ itemIndex },
		);
	}
	const metric = RANK_METRICS[rankBy];

	const familyInput = this.getNodeParameter('processorFamily', itemIndex, '');
	// Text or nothing. An array or an object from an expression must not silently mean "any
	// family": the filter exists to keep a fractional-gate circuit off a Nighthawk device.
	if (
		familyInput !== undefined &&
		familyInput !== null &&
		typeof familyInput !== 'string' &&
		typeof familyInput !== 'number'
	) {
		throw new NodeOperationError(
			this.getNode(),
			'Processor Family must be text such as Heron or Nighthawk, or empty for any family.',
			{ itemIndex },
		);
	}
	const family = asTrimmedString(familyInput).toLowerCase();

	const response = await ibmQuantumApiRequest.call(this, ctx, 'GET', '/backends', undefined, {
		fields: 'wait_time_seconds',
	});
	// Guard on the shape, not just on null: `?? []` let a non-array `devices` through to .filter and
	// a null entry through to the ranking, each ending the item with a bare TypeError instead of an
	// answer. Same guard as the backend list in loadOptions.ts.
	const devices = (Array.isArray(response.devices) ? (response.devices as unknown[]) : []).filter(
		isPlainObject,
	);

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
			if (family !== '' && processorTypeOf(device).family?.toLowerCase() !== family) return false;
			return statusName(device) === 'online';
		})
		.sort((a, b) => rankValue(a, metric) - rankValue(b, metric) || queueRank(a) - queueRank(b));

	const best = candidates[0];
	return {
		leastBusy: best ? deviceName(best) : null,
		queueLength: best ? queueLengthOf(best) : null,
		waitTimeSeconds: best ? waitTimeOf(best) : null,
		candidates: candidates.map((device) => ({
			name: deviceName(device),
			queueLength: queueLengthOf(device),
			qubits: qubitsOf(device),
			status: statusName(device),
			...processorTypeOf(device),
			waitTimeSeconds: waitTimeOf(device),
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
	const qs: IDataObject = {};
	if (operation === 'getConfiguration' || operation === 'getProperties') {
		const calibrationId = optionalCalibrationId(
			this.getNodeParameter('calibrationId', itemIndex, ''),
			this.getNode(),
			itemIndex,
		);
		if (calibrationId !== undefined) qs.calibration_id = calibrationId;
	}
	if (operation === 'getProperties') {
		const updatedBefore = optionalDateTime(
			this.getNodeParameter('updatedBefore', itemIndex, ''),
			'Updated Before',
			this.getNode(),
			itemIndex,
		);
		if (updatedBefore !== undefined) qs.updated_before = updatedBefore;
	}
	try {
		return await ibmQuantumApiRequest.call(
			this,
			ctx,
			'GET',
			endpoint,
			undefined,
			Object.keys(qs).length > 0 ? qs : undefined,
		);
	} catch (error) {
		// A 404 with a calibration set may be about the calibration rather than the device.
		const hint =
			qs.calibration_id === undefined
				? 'Check the name against Backend > Get Many; names are lowercase, for example ibm_kingston.'
				: `Check the name against Backend > Get Many, and that calibration "${String(qs.calibration_id)}" belongs to it.`;
		throw explainTerseError(error, 'Backend', backendName, hint);
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

// The dedicated fields win over Additional Options one key at a time, so a JSON block that sets
// zne.extrapolator keeps it when the ZNE Noise Factors field only sets zne.noise_factors.
export function mergeOptionTrees(base: IDataObject, override: IDataObject): IDataObject {
	const merged: IDataObject = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const current = merged[key];
		merged[key] =
			isPlainObject(current) && isPlainObject(value) ? mergeOptionTrees(current, value) : value;
	}
	return merged;
}

// Merge structured V2 toggles onto a base options object. Only keys the user set are added,
// since params.options is additionalProperties:false and rejects unknown keys.
export function mergePrimitiveOptions(
	base: IDataObject,
	dynamicalDecoupling: boolean,
	twirlGates: boolean,
	twirlMeasure: boolean,
	fields: IDataObject = {},
): IDataObject {
	const options = mergeOptionTrees(base, fields);
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

export type SubmitProgram = 'sampler' | 'estimator' | 'noise-learner';

// params.options is additionalProperties:false for all three programs, so IBM refuses an unknown
// key with a message that names neither the key nor the field. These are the top-level keys the
// OpenAPI spec (0.50.5) lists. `environment` is deliberately absent: it is the Python client's
// bundle for log_level, job_tags and private, which are the Log Level, Tags and Private fields here.
export const ADDITIONAL_OPTION_KEYS: Record<SubmitProgram, readonly string[]> = {
	sampler: [
		'default_shots',
		'dynamical_decoupling',
		'execution',
		'experimental',
		'simulator',
		'twirling',
	],
	estimator: [
		'default_precision',
		'default_shots',
		'dynamical_decoupling',
		'execution',
		'experimental',
		'resilience',
		'seed_estimator',
		'simulator',
		'twirling',
	],
	'noise-learner': [
		'experimental',
		'layer_pair_depths',
		'max_layers_to_learn',
		'num_randomizations',
		'shots_per_randomization',
		'simulator',
		'support_qiskit',
		'twirling_strategy',
	],
};

const PROGRAM_LABELS: Record<SubmitProgram, string> = {
	sampler: 'Sampler',
	estimator: 'Estimator',
	'noise-learner': 'Noise Learner',
};

function requireKnownOptionKeys(
	options: IDataObject,
	program: SubmitProgram,
	node: INode,
	itemIndex: number,
): void {
	const allowed = ADDITIONAL_OPTION_KEYS[program];
	const unknown = Object.keys(options).filter((key) => !allowed.includes(key));
	if (unknown.length === 0) return;
	const listed = unknown.map((key) => `"${key}"`).join(', ');
	const verb = unknown.length === 1 ? 'is' : 'are';
	const hint = unknown.includes('environment')
		? ' There is no "environment" key in the REST API: use the Log Level, Tags and Private fields instead.'
		: '';
	throw new NodeOperationError(
		node,
		`Additional Options: ${listed} ${verb} not among the ${PROGRAM_LABELS[program]} options. IBM accepts only ${allowed.join(', ')} at the top level.${hint}`,
		{ itemIndex },
	);
}

// Comma-separated numbers typed as text, or the array an expression hands over. Empty means the
// key is left out. Checked here because a fraction went through unchanged and Infinity reached
// IBM as JSON null, since JSON has no way to write it.
function readNumberList(
	value: unknown,
	label: string,
	integers: boolean,
	node: INode,
	itemIndex: number,
): number[] | undefined {
	const input = asNumberListInput(value);
	if (!input) return undefined;
	let numbers: number[];
	try {
		numbers = parseNumberListStrict(input, label);
	} catch (error) {
		throw new NodeOperationError(node, errorMessage(error), { itemIndex });
	}
	const bad = numbers.find((entry) =>
		integers ? !Number.isInteger(entry) : !Number.isFinite(entry),
	);
	if (bad !== undefined) {
		throw new NodeOperationError(
			node,
			`${label} must be ${integers ? 'whole' : 'finite'} numbers; got ${bad}.`,
			{ itemIndex },
		);
	}
	return numbers;
}

// A collection carries only the entries the user added, so presence is intent. An entry never
// added leaves the key out; anything else is read as the switch it is, so an expression writing
// 'false' into one of these sends false rather than dropping the entry and leaving IBM's default.
function copyFlag(
	raw: IDataObject,
	from: string,
	out: IDataObject,
	to: string,
	label: string,
	node: INode,
	itemIndex: number,
): void {
	const value = optionalBoolean(raw[from], label, node, itemIndex);
	if (value !== undefined) out[to] = value;
}

function copyChoice(raw: IDataObject, from: string, out: IDataObject, to: string): void {
	const value = raw[from];
	if (typeof value === 'string' && value !== '') out[to] = value;
}

export function twirlingFieldOptions(
	raw: IDataObject,
	node: INode,
	itemIndex: number,
): IDataObject {
	const out: IDataObject = {};
	const randomizations = requireBoundedNumberOrAuto(
		raw.numRandomizations,
		'Number of Randomizations',
		COUNT_BOUNDS,
		node,
		itemIndex,
	);
	if (randomizations !== undefined) out.num_randomizations = randomizations;
	const shots = requireBoundedNumberOrAuto(
		raw.shotsPerRandomization,
		'Shots per Randomization',
		COUNT_BOUNDS,
		node,
		itemIndex,
	);
	if (shots !== undefined) out.shots_per_randomization = shots;
	copyChoice(raw, 'strategy', out, 'strategy');
	return out;
}

export function dynamicalDecouplingFieldOptions(
	raw: IDataObject,
	node: INode,
	itemIndex: number,
): IDataObject {
	const out: IDataObject = {};
	copyChoice(raw, 'sequenceType', out, 'sequence_type');
	copyChoice(raw, 'extraSlackDistribution', out, 'extra_slack_distribution');
	copyChoice(raw, 'schedulingMethod', out, 'scheduling_method');
	copyFlag(raw, 'skipResetQubits', out, 'skip_reset_qubits', 'Skip Reset Qubits', node, itemIndex);
	return out;
}

export function executionFieldOptions(
	raw: IDataObject,
	primitive: 'sampler' | 'estimator',
	node: INode,
	itemIndex: number,
): IDataObject {
	const out: IDataObject = {};
	copyFlag(raw, 'initQubits', out, 'init_qubits', 'Initialize Qubits', node, itemIndex);
	if (raw.repDelay !== undefined) {
		out.rep_delay = requireBoundedNumber(
			raw.repDelay,
			'Repetition Delay (Seconds)',
			{ min: 0 },
			node,
			itemIndex,
		);
	}
	// The Estimator's execution block has no meas_type in the spec. The UI hides the field for it;
	// this drops it when an expression hands over the whole collection.
	if (primitive === 'sampler') copyChoice(raw, 'measType', out, 'meas_type');
	return out;
}

export function resilienceFieldOptions(
	raw: IDataObject,
	node: INode,
	itemIndex: number,
): IDataObject {
	const out: IDataObject = {};
	copyFlag(
		raw,
		'measureMitigation',
		out,
		'measure_mitigation',
		'Measurement Mitigation',
		node,
		itemIndex,
	);
	copyFlag(raw, 'zneMitigation', out, 'zne_mitigation', 'ZNE Mitigation', node, itemIndex);
	copyFlag(raw, 'pecMitigation', out, 'pec_mitigation', 'PEC Mitigation', node, itemIndex);

	const zne: IDataObject = {};
	const noiseFactors = readNumberList(
		raw.zneNoiseFactors,
		'ZNE Noise Factors',
		false,
		node,
		itemIndex,
	);
	if (noiseFactors) zne.noise_factors = noiseFactors;
	const extrapolator = parseCsvList(raw.zneExtrapolator);
	if (extrapolator.length > 0) zne.extrapolator = extrapolator;
	copyChoice(raw, 'zneAmplifier', zne, 'amplifier');
	if (Object.keys(zne).length > 0) out.zne = zne;

	const pec: IDataObject = {};
	if (raw.pecMaxOverhead !== undefined) {
		const overhead = requireBoundedNumber(
			raw.pecMaxOverhead,
			'PEC Max Overhead',
			{ min: 0 },
			node,
			itemIndex,
		);
		// Zero stands for "no cap", which the schema spells as null.
		pec.max_overhead = overhead > 0 ? overhead : null;
	}
	const gain = requireBoundedNumberOrAuto(
		raw.pecNoiseGain,
		'PEC Noise Gain',
		{ min: 0 },
		node,
		itemIndex,
	);
	if (gain !== undefined) pec.noise_gain = gain;
	if (Object.keys(pec).length > 0) out.pec = pec;

	const learning: IDataObject = {};
	const counts: Array<[string, string]> = [
		['noiseLearningMaxLayers', 'max_layers_to_learn'],
		['noiseLearningRandomizations', 'num_randomizations'],
		['noiseLearningShotsPerRandomization', 'shots_per_randomization'],
	];
	for (const [param, key] of counts) {
		// Zero means "leave it to IBM", the reading the noise learner's own collection already has.
		const value = clampCount(raw[param], 0);
		if (value > 0) learning[key] = value;
	}
	const depths = readNumberList(
		raw.noiseLearningLayerPairDepths,
		'Noise Learning Layer Pair Depths',
		true,
		node,
		itemIndex,
	);
	if (depths) learning.layer_pair_depths = depths;
	if (Object.keys(learning).length > 0) out.layer_noise_learning = learning;

	return out;
}

// The JSON escape hatch, shared by every program. Returns a fresh object so callers can extend it.
function readAdditionalOptions(
	this: IExecuteFunctions,
	itemIndex: number,
	program: SubmitProgram,
): IDataObject {
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
			`Additional Options must be a JSON object, or {} for none. Its top-level keys are the ${PROGRAM_LABELS[program]} options: ${ADDITIONAL_OPTION_KEYS[program].join(', ')}.`,
			{ itemIndex },
		);
	}
	const options = parsed && typeof parsed === 'object' ? { ...(parsed as IDataObject) } : {};
	requireKnownOptionKeys(options, program, this.getNode(), itemIndex);
	return options;
}

function buildPrimitiveOptions(
	this: IExecuteFunctions,
	itemIndex: number,
	primitive: 'sampler' | 'estimator',
): IDataObject {
	const node = this.getNode();
	const fields: IDataObject = {};
	const shared: Array<[string, string, (raw: IDataObject) => IDataObject]> = [
		['twirlingOptions', 'twirling', (raw) => twirlingFieldOptions(raw, node, itemIndex)],
		[
			'dynamicalDecouplingOptions',
			'dynamical_decoupling',
			(raw) => dynamicalDecouplingFieldOptions(raw, node, itemIndex),
		],
		[
			'executionOptions',
			'execution',
			(raw) => executionFieldOptions(raw, primitive, node, itemIndex),
		],
	];
	for (const [param, key, map] of shared) {
		const mapped = map(asCollection(this.getNodeParameter(param, itemIndex, {})));
		if (Object.keys(mapped).length > 0) fields[key] = mapped;
	}
	if (primitive === 'estimator') {
		const resilience = resilienceFieldOptions(
			asCollection(this.getNodeParameter('resilienceOptions', itemIndex, {})),
			node,
			itemIndex,
		);
		if (Object.keys(resilience).length > 0) fields.resilience = resilience;
		// Text rather than a number field, because 0 is a real seed and an empty field is not.
		const seed = asTrimmedString(this.getNodeParameter('seedEstimator', itemIndex, ''));
		if (seed !== '') {
			fields.seed_estimator = requireBoundedNumber(
				seed,
				'Seed Estimator',
				{ min: 0, max: INT32_MAX, integer: true },
				node,
				itemIndex,
			);
		}
		// Zero means "let IBM pick", the reading the Precision field already has.
		const defaultPrecision = requireBoundedNumber(
			this.getNodeParameter('defaultPrecision', itemIndex, 0),
			'Default Precision',
			{ min: 0 },
			node,
			itemIndex,
		);
		if (defaultPrecision > 0) fields.default_precision = defaultPrecision;
	}
	const toggle = (param: string, label: string): boolean =>
		requireBoolean(this.getNodeParameter(param, itemIndex, false), label, false, node, itemIndex);
	return mergePrimitiveOptions(
		readAdditionalOptions.call(this, itemIndex, primitive),
		toggle('dynamicalDecoupling', 'Dynamical Decoupling'),
		toggle('twirlingGates', 'Gate Twirling'),
		toggle('twirlingMeasure', 'Measurement Twirling'),
		fields,
	);
}

// Every program shares the same job envelope: which backend, which circuit, and the job-level
// fields that sit beside params rather than inside it.
// The Heron basis (cz, id, rx, rz, rzz, sx, x) is only the fallback: Nighthawk r1 (ibm_miami,
// ibm_berlin) reports cz, id, rz, sx, x with no rx and no rzz, so a fixed list passed circuits
// those devices reject. On submit the backend's own basis_gates is read from its configuration and
// this set stands in only when that read fails. Qiskit Runtime does NOT transpile: a circuit
// using anything else is accepted, queued, and only then fails. The node cannot transpile either,
// so it says so rather than letting the job fail minutes later.
// rzz belongs here, measured on ibm_fez: the Qiskit export, which carries
// `gate rzz(p0) a, b { cx a, b; rz(p0) b; cx a, b; }` ahead of the call, completed and returned
// 64/64 shots on `00`, the correct reading for a diagonal phase gate on |00>. What fails is the
// bare call with no definition, since stdgates.inc does not define rzz: that comes back Failed with
// a rejection naming `gate 'rzz' is not defined`. The distinction is the definition, not the gate,
// so it is handled by undefinedGateWarnings rather than by dropping rzz from the basis.
export const FALLBACK_BASIS_GATES = ['cz', 'id', 'rx', 'rz', 'rzz', 'sx', 'x'];
// Supported on every device and never listed in basis_gates, so they are allowed on top of it.
const ISA_DIRECTIVES = ['measure', 'reset', 'delay', 'barrier'];
const ISA_INSTRUCTIONS: ReadonlySet<string> = new Set([...FALLBACK_BASIS_GATES, ...ISA_DIRECTIVES]);

// Read the instruction names out of an OpenQASM 3 program: the first identifier on each statement,
// skipping the header, includes and declarations. Only used to warn, never to reject, so a name
// this misses costs nothing. The allowed set defaults to the Heron union so the palette check in
// the metadata test has a fixed reference; the submit path passes the backend's own set.
export function nonIsaInstructions(
	qasm3: string,
	allowed: ReadonlySet<string> = ISA_INSTRUCTIONS,
): string[] {
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
		if (name && !allowed.has(name)) found.add(name);
	}
	return [...found];
}

// Exact case on purpose: OpenQASM gate names are case sensitive, so `U` must never match a basis
// entry `u`.
function instructionNames(raw: unknown[]): string[] {
	return [
		...new Set(
			raw
				.filter((entry): entry is string => typeof entry === 'string')
				.map((entry) => entry.trim())
				.filter((entry) => entry !== ''),
		),
	];
}

// IBM types basis_gates as a non-empty array of strings. Anything else means the configuration
// cannot be trusted for the check, and the Heron union stands in.
export function readBasisGates(config: unknown): string[] | null {
	if (typeof config !== 'object' || config === null) return null;
	const raw = (config as IDataObject).basis_gates;
	if (!Array.isArray(raw)) return null;
	const gates = instructionNames(raw);
	return gates.length > 0 ? gates : null;
}

// IBM lists measure_2, if_else, store and the like under supported_instructions, and a Heron
// device with fractional gates off may list rx and rzz only there, so the check allows these beside
// basis_gates. The warning still names basis_gates alone, the list Get Configuration shows.
export function readSupportedInstructions(config: unknown): string[] {
	if (typeof config !== 'object' || config === null) return [];
	const raw = (config as IDataObject).supported_instructions;
	return Array.isArray(raw) ? instructionNames(raw) : [];
}

// Pairs the circuit acts on that the device does not physically couple. Only groups of exactly two
// are checked: anything wider is not a direct hardware interaction and the ISA warning already
// covers it. The map is read as undirected, which matches what IBM publishes: all 352 pairs on
// ibm_fez carry their own reverse. An unreadable map yields no pairs rather than a false alarm.
export function uncoupledPairs(operands: number[][], couplingMap: unknown): number[][] {
	if (!Array.isArray(couplingMap)) return [];
	const coupled = new Set<string>();
	for (const entry of couplingMap) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const [a, b] = entry;
		if (typeof a !== 'number' || typeof b !== 'number') continue;
		coupled.add(`${a},${b}`);
		coupled.add(`${b},${a}`);
	}
	if (coupled.size === 0) return [];
	return operands.filter((group) => group.length === 2 && !coupled.has(`${group[0]},${group[1]}`));
}

// The neighbours a qubit does have, so the message can say what to use instead.
export function coupledNeighbours(qubit: number, couplingMap: unknown): number[] {
	if (!Array.isArray(couplingMap)) return [];
	const near = new Set<number>();
	for (const entry of couplingMap) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const [a, b] = entry;
		if (a === qubit && typeof b === 'number') near.add(b);
		if (b === qubit && typeof a === 'number') near.add(a);
	}
	return [...near].sort((x, y) => x - y);
}

// One read per submit, shared by the ISA and coupling checks. QPY cannot be inspected, so nothing
// is fetched for it. Reading the configuration is a courtesy, not a precondition: a failure
// returns null and the submit continues, unwarned by the coupling check and warned against the
// Heron union by the ISA check, exactly as before the backend's own basis was consulted.
async function readBackendConfiguration(
	this: IExecuteFunctions,
	ctx: RequestContext,
	backend: string,
	format: string,
): Promise<IDataObject | null> {
	if (format === 'qpy') return null;
	try {
		const config: unknown = await ibmQuantumApiRequest.call(
			this,
			ctx,
			'GET',
			`/backends/${pathSegment(backend)}/configuration`,
		);
		return typeof config === 'object' && config !== null && !Array.isArray(config)
			? (config as IDataObject)
			: null;
	} catch {
		return null;
	}
}

// The number of distinct uncoupled pairs grows with the square of the qubits an untranspiled
// circuit touches: 100 virtual qubits wired all to all touch 4950 pairs, 4839 of them uncoupled on
// ibm_fez, which was 0.72 MB of near-identical sentences on the output item and 4839 lines in the
// n8n log for one submit. Every line carries the same advice, so the list stops here and one
// closing sentence counts the rest.
export const MAX_COUPLING_WARNINGS = 20;

// Warn when a two-qubit gate lands on a pair the chip does not connect. IBM accepts such a job,
// queues it, and only then fails it, charging the fixed per-job overhead, so catching it here saves
// both the wait and the quota. The map comes from the configuration the submit reads once for
// every OpenQASM 3 circuit; an unreadable map yields no warning rather than a false one.
function couplingWarnings(backend: string, sources: string[], couplingMap: unknown): string[] {
	if (!Array.isArray(couplingMap)) return [];
	const operands = sources.flatMap(multiQubitOperands);
	if (!operands.some((group) => group.length === 2)) return [];

	const bad = uncoupledPairs(operands, couplingMap);
	if (bad.length === 0) return [];
	// A batch of variants repeats the same offending pair, and one circuit can write a pair in both
	// operand orders. The map is read as undirected, so those are one physical pair: reported once,
	// in the order it was first written. Keeping both would name it twice and inflate the count in
	// the closing sentence below.
	const pairs = new Map<string, number[]>();
	for (const [a, b] of bad) {
		const key = a < b ? `${a},${b}` : `${b},${a}`;
		if (!pairs.has(key)) pairs.set(key, [a, b]);
	}
	const warnings = [...pairs.values()].slice(0, MAX_COUPLING_WARNINGS).map(([a, b]) => {
		const near = coupledNeighbours(a, couplingMap);
		const hint = near.length > 0 ? ` Qubit ${a} connects to ${near.join(', ')}.` : '';
		return `Circuit puts a two-qubit gate on qubits ${a} and ${b}, which ${backend} does not couple. IBM will accept the job and then fail it.${hint}`;
	});
	const rest = pairs.size - warnings.length;
	if (rest > 0) {
		warnings.push(
			`Circuit puts two-qubit gates on ${rest} further ${rest === 1 ? 'pair' : 'pairs'} ${backend} does not couple, not listed here. Transpile the circuit for ${backend} before submitting.`,
		);
	}
	return warnings;
}

// Warn, never block. IBM accepts a non-ISA circuit, queues it, and fails it minutes later with an
// opaque message, so saying it up front costs nothing and saves the wait. QPY is compressed, so
// only an OpenQASM 3 program can be inspected. The basis named is the backend's own when its
// configuration could be read, and the Heron union otherwise, in which case the wording is
// unchanged from before. What the configuration lists under supported_instructions is allowed
// beside the basis but never named, so the warning quotes the list Get Configuration shows.
function isaWarnings(
	format: string,
	source: string,
	backend: string,
	basis: string[] | null,
	supported: string[],
): string[] {
	if (format === 'qpy') return [];
	const allowed = basis ? new Set([...basis, ...supported, ...ISA_DIRECTIVES]) : ISA_INSTRUCTIONS;
	const offISA = nonIsaInstructions(source, allowed);
	if (offISA.length === 0) return [];
	const verb = offISA.length === 1 ? 'is' : 'are';
	const owner = basis
		? `${backend} basis (${basis.join(', ')})`
		: `IBM basis (${FALLBACK_BASIS_GATES.join(', ')})`;
	return [
		`Circuit uses ${offISA.join(', ')}, which ${verb} not in the ${owner}. Qiskit Runtime does not transpile, so this job will most likely fail. Transpile the circuit for ${backend} before submitting.`,
	];
}

// rzz is in the Heron basis, so the ISA scan passes it there, but stdgates.inc does not define it.
// A circuit that calls it without carrying its own `gate rzz` block therefore fails validation with
// a rejection naming `gate 'rzz' is not defined`, measured on ibm_fez. Do not match on the reason
// code: the identical program returned 1506 at 04:37 UTC and 1603 at 17:29 UTC the same day, on the
// same device, so IBM changes it. The message is the stable part. The Qiskit export always
// includes that block and completes, so the definition is what separates the two cases, and only
// the missing one is worth a warning. The Circuit Build palette writes that block itself whenever
// it emits rzz, so a built circuit never trips this.
export function undefinedGateWarnings(format: string, source: string): string[] {
	if (format === 'qpy') return [];
	// Match the call, not the definition: `gate rzz(...)` is what supplies it. The leading class is
	// OPENQASM3_HEADER's, for the reason given there: `^\s*` under /m is quadratic.
	const calls = /^[^\S\n\r\u2028\u2029]*rzz\b/m.test(
		source.replace(/^[^\S\n\r\u2028\u2029]*gate\s+rzz\b.*$/gm, ''),
	);
	if (!calls) return [];
	if (/^[^\S\n\r\u2028\u2029]*gate\s+rzz\b/m.test(source)) return [];
	return [
		"Circuit calls rzz but does not define it. rzz is in the Heron basis, yet stdgates.inc has no definition for it, so IBM fails the job with \"gate 'rzz' is not defined\". Include the gate rzz block that Qiskit's exporter writes, or express the interaction with cz and rz.",
	];
}

// id passes both checks above: it is in the device basis and stdgates.inc defines it. Yet a bare
// `id q[n];` failed every job it appeared in, measured for 0.3.3 on ibm_kingston and
// ibm_marrakesh, with "the instruction u on qubits (n,) is not supported", while IBM's own docs
// list id as native. stdgates.inc defines id as U(0, 0, 0), so the likely cause is IBM's importer
// expanding that definition before the target sees it, not the hardware refusing U. Whether this
// still happens has not been re-measured, so it is a warning, never a block, and id stays in the
// basis. The Build palette drops id for the same reason.
export function identityGateWarnings(format: string, source: string): string[] {
	if (format === 'qpy') return [];
	// Same leading class as OPENQASM3_HEADER, for the reason given there: ^\s* under /m is quadratic.
	if (!/^[^\S\n\r\u2028\u2029]*id\b/m.test(source)) return [];
	return [
		'Circuit calls id. stdgates.inc defines id as U(0, 0, 0), and a job carrying it failed on Heron with "the instruction u on qubits (n,) is not supported" (measured for 0.3.3), even though IBM lists id as a native instruction. Identity is a no-op, so remove it from the program; Circuit Build drops it for the same reason.',
	];
}

// The qubit operands of every multi-qubit statement, in source order. Shared by the noise learner
// warning, which only needs the count, and the coupling check, which needs the pairs themselves.
// barrier is excluded: it spans qubits without entangling them. Both spellings are read: `q[n]`
// from the palette or any virtual register, and `$n`, which is what Qiskit's exporter writes for a
// transpiled circuit and what the coupling map indexes directly. A second quantum register is laid
// out after the ones declared before it, which is how IBM's importer numbers qubits, so `b[0]`
// after `qubit[2] a;` is qubit 2. Classical bits are never read as qubits.
export function multiQubitOperands(qasm3: string): number[][] {
	const found: number[][] = [];
	const offsets = new Map<string, number>();
	const classical = new Set<string>();
	let declared = 0;
	let depth = 0;
	for (const rawLine of qasm3.split('\n')) {
		const line = rawLine.trim();
		const opens = (line.match(/\{/g) ?? []).length;
		const closes = (line.match(/\}/g) ?? []).length;
		const wasInsideBlock = depth > 0;
		depth += opens - closes;
		if (depth < 0) depth = 0;
		if (wasInsideBlock || opens > 0) continue;
		// The comment is cut by index and the lookbehind below stops the operand scan restarting
		// inside a name; both keep a long line linear. Statements are then read one at a time, so a
		// barrier or a measure assignment sharing a line with a `cz` is read on its own.
		const cut = line.indexOf('//');
		const code = cut === -1 ? line : line.slice(0, cut);
		for (const raw of code.split(';')) {
			const statement = raw.trim();
			if (!statement) continue;
			// Spacing inside a declaration is free on one line and the legacy `qreg a[2];` writes the
			// size after the name, so both count; a size that is not a plain number falls to the skip
			// list below, and so does the leading half of a `qubit` or `qreg` declaration split across
			// lines. The classical reader below needs only a keyword and a name, so `creg a` alone on a
			// line still marks `a` classical. Neighbouring quantifiers read different characters, so a
			// pathological line stays linear.
			const register = statement.match(
				/^qubit(?:\s*\[\s*(\d+)\s*\]\s*|\s+)([A-Za-z_][A-Za-z0-9_]*)/,
			);
			if (register) {
				offsets.set(register[2], declared);
				declared += register[1] === undefined ? 1 : Number(register[1]);
				continue;
			}
			const legacy = statement.match(/^qreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(\d+)\s*\]/);
			if (legacy) {
				offsets.set(legacy[1], declared);
				declared += Number(legacy[2]);
				continue;
			}
			const bits = statement.match(
				/^(?:bit(?:\s*\[\s*\d+\s*\]\s*|\s+)|creg\s+)([A-Za-z_][A-Za-z0-9_]*)/,
			);
			if (bits) {
				classical.add(bits[1]);
				continue;
			}
			if (
				/^(OPENQASM|include|qubit|bit|creg|qreg|let|const|input|output|gate|def|barrier)\b/.test(
					statement,
				)
			) {
				continue;
			}
			// `c[0] = measure q[0];` puts the qubit after the assignment.
			const body = statement.includes('=')
				? statement.slice(statement.indexOf('=') + 1)
				: statement;
			const indices: number[] = [];
			for (const match of body.matchAll(
				/\$(\d+)|(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]/g,
			)) {
				if (match[1] !== undefined) indices.push(Number(match[1]));
				else if (!classical.has(match[2])) {
					indices.push((offsets.get(match[2]) ?? 0) + Number(match[3]));
				}
			}
			// Distinct operands, so `cz q[0], q[0];` is not mistaken for a two-qubit statement.
			const operands = [...new Set(indices)];
			if (operands.length >= 2) found.push(operands);
		}
	}
	return found;
}

export function twoQubitStatements(qasm3: string): number {
	return multiQubitOperands(qasm3).length;
}

// A classical register the noise learner never uses. IBM splits the circuit into entangling layers
// and carries the register into each, so a circuit with more than one layer is rejected with
// "ClassicalRegister with name 'c' appears in multiple layers with different sizes". Measured on
// ibm_fez: the same three-qubit circuit fails with a register and succeeds without one. A single
// layer survives, which is why this only bites once the circuit grows. QPY is skipped for the same
// reason as the ISA check: reading it would need Qiskit.
export function noiseLearnerWarnings(format: string, source: string): string[] {
	if (format === 'qpy') return [];
	// Anchored so `qubit[2] q;` cannot match the classical declaration, on the same leading class as
	// OPENQASM3_HEADER: `(^|\n)\s*` let the run cross line starts, which is quadratic, and made this
	// miss a line opened by a bare carriage return, by U+2028 or by U+2029, which the header check
	// and the rzz and id scans beside it all read.
	if (!/^[^\S\n\r\u2028\u2029]*bit\[\d+\]/m.test(source)) return [];
	// More than one layer needs at least two entangling gates, so a circuit with fewer cannot hit
	// this and warning about it would be noise. Measured: one `cz` beside a classical register runs
	// fine; two of them sharing a qubit is what fails.
	if (twoQubitStatements(source) < 2) return [];
	return [
		'Circuit declares a classical register, which the noise learner does not use. IBM rejects a circuit carrying one once it splits into more than one entangling layer. Set "Number of Classical Bits" to 0 to leave it out.',
	];
}

// Warnings are per circuit, but a batch of variants of the same experiment repeats the same one on
// every entry. Deduplicating keeps the item readable without hiding a warning that applies to only
// one circuit in the list.
function collectWarnings(sources: string[], forOne: (source: string) => string[]): string[] {
	return [...new Set(sources.flatMap(forOne))];
}

function readSubmitEnvelope(
	this: IExecuteFunctions,
	itemIndex: number,
): {
	backend: string;
	circuits: unknown[];
	sessionId: string;
	body: IDataObject;
	format: string;
	sources: string[];
} {
	const backend = requireIdentifier(
		this.getNodeParameter('backend', itemIndex),
		'Backend',
		this.getNode(),
		itemIndex,
	);
	// A workflow saved before the format selector existed stores no circuitFormat, so the default
	// keeps it on the OpenQASM 3 field it already filled in.
	const formatInput = this.getNodeParameter('circuitFormat', itemIndex, 'qasm3');
	const formatEmpty =
		formatInput === undefined ||
		formatInput === null ||
		(typeof formatInput === 'string' && formatInput.trim() === '');
	const format = formatEmpty ? 'qasm3' : asTrimmedString(formatInput);
	// A format naming neither field would fall through to the OpenQASM one, which n8n does not show
	// for it, so the run failed on `Could not get parameter "qasm3"`: an n8n internal message naming
	// a field the user never set. Refusing here names the field that is actually wrong.
	if (format !== 'qasm3' && format !== 'qpy') {
		throw new NodeOperationError(this.getNode(), `Circuit Format must be one of qasm3, qpy.`, {
			itemIndex,
		});
	}
	const circuitParam = format === 'qpy' ? 'qpyCircuit' : 'qasm3';
	// The fallback is what n8n hands back when the stored Circuit Format does not match the field's
	// own display condition, which is what an expression resolving to empty leaves behind: without
	// it n8n throws `Could not get parameter "qasm3"` from inside its own resolver, before any guard
	// here runs. With it the empty circuit reaches the header check below, which names the field.
	const circuitValue = this.getNodeParameter(circuitParam, itemIndex, '');
	// An expression that resolves to a list submits every circuit in one job, so the fixed per-job
	// overhead of roughly two QPU seconds is paid once instead of once each. A single circuit stays
	// a single circuit, so nothing saved before this existed changes shape.
	const rawCircuits = Array.isArray(circuitValue) ? circuitValue : [circuitValue];
	if (rawCircuits.length === 0) {
		throw new NodeOperationError(
			this.getNode(),
			'Circuit list is empty; there is nothing to run.',
			{
				itemIndex,
			},
		);
	}
	if (rawCircuits.length > MAX_CIRCUITS_PER_JOB) {
		throw new NodeOperationError(
			this.getNode(),
			`Circuit list has ${rawCircuits.length} entries; this node sends at most ${MAX_CIRCUITS_PER_JOB} in one job.`,
			{ itemIndex },
		);
	}
	const circuits = rawCircuits.map((entry) =>
		typeof entry === 'string' ? entry : asTrimmedString(entry),
	);
	// Optional, so an empty value simply means no session. Coerced rather than required, because a
	// numeric expression otherwise put session_id on the wire as a JSON number, where the schema
	// asks for a string.
	const sessionId = asTrimmedString(this.getNodeParameter('submitSessionId', itemIndex, ''));
	const sessionIdLength = characterLength(sessionId);
	if (sessionIdLength > MAX_SESSION_ID_LENGTH) {
		throw new NodeOperationError(
			this.getNode(),
			`Session ID is ${sessionIdLength} characters, longer than the ${MAX_SESSION_ID_LENGTH} IBM accepts. Use the sessionId returned by Session Create.`,
			{ itemIndex },
		);
	}
	const calibrationId = optionalCalibrationId(
		this.getNodeParameter('submitCalibrationId', itemIndex, ''),
		this.getNode(),
		itemIndex,
	);

	for (const entry of circuits) requireSupportedCircuit(entry, format, this.getNode(), itemIndex);
	// QPY travels as the wrapper the official client sends, not as a bare string.
	const payloads = circuits.map((entry) =>
		format === 'qpy' ? qpyCircuitPayload(entry) : (entry as unknown),
	);

	const body: IDataObject = {};
	// session_id is a sibling of program_id/backend/params, never inside params.
	if (sessionId) body.session_id = sessionId;
	// calibration_id is a job-level field beside session_id, never inside params.
	if (calibrationId !== undefined) body.calibration_id = calibrationId;
	const tags = requireJobTags(
		this.getNodeParameter('jobTags', itemIndex, ''),
		this.getNode(),
		itemIndex,
	);
	if (tags.length > 0) body.tags = tags;
	// The API expects the private flag only when set, matching the official client.
	const privateJob = requireBoolean(
		this.getNodeParameter('privateJob', itemIndex, false),
		'Private',
		false,
		this.getNode(),
		itemIndex,
	);
	if (privateJob) body.private = true;
	// Zero means "omit and let the program decide", so the fallback is 0 rather than a default cap.
	const maxCost = clampCount(
		this.getNodeParameter('maxCost', itemIndex, 0),
		0,
		MAX_JOB_COST_SECONDS,
	);
	if (maxCost > 0) body.cost = maxCost;
	const logLevel = this.getNodeParameter('logLevel', itemIndex, '') as string;
	if (logLevel) body.log_level = logLevel;

	return { backend, circuits: payloads, sessionId, body, format, sources: circuits };
}

async function submitJob(
	this: IExecuteFunctions,
	ctx: RequestContext,
	primitive: 'sampler' | 'estimator',
	itemIndex: number,
): Promise<IDataObject> {
	const { backend, circuits, sessionId, body, format, sources } = readSubmitEnvelope.call(
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

	const options = buildPrimitiveOptions.call(this, itemIndex, primitive);
	const params: IDataObject = { version: 2 };

	let pubs: unknown[][];
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
		// One PUB per circuit. The observables, bindings and precision apply to all of them, which is
		// what a batch of variants of the same experiment wants.
		pubs = circuits.map((entry) =>
			buildPubData('estimator', entry, observables, parameters, 0, precision),
		);
	} else {
		const shots = clampCount(this.getNodeParameter('shots', itemIndex, 1024), 1024);
		if (shots > MAX_SHOTS) {
			throw new NodeOperationError(
				this.getNode(),
				`Shots is ${shots}; IBM accepts at most ${MAX_SHOTS} per circuit.`,
				{ itemIndex },
			);
		}
		pubs = circuits.map((entry) => buildPubData('sampler', entry, null, parameters, shots, 0));
	}

	params.pubs = pubs;
	if (Object.keys(options).length > 0) params.options = options;

	body.program_id = primitive;
	body.backend = backend;
	body.params = params;

	const config = await readBackendConfiguration.call(this, ctx, backend, format);
	const basis = readBasisGates(config);
	const supported = readSupportedInstructions(config);
	const warnings = [
		...collectWarnings(sources, (entry) => [
			...isaWarnings(format, entry, backend, basis, supported),
			...undefinedGateWarnings(format, entry),
			...identityGateWarnings(format, entry),
		]),
		...couplingWarnings(backend, sources, config?.coupling_map),
	];
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
	const { backend, circuits, sessionId, body, format, sources } = readSubmitEnvelope.call(
		this,
		itemIndex,
	);
	const options = readAdditionalOptions.call(this, itemIndex, 'noise-learner');
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

	const depths = readNumberList(
		learner.layerPairDepths,
		'Layer Pair Depths',
		true,
		this.getNode(),
		itemIndex,
	);
	if (depths) options.layer_pair_depths = depths;

	const strategy = learner.twirlingStrategy;
	if (typeof strategy === 'string' && strategy) options.twirling_strategy = strategy;

	const params: IDataObject = { version: 2, circuits };
	if (Object.keys(options).length > 0) params.options = options;

	body.program_id = 'noise-learner';
	body.backend = backend;
	body.params = params;

	const config = await readBackendConfiguration.call(this, ctx, backend, format);
	const basis = readBasisGates(config);
	const supported = readSupportedInstructions(config);
	const warnings = [
		...collectWarnings(sources, (entry) => [
			...isaWarnings(format, entry, backend, basis, supported),
			...undefinedGateWarnings(format, entry),
			...identityGateWarnings(format, entry),
			...noiseLearnerWarnings(format, entry),
		]),
		...couplingWarnings(backend, sources, config?.coupling_map),
	];
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
// The node's own bound, not IBM's: an expression that resolves to a runaway array would otherwise
// build one enormous request. A hundred circuits in a single job is far past any real batch.
export const MAX_CIRCUITS_PER_JOB = 100;

export const MAX_JOB_TAGS = 8;
export const MAX_JOB_TAG_LENGTH = 86;

// The spec bounds calibration_id to 1..100 characters, on the job body and on both backend reads.
export const MAX_CALIBRATION_ID_LENGTH = 100;

// The spec bounds shots only by int32, but the service refuses far earlier: measured on ibm_fez,
// 2147483647 and 3000000000 were both accepted at submission and then failed the job with "The
// number of circuit shots N exceeds the system limit 10000000". Refused here instead, so the
// failure arrives with the request rather than one poll later.
export const MAX_SHOTS = 10000000;

// String.length counts UTF-16 code units, so one emoji counts as two. JSON Schema maxLength and
// minLength count characters, which is what IBM validates against, so an 86-emoji tag is legal and
// a 2-emoji search term is too short. Counted one unit at a time rather than by spreading, because
// every caller is a bound against a runaway value and `[...value]` builds an array element per code
// point of that value before the bound can refuse it: 256 MB of heap to reject a 32 MB Job ID.
export function characterLength(value: string): number {
	let count = 0;
	for (let index = 0; index < value.length; index++) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) index++;
		}
		count++;
	}
	return count;
}

// Same reason: the excerpt is taken from a bounded prefix, since a code point spans at most two
// units, so the first 2n units always hold the first n characters.
function firstCharacters(value: string, count: number): string {
	return [...value.slice(0, count * 2)].slice(0, count).join('');
}

function requireJobTags(value: unknown, node: INode, itemIndex: number): string[] {
	// Update Tags PUTs the whole list, so an empty result deletes every tag on the job. An empty
	// value says that deliberately, and a number is one tag. A null, an object, or a list carrying an
	// entry the node can read as neither text nor a number means the expression did not resolve to a
	// tag list, and wiping the job's tags is not a reasonable reading of that.
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
	// The same reasoning one entry down. parseCsvList drops what it cannot read, so a list of
	// objects, of nulls or of blank strings arrived here as [] and cleared the job just as quietly,
	// and a list with one such entry among good ones wrote the entries it could read and lost the
	// tag that entry stood for.
	if (Array.isArray(value)) {
		const unreadable = value.findIndex((entry) => asTrimmedString(entry) === '');
		if (unreadable !== -1) {
			throw new NodeOperationError(
				node,
				`Tag ${unreadable + 1} in the list is blank or is not text. Leave Tags empty to remove every tag from the job.`,
				{ itemIndex },
			);
		}
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
			`Tag "${firstCharacters(tooLong, 20)}..." is ${characterLength(tooLong)} characters; IBM accepts at most ${MAX_JOB_TAG_LENGTH}.`,
			{ itemIndex },
		);
	}
	return tags;
}

// Optional wherever it appears, so an empty value omits the field. Coerced like session_id: a
// numeric expression would otherwise put a JSON number where the schema wants a string.
function optionalCalibrationId(value: unknown, node: INode, itemIndex: number): string | undefined {
	const text = asTrimmedString(value);
	if (text === '') return undefined;
	const length = characterLength(text);
	if (length > MAX_CALIBRATION_ID_LENGTH) {
		throw new NodeOperationError(
			node,
			`Calibration ID is ${length} characters; IBM accepts at most ${MAX_CALIBRATION_ID_LENGTH}.`,
			{ itemIndex },
		);
	}
	return text;
}

// A dateTime field arrives as whatever the picker or an expression produced. A value that is not a
// date is refused rather than dropped: dropping it would silently return the current calibration
// and look like success.
function optionalDateTime(
	value: unknown,
	label: string,
	node: INode,
	itemIndex: number,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string' && value.trim() === '') return undefined;
	const text = typeof value === 'string' ? value.trim() : '';
	if (text === '' || Number.isNaN(Date.parse(text))) {
		throw new NodeOperationError(
			node,
			`${label} must be a date and time, for example 2026-09-01T00:00:00Z.`,
			{ itemIndex },
		);
	}
	return text;
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
			// A poll only needs the status; without this every check re-downloads the submitted
			// circuits, which the trigger already skips. The result itself comes from /results.
			jobInfo = await ibmQuantumApiRequest.call(
				this,
				ctx,
				'GET',
				`/jobs/${pathSegment(jobId)}`,
				undefined,
				{ exclude_params: true },
			);
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
	// A Register Name the result does not carry comes back as `registerError` rather than failing the
	// item: this body has already been read, and IBM deletes a private job's results on the first
	// read, so the shots would go with it.
	const parsed = parseResults(results, registerName || undefined);
	// IBM documents a 204 on this endpoint as "Job's final result not found". The transport turns
	// that empty body into {}, which parses to zero pubs and used to read as a completed job that
	// simply produced nothing. Saying which of the two it was costs one field.
	// The noise learner carries its payload under `data`, and the serialised Qiskit encoding carries
	// its own under `__value__.pub_results`, so testing `results` alone reported a full result body
	// as missing, which is the opposite of what this field promises.
	// The flag means what it says: IBM sent no body. Deciding it from the shapes the reader knows
	// made every unrecognised body read as an empty one, which is how a 457 KB result came back
	// marked unavailable. An empty object is what the transport makes of a 204 and of an empty
	// string alike, so it is the whole test.
	const resultsMissing = typeof results !== 'string' && Object.keys(results).length === 0;
	return {
		jobId,
		status,
		...parsed,
		...(resultsMissing ? { resultsAvailable: false } : {}),
		raw: results,
	};
}

async function listJobs(
	this: IExecuteFunctions,
	ctx: RequestContext,
	itemIndex: number,
): Promise<IDataObject> {
	const node = this.getNode();
	const returnAll = requireBoolean(
		this.getNodeParameter('returnAll', itemIndex, false),
		'Return All',
		false,
		node,
		itemIndex,
	);
	const limit = returnAll
		? MAX_JOB_LIST_LIMIT
		: clampCount(this.getNodeParameter('limit', itemIndex, 50), 50, MAX_JOB_LIST_LIMIT);
	const filters = asCollection(this.getNodeParameter('listFilters', itemIndex, {}));
	// exclude_params drops each job's circuit payload from the listing, matching the
	// official client's default. The filter toggle brings it back when needed.
	const includeParams = requireBoolean(
		filters.includeParams,
		'Include Circuit Params',
		false,
		node,
		itemIndex,
	);
	const qs: IDataObject = { limit, exclude_params: !includeParams };
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
	const start = Number.isInteger(offset) && offset > 0 ? offset : 0;
	if (start > 0) qs.offset = start;
	if (!returnAll) return ibmQuantumApiRequest.call(this, ctx, 'GET', '/jobs', undefined, qs);
	return listAllJobs.call(this, ctx, qs, start);
}

// Offset paging over a newest-first list shifts by one whenever a job is submitted between two
// pages, which repeats the job at the boundary. The id set drops that repeat, the same reason the
// triggers dedupe on id.
async function listAllJobs(
	this: IExecuteFunctions,
	ctx: RequestContext,
	qs: IDataObject,
	start: number,
): Promise<IDataObject> {
	const jobs: IDataObject[] = [];
	const seen = new Set<string>();
	let offset = start;
	let page: IDataObject = {};
	for (let pages = 0; pages < MAX_JOB_LIST_PAGES; pages++) {
		page = await ibmQuantumApiRequest.call(this, ctx, 'GET', '/jobs', undefined, {
			...qs,
			offset,
		});
		const returned = Array.isArray(page.jobs) ? (page.jobs as IDataObject[]) : [];
		for (const job of returned) {
			if (job != null && typeof job.id === 'string') {
				if (seen.has(job.id)) continue;
				seen.add(job.id);
			}
			jobs.push(job);
		}
		offset += returned.length;
		if (
			returned.length < MAX_JOB_LIST_LIMIT ||
			(typeof page.count === 'number' && offset >= page.count)
		) {
			return { ...page, jobs, offset: start };
		}
	}
	return { ...page, jobs, offset: start, truncated: true };
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
	if (operation === 'list') return listJobs.call(this, ctx, itemIndex);

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
	if (operation === 'getStatus') {
		// A workflow saved before the toggle existed, and an expression that resolves to nothing, both
		// keep the body this operation always returned.
		const includeParams = requireBoolean(
			this.getNodeParameter('includeParams', itemIndex, true),
			'Include Circuit Params',
			true,
			this.getNode(),
			itemIndex,
		);
		return ibmQuantumApiRequest.call(this, ctx, 'GET', `/jobs/${pathSegment(jobId)}`, undefined, {
			exclude_params: !includeParams,
		});
	}
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
				undefined,
				undefined,
				true,
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
		// The request asks for the body as text, so a log that happens to be valid JSON stays the text
		// IBM wrote rather than being parsed into an object under a field documented as text. An
		// empty body still arrives as {} from the transport, which means no logs.
		const body = response as IDataObject;
		const hasFields = Boolean(body) && typeof body === 'object' && Object.keys(body).length > 0;
		const logs = typeof response === 'string' ? response : hasFields ? JSON.stringify(body) : '';
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

// The two modes IBM's session schema accepts. `dedicated` needs a paid plan; on Open IBM refuses
// it with code 1352, which is a clear answer and stays IBM's to give.
const SESSION_MODES = ['batch', 'dedicated'];

export async function handleSession(
	this: IExecuteFunctions,
	ctx: RequestContext,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	if (operation === 'create') {
		// Version 2 renamed this parameter to sessionMode; version 1 workflows still store `mode`.
		const modeParam = this.getNode().typeVersion >= 2 ? 'sessionMode' : 'mode';
		const modeInput = this.getNodeParameter(modeParam, itemIndex, 'batch');
		// An expression that resolves to nothing keeps the default, the release-wide rule for options
		// fields. A value that is really there and names neither mode is refused here rather than in
		// IBM's answer, which is a bare "Internal server error" that names no field at all.
		const modeEmpty =
			modeInput === undefined ||
			modeInput === null ||
			(typeof modeInput === 'string' && modeInput.trim() === '');
		const mode = modeEmpty ? 'batch' : asTrimmedString(modeInput);
		if (!SESSION_MODES.includes(mode)) {
			throw new NodeOperationError(
				this.getNode(),
				`Session Mode must be one of ${SESSION_MODES.join(', ')}.`,
				{ itemIndex },
			);
		}
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
		const acceptingJobs = requireBoolean(
			this.getNodeParameter('acceptingJobs', itemIndex, true),
			'Accepting Jobs',
			true,
			this.getNode(),
			itemIndex,
		);
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

// Cursor paging carries no total to stop at, so Return All walks until IBM stops offering a next
// link. Twenty pages of 50 is a thousand workloads, the bound Get Many Instances also uses.
export const MAX_WORKLOAD_PAGES = 20;

// IBM returns workloads oldest first. Jobs List and both triggers all present newest first, so the
// node sends the descending sort unless the user picks otherwise.
const DEFAULT_WORKLOAD_SORT = '-createdAt';

// IBM's paging links are URLs ("...?next=3fe78a36b9aa7f26" in the spec) while the Next Cursor and
// Previous Cursor filters want the bare token, and nothing said which part to paste. Read it out
// of the link so one page's output feeds the next request. The token format is IBM's and has not
// been seen live, so the value is percent-decoded and otherwise handed back exactly as written.
export function cursorFromHref(href: unknown, key: 'next' | 'previous'): string | null {
	if (typeof href !== 'string') return null;
	const queryStart = href.indexOf('?');
	if (queryStart === -1) return null;
	const query = href.slice(queryStart + 1).split('#')[0];
	for (const pair of query.split('&')) {
		const separator = pair.indexOf('=');
		const name = separator === -1 ? pair : pair.slice(0, separator);
		if (name !== key) continue;
		const raw = separator === -1 ? '' : pair.slice(separator + 1);
		let value: string;
		try {
			value = decodeURIComponent(raw);
		} catch {
			// A malformed percent sequence is still the token IBM wrote; send it back as it came.
			value = raw;
		}
		return value === '' ? null : value;
	}
	return null;
}

// The raw body stays as IBM sent it, links included; the two tokens are added beside it.
function withCursors(page: IDataObject): IDataObject {
	return {
		...page,
		nextCursor: cursorFromHref(asCollection(page.next).href, 'next'),
		previousCursor: cursorFromHref(asCollection(page.previous).href, 'previous'),
	};
}

function workloadsOf(page: IDataObject): IDataObject[] {
	return Array.isArray(page.workloads) ? (page.workloads as IDataObject[]) : [];
}

async function listAllWorkloads(
	this: IExecuteFunctions,
	ctx: RequestContext,
	qs: IDataObject,
	first: IDataObject,
): Promise<IDataObject> {
	const workloads: IDataObject[] = [];
	const seen = new Set<string>();
	const cursors = new Set<string>();
	const collect = (page: IDataObject) => {
		for (const workload of workloadsOf(page)) {
			if (workload != null && typeof workload.id === 'string') {
				if (seen.has(workload.id)) continue;
				seen.add(workload.id);
			}
			workloads.push(workload);
		}
	};
	collect(first);
	let page = first;
	let next = cursorFromHref(asCollection(page.next).href, 'next');
	let pages = 1;
	// A cursor that comes back a second time would fetch the same page again for as many pages as
	// the cap allows, and count every workload on it twice. The walk stops on it instead, and stays
	// truncated, because a cursor that loops is a walk that did not reach the end of the collection.
	while (next !== null && !cursors.has(next) && pages < MAX_WORKLOAD_PAGES) {
		cursors.add(next);
		page = await ibmQuantumApiRequest.call(this, ctx, 'GET', '/workloads', undefined, {
			...qs,
			next,
		});
		collect(page);
		next = cursorFromHref(asCollection(page.next).href, 'next');
		pages += 1;
	}
	// The last page's links stay in the body, so the cursor a truncated walk stopped at is the one
	// to paste into Next Cursor to carry on.
	return { ...withCursors(page), workloads, ...(next !== null ? { truncated: true } : {}) };
}

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
	const returnAll = requireBoolean(
		this.getNodeParameter('returnAll', itemIndex, false),
		'Return All',
		false,
		this.getNode(),
		itemIndex,
	);
	const limit = returnAll
		? MAX_WORKLOAD_LIMIT
		: clampCount(
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

	const response = await ibmQuantumApiRequest.call(this, ctx, 'GET', '/workloads', undefined, qs);
	if (!returnAll) return withCursors(response);
	return listAllWorkloads.call(this, ctx, qs, response);
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
	if (optionalBoolean(filters.simulators, 'Simulators', this.getNode(), itemIndex) === false) {
		qs.simulators = false;
	}
	return qs;
}

// GET /accounts/{id} wants an account id that no other endpoint returns, but the instance CRN the
// credential already holds carries it: crn:v1:bluemix:public:quantum-computing:us-east:a/<account
// id>:<instance id>::. The seventh colon-separated field is the CRN scope, and `a/` marks an
// account (an organisation or space scope would read o/ or s/ and is of no use here).
export function accountIdFromCrn(crn: unknown): string | null {
	const scope = asTrimmedString(crn).split(':')[6] ?? '';
	if (!scope.startsWith('a/')) return null;
	const accountId = scope.slice(2);
	return accountId === '' ? null : accountId;
}

// The path parameter's own pattern and bound in the spec, so a mangled CRN is refused here with a
// message naming the credential rather than by a bare 400 from IBM.
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// The spec bounds the plan_id query to 64 characters.
export const MAX_PLAN_ID_LENGTH = 64;

// The Resource Controller lists every IBM Cloud service an account owns; this catalog id, from
// IBM's instance management guide, narrows it to IBM Quantum.
export const IBM_QUANTUM_RESOURCE_ID = 'b6049020-80f4-11eb-a0f7-e35ec9b4054f';

// Plan ids from the same guide. The UI stores the plan word, never the id.
export const RESOURCE_PLAN_IDS: Record<string, string> = {
	flex: '53bde9d3-cdbb-46f5-a98f-60ebcadf7260',
	open: '850b21a7-71de-4e53-9441-1abdd202f35d',
	'pay-as-you-go': '5304b575-3cff-4455-90dc-ae4367762093',
	premium: '7f666d17-7893-47d8-bf9d-2b2389fc4dfc',
};

export const MAX_INSTANCE_PAGE_SIZE = 100;
// Return All follows next_url page by page. An account with two thousand quantum instances does
// not exist; the cap is there so a listing that never ends cannot hold the execution open.
export const MAX_INSTANCE_PAGES = 20;

// next_url is a relative path with a `start` token, which the Resource Controller documents as the
// only thing to send back. Read with URLSearchParams rather than URL so a malformed value returns
// null instead of throwing, and decoded exactly as IBM's own SDK decodes it.
export function nextPageToken(nextUrl: unknown): string | null {
	if (typeof nextUrl !== 'string') return null;
	const query = nextUrl.split('#')[0].split('?')[1];
	if (query === undefined) return null;
	const start = new URLSearchParams(query).get('start');
	return start ? start : null;
}

function instancesOf(page: IDataObject): IDataObject[] {
	return Array.isArray(page.resources) ? (page.resources as IDataObject[]) : [];
}

async function listInstances(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const node = this.getNode();
	const returnAll = requireBoolean(
		this.getNodeParameter('returnAll', itemIndex, false),
		'Return All',
		false,
		node,
		itemIndex,
	);
	const limit = clampCount(
		this.getNodeParameter('limit', itemIndex, 50),
		50,
		MAX_INSTANCE_PAGE_SIZE,
	);
	const qs: IDataObject = {
		resource_id: IBM_QUANTUM_RESOURCE_ID,
		limit: returnAll ? MAX_INSTANCE_PAGE_SIZE : limit,
	};
	const rawPlan = this.getNodeParameter('plan', itemIndex, '');
	if (rawPlan !== '' && rawPlan !== null && rawPlan !== undefined) {
		const plan = asTrimmedString(rawPlan).toLowerCase();
		// Object.hasOwn for the same reason as in handleBackend: an inherited member is not a plan.
		const planId = Object.hasOwn(RESOURCE_PLAN_IDS, plan) ? RESOURCE_PLAN_IDS[plan] : undefined;
		if (planId === undefined) {
			throw new NodeOperationError(
				node,
				`Plan "${plan}" is not one of ${Object.keys(RESOURCE_PLAN_IDS).join(', ')}. Leave it empty for any plan.`,
				{ itemIndex },
			);
		}
		qs.resource_plan_id = planId;
	}

	const first = await resourceControllerRequest.call(
		this,
		'GET',
		'/v2/resource_instances',
		undefined,
		qs,
	);
	if (!returnAll) return first;

	const resources = [...instancesOf(first)];
	let nextUrl = first.next_url;
	let start = nextPageToken(nextUrl);
	let pages = 1;
	while (start !== null && pages < MAX_INSTANCE_PAGES) {
		const page = await resourceControllerRequest.call(
			this,
			'GET',
			'/v2/resource_instances',
			undefined,
			{ ...qs, start },
		);
		resources.push(...instancesOf(page));
		nextUrl = page.next_url;
		start = nextPageToken(nextUrl);
		pages += 1;
	}
	return {
		resources,
		rows_count: resources.length,
		next_url: start === null ? '' : nextUrl,
		truncated: start !== null,
	};
}

// The CRN becomes one path segment on a different host, so it gets the same identifier guard as
// a job id, plus the prefix every IBM CRN carries, so a GUID or a name pasted by mistake fails
// here rather than as a 404 that names nothing. The refusal does not repeat what it read, for the
// reason checkApiVersion gives: the Instance CRN box sits under the API Key box and takes a string
// that looks just as opaque, so it is one of the two boxes a key is mis-pasted into.
function requireCrn(value: unknown, node: INode, itemIndex: number): string {
	const crn = requireIdentifier(value, 'Instance CRN', node, itemIndex);
	if (!crn.startsWith('crn:v1:')) {
		throw new NodeOperationError(
			node,
			'Instance CRN does not start with crn:v1:. Copy the full CRN from the IBM Quantum Platform instances page.',
			{ itemIndex },
		);
	}
	return crn;
}

// requireBoundedNumber's message stops at the bound, and here the bound is not the whole story:
// the way to remove a cap is the Clear Limit switch, not a number, so the refusal has to say so
// or a reader tries zero and is refused again.
function requireCostLimit(value: unknown, node: INode, itemIndex: number): number {
	try {
		return requireBoundedNumber(value, 'Cost Limit', { min: 1, integer: true }, node, itemIndex);
	} catch (error) {
		throw new NodeOperationError(
			node,
			`${errorMessage(error)} Turn on Clear Limit to remove the limit.`,
			{ itemIndex },
		);
	}
}

async function setCostLimit(
	this: IExecuteFunctions,
	ctx: RequestContext,
	itemIndex: number,
): Promise<IDataObject> {
	const node = this.getNode();
	const override = this.getNodeParameter('instanceCrn', itemIndex, '');
	const crn =
		asTrimmedString(override) === ''
			? requireCrn(ctx.instanceCrn, node, itemIndex)
			: requireCrn(override, node, itemIndex);

	// This write removes the spend cap when it sends null, so nothing may fall through to that by
	// accident: only the switch clears it, and an unreadable number fails before the request.
	const clearLimit = requireBoolean(
		this.getNodeParameter('clearLimit', itemIndex, false),
		'Clear Limit',
		false,
		node,
		itemIndex,
	);
	const instanceLimitSeconds = clearLimit
		? null
		: requireCostLimit(this.getNodeParameter('instanceLimit', itemIndex, 600), node, itemIndex);

	const response = await resourceControllerRequest.call(
		this,
		'PATCH',
		`/v2/resource_instances/${pathSegment(crn)}`,
		{
			parameters: {
				// IBM silently ignores a parameters object identical to the previous one, so every
				// write carries the current time. Two writes of the same value inside one
				// millisecond still collide; the second is then a no-op on a value already in force.
				timestamp: new Date().toISOString(),
				instance_limit_seconds: instanceLimitSeconds,
			},
		},
	);
	// The guide says to read extensions, which is normalised, rather than parameters, which only
	// echoes the last request.
	const readBack = asCollection(response.extensions).instance_limit_seconds;
	return { ...response, instanceLimitSeconds: typeof readBack === 'number' ? readBack : null };
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
		// IBM marks this deprecated in the live OpenAPI spec, in favour of the Resource Controller
		// API, but the GET still answers in under a second. The PUT beside it hung for 180 seconds
		// when 0.5.0 tried it, which is why Set Cost Limit writes to the Resource Controller
		// instead.
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
	if (operation === 'getAccountConfiguration') {
		const fromCrn = accountIdFromCrn(ctx.instanceCrn);
		if (fromCrn === null) {
			throw new NodeOperationError(
				this.getNode(),
				"The credential's Instance CRN carries no account segment (a/<account id>), so the account cannot be identified. Copy the full CRN, starting with crn:v1, from quantum.cloud.ibm.com/instances.",
				{ itemIndex },
			);
		}
		const accountId = requireIdentifier(fromCrn, 'Account ID', this.getNode(), itemIndex);
		if (!ACCOUNT_ID_PATTERN.test(accountId)) {
			throw new NodeOperationError(
				this.getNode(),
				"The account id in the credential's Instance CRN is not one IBM accepts: letters, digits, - and _ only, at most 64 characters.",
				{ itemIndex },
			);
		}
		const planId = asTrimmedString(this.getNodeParameter('planId', itemIndex, ''));
		const planLength = characterLength(planId);
		if (planLength > MAX_PLAN_ID_LENGTH) {
			throw new NodeOperationError(
				this.getNode(),
				`Plan ID is ${planLength} characters, longer than the ${MAX_PLAN_ID_LENGTH} IBM accepts.`,
				{ itemIndex },
			);
		}
		return ibmQuantumApiRequest.call(
			this,
			ctx,
			'GET',
			`/accounts/${pathSegment(accountId)}`,
			undefined,
			planId === '' ? undefined : { plan_id: planId },
		);
	}
	if (operation === 'getManyInstances') return listInstances.call(this, itemIndex);
	if (operation === 'setCostLimit') return setCostLimit.call(this, ctx, itemIndex);
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
	throw new NodeOperationError(this.getNode(), `Unsupported account operation: ${operation}`, {
		itemIndex,
	});
}
