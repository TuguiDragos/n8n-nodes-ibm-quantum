import type { IDataObject } from 'n8n-workflow';

// Parse a hex sample (e.g. "0x3") with BigInt so registers wider than 53 bits keep every bit.
// parseInt returns a double that is exact only up to 2^53-1, which silently drops the low bits
// of a wide register and collapses distinct outcomes. Returns null for anything not parseable.
function hexToBigInt(sample: string): bigint | null {
	try {
		return BigInt(/^0x/i.test(sample) ? sample : `0x${sample}`);
	} catch {
		return null;
	}
}

export function samplesToCounts(samples: string[], numBits: number): IDataObject {
	const counts: Record<string, number> = {};
	for (const sample of samples) {
		const value = hexToBigInt(sample);
		if (value === null) continue;
		const bitstring = value.toString(2).padStart(numBits, '0');
		counts[bitstring] = (counts[bitstring] ?? 0) + 1;
	}
	return counts as IDataObject;
}

function inferNumBits(samples: string[]): number {
	let max = 1;
	for (const sample of samples) {
		const value = hexToBigInt(sample);
		if (value === null) continue;
		const length = value.toString(2).length;
		if (length > max) max = length;
	}
	return max;
}

// The widest classical register worth trusting from a response. It matches the circuit builder's
// own register cap, and is far above any real device.
const MAX_REGISTER_BITS = 4096;

// Bit order follows the classical register: c[0] is the right most bit.
export function parseSamplerPub(data: IDataObject, preferredRegister?: string): IDataObject {
	const registerNames = Object.keys(data);
	const hasSamples = (name: string): boolean => {
		const register = data[name] as IDataObject | undefined;
		return Boolean(register) && Array.isArray((register as IDataObject).samples);
	};
	// Asking for a register by name and silently getting a different one back is worse than an
	// error: the counts look plausible and belong to the wrong bits. A pub that does not carry the
	// requested register still reads its own, but says so, because a job can hold several pubs whose
	// circuits name their registers differently. parseResults adds registerError when NO pub carries
	// it.
	const usePreferred = Boolean(preferredRegister) && hasSamples(preferredRegister as string);
	const registerName = usePreferred ? preferredRegister : registerNames.find(hasSamples);

	// parseResults only calls this once it has proved some value in `data` carries a samples array,
	// so this guard is for direct callers, which is also how it is tested.
	if (!registerName) return { register: null, counts: {}, shots: 0 };

	const register = data[registerName] as IDataObject;
	// hasSamples already established this is an array, so no fallback is needed here.
	const samples = register.samples as string[];
	// num_bits comes from the response, so it is only trusted when it is a plausible register width.
	// A huge value made padStart throw "Invalid string length", a raw RangeError with nothing in it
	// to tell the user what happened, and a negative one produced a nonsense width. Measuring the
	// samples is the honest fallback in both cases.
	const declared = register.num_bits;
	const numBits =
		typeof declared === 'number' &&
		Number.isInteger(declared) &&
		declared >= 0 &&
		declared <= MAX_REGISTER_BITS
			? declared
			: inferNumBits(samples);
	const counts = samplesToCounts(samples, numBits);

	// A sample the hex parser cannot read is dropped rather than folded into a wrong bitstring,
	// which would corrupt a neighbouring outcome. Dropping it silently would leave counts summing
	// to less than shots with nothing to explain the gap, so report the shortfall when there is
	// one. IBM has never returned an unreadable sample in practice; this makes it visible if it
	// ever does, instead of quietly understating an outcome.
	const counted = Object.values(counts as Record<string, number>).reduce((sum, n) => sum + n, 0);
	const unparsed = samples.length - counted;

	return {
		register: registerName,
		numBits,
		shots: samples.length,
		counts,
		// Only present when a name was asked for and this pub does not have it, so a fallback can
		// never pass for the register the caller requested.
		...(preferredRegister && !usePreferred
			? { requestedRegister: preferredRegister, registerFallback: true }
			: {}),
		...(unparsed > 0 ? { unparsedSamples: unparsed } : {}),
	};
}

// IBM serialises its Python objects as { __type__, __module__, __class__, __value__ }. Only the
// payload matters here, and a level that is missing or reshaped must not throw: the caller keeps
// the untouched body as `raw`, so degrading to null loses nothing and keeps the failure readable.
function unwrap(value: unknown): IDataObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const object = value as IDataObject;
	const inner = object.__value__;
	if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as IDataObject;
	return object;
}

// The same envelope, but for the leaves IBM encodes as a base64 string rather than a nested
// object. Returns null for anything that is not one, so a reshaped body yields a null field
// instead of a half-read value.
function encodedValue(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const inner = (value as IDataObject).__value__;
	return typeof inner === 'string' ? inner : null;
}

// One learned layer from a noise learner job. `rates` is left exactly as IBM sent it, a base64
// zlib-compressed NumPy array: inflating it needs zlib, which the community-node import allowlist
// does not permit, so it is passed through under a name that says what it is rather than decoded.
// `circuit` is QPY for the same reason. The generators beside them are already plain strings.
// IBM's third array container: a base64 payload with its shape and dtype beside it, used by the
// older noise learner encoding and by the executor program. Passed through like every other array
// in this file, because reading NumPy needs libraries a community node may not import.
function arrayContainer(value: unknown): IDataObject | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const held = value as IDataObject;
	if (typeof held.data !== 'string') return null;
	return {
		encoded: held.data,
		shape: Array.isArray(held.shape) ? held.shape : null,
		dtype: typeof held.dtype === 'string' ? held.dtype : null,
	};
}

// A `data` entry that is a learned layer, in either encoding IBM has sent: the serialised envelope
// whose payload carries `error`, and the older flat shape whose fields sit at the top. Measured on
// one account: 4 of 14 `data` bodies were the envelope, 6 were the flat shape, and 4 were not
// layers at all but executor results, which used to be read as layers and returned as all nulls.
function isLearnerLayer(entry: unknown): boolean {
	if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
	const held = entry as IDataObject;
	if ('generators_sparse' in held || 'rates' in held) return true;
	const inner = unwrap(held);
	return 'error' in inner || 'generators' in inner;
}

export function parseNoiseLearnerPub(entry: unknown): IDataObject {
	const layer = unwrap(entry);
	// The flat encoding names its fields directly and its generators are readable as they stand.
	if (layer.generators_sparse !== undefined || layer.rates !== undefined) {
		const rates = arrayContainer(layer.rates);
		const std = arrayContainer(layer.rates_std);
		return {
			type: 'noiseLearner',
			encoding: 'ibm-array',
			numQubits: typeof layer.num_qubits === 'number' ? layer.num_qubits : null,
			generatorsSparse: Array.isArray(layer.generators_sparse) ? layer.generators_sparse : null,
			ratesEncoded: rates ? rates.encoded : null,
			ratesShape: rates ? rates.shape : null,
			ratesStdEncoded: std ? std.encoded : null,
			metadata: layer.metadata ?? {},
		};
	}
	const error = unwrap(layer.error);
	const generators = unwrap(error.generators).data;
	const rates = encodedValue(error.rates);
	const circuit = encodedValue(layer.circuit);
	return {
		type: 'noiseLearner',
		qubits: Array.isArray(layer.qubits) ? layer.qubits : null,
		generators: Array.isArray(generators) ? generators : null,
		// Compressed NumPy float64, one rate per generator and in the same order. Decode with
		// zlib.inflate then read the NPY body, or hand the raw value to qiskit-ibm-runtime.
		ratesEncoded: rates,
		// QPY, the layer this error was learned on. Kept so a Qiskit-side consumer can rebuild it.
		circuitEncoded: circuit,
	};
}

// A body IBM sent as JSON text rather than as an object. Returns null rather than throwing, so a
// body that is simply a string stays a string and reaches the caller untouched in `raw`.
function parsedJsonBody(value: string): IDataObject | null {
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as IDataObject)
			: null;
	} catch {
		return null;
	}
}

// IBM answers in one of two encodings, chosen by the submitted params rather than by the endpoint.
// Without `support_qiskit` the body is plain JSON under `results`, which is what this node submits
// and what everything above reads. With it, which is what qiskit-ibm-runtime sends by default, the
// body is the serialised Qiskit object graph read here, and it carries no `results` key at all.
// Reading only `results` reported those as zero pubs and told the caller no result was available,
// the same mistake the noise learner shape caused: measured on one account, 25 of 160 completed
// jobs, one of them 457 KB of expectation values reported as nothing. The measurement arrays are
// zlib compressed NumPy and stay encoded, because `node:zlib` is not on the community node import
// allowlist, so they are passed through under a name that says what they are.
// The same encoding, recognised in text form without parsing it. IBM writes some estimator bodies
// with Python's json, which emits a bare `Infinity` for an unbounded value; JSON does not allow it,
// so the HTTP layer leaves the body as a string and JSON.parse refuses it too. Measured once on one
// account. Rewriting a server body before reading it is not worth the risk of silently corrupting a
// value, so the text is left alone and the caller is told why it could not be read.
function looksSerialized(value: unknown): boolean {
	return typeof value === 'string' && value.slice(0, 200).includes('"PrimitiveResult"');
}

function serializedPubResults(response: unknown): IDataObject[] | null {
	const body =
		typeof response === 'string'
			? parsedJsonBody(response)
			: response && typeof response === 'object' && !Array.isArray(response)
				? (response as IDataObject)
				: null;
	if (!body || body.__type__ !== 'PrimitiveResult') return null;
	const pubResults = unwrap(body).pub_results;
	return Array.isArray(pubResults) ? (pubResults as IDataObject[]) : null;
}

export function hasSerializedResults(response: unknown): boolean {
	return serializedPubResults(response) !== null || looksSerialized(response);
}

function isBitArray(value: unknown): boolean {
	return (
		Boolean(value) && typeof value === 'object' && (value as IDataObject).__type__ === 'BitArray'
	);
}

// One PUB from the serialised encoding. A sampler PUB holds its shots in a BitArray, an estimator
// PUB holds one ndarray per field, and both are the same compressed NumPy underneath. The readable
// half, the register name, its width, the field names and IBM's own metadata, is returned plain.
export function parseSerializedPub(entry: unknown, preferredRegister?: string): IDataObject {
	const pub = unwrap(entry);
	const data = unwrap(pub.data);
	const fieldNames = Array.isArray(data.field_names) ? (data.field_names as string[]) : [];
	const fields = (data.fields as IDataObject) ?? {};
	const registers = fieldNames.filter((name) => isBitArray(fields[name]));
	const usePreferred =
		Boolean(preferredRegister) && registers.includes(preferredRegister as string);
	const registerName = usePreferred ? (preferredRegister as string) : registers[0];

	if (registerName !== undefined) {
		const bits = unwrap(fields[registerName]);
		const declared = bits.num_bits;
		return {
			type: 'sampler',
			// Says which encoding this PUB came back in, so a workflow can branch on it rather than
			// on the absence of `counts`.
			encoding: 'qiskit-serialized',
			register: registerName,
			numBits:
				typeof declared === 'number' &&
				Number.isInteger(declared) &&
				declared >= 0 &&
				declared <= MAX_REGISTER_BITS
					? declared
					: null,
			// zlib compressed NumPy, one row per shot. Inflate it and read the NPY body, or hand the
			// value to qiskit-ibm-runtime, which is what produced it.
			samplesEncoded: encodedValue(bits.array),
			...(preferredRegister && !usePreferred
				? { requestedRegister: preferredRegister, registerFallback: true }
				: {}),
			metadata: pub.metadata ?? {},
		};
	}

	const encoded: IDataObject = {};
	for (const name of fieldNames) encoded[name] = encodedValue(fields[name]);
	return {
		type: 'estimator',
		encoding: 'qiskit-serialized',
		fieldNames,
		// Same compression as the sampler above, one array per field. `evs` and `stds` are the two
		// an estimator job is usually read for; the rest appear when resilience options were on.
		fieldsEncoded: encoded,
		metadata: pub.metadata ?? {},
	};
}

// The noise learner answers on a different shape from the sampler and the estimator: its payload
// sits under `data` rather than `results`, and each entry is a serialised LayerError, not a PUB.
// Reading only `results` reported a real result as zero pubs, and flagged it as a body with
// nothing in it to read.
// That outline is not the learner's alone: IBM's spec gives every Executor and NoiseLearnerV3
// result a `data` array and no `results` array, so one of those read by job id lands here as a
// layer of nulls beside the untouched body in `raw`. Narrowing the test to the `__type__` envelope
// a learner entry carries would answer `resultsAvailable: false` for a body IBM did send.
export function hasNoiseLearnerData(response: IDataObject): boolean {
	if (Array.isArray(response.results) || !Array.isArray(response.data)) return false;
	// Every entry has to look like a layer. Testing only the two top-level keys read an executor
	// body, whose entries carry their own `results`, as a learner and returned it as all nulls.
	return (response.data as unknown[]).every(isLearnerLayer);
}

// The executor program answers with `data` entries that each carry a `results` map of register name
// to array container. It is not a learned layer and it is not the PUB shape either, so it gets its
// own reader rather than being forced through one of theirs.
export function executorEntries(response: IDataObject): IDataObject[] | null {
	if (Array.isArray(response.results) || !Array.isArray(response.data)) return null;
	const entries = response.data as unknown[];
	if (entries.length === 0) return null;
	const usable = entries.every(
		(entry) =>
			Boolean(entry) &&
			typeof entry === 'object' &&
			!Array.isArray(entry) &&
			Boolean((entry as IDataObject).results) &&
			typeof (entry as IDataObject).results === 'object',
	);
	return usable ? (entries as IDataObject[]) : null;
}

export function parseExecutorEntry(entry: unknown): IDataObject {
	const held = (entry ?? {}) as IDataObject;
	const registers: IDataObject = {};
	const source = (held.results as IDataObject) ?? {};
	for (const [name, value] of Object.entries(source)) {
		const held2 = arrayContainer(value);
		registers[name] = held2 ?? null;
	}
	return {
		type: 'executor',
		encoding: 'ibm-array',
		registers,
		metadata: held.metadata ?? {},
	};
}

// A requested register no pub carries is reported rather than raised: the result body has been
// fetched by the time the name is judged, and IBM deletes a private job's results once they have
// been read, so raising would discard the only copy of the shots. Each pub names the register it
// did read. A body with no names to collect has nothing for the name to miss and is left clean;
// what fills the set differs by encoding, so each caller decides that for itself.
function registerMismatch(available: Set<string>, preferredRegister?: string): IDataObject {
	if (!preferredRegister || available.size === 0 || available.has(preferredRegister)) return {};
	return {
		registerError: `Register "${preferredRegister}" is not in this result. Available: ${[
			...available,
		].join(', ')}.`,
	};
}

export function parseResults(response: IDataObject, preferredRegister?: string): IDataObject {
	// Guard on the shape, not just on null. `?? []` let a non-array `results` through to .map and
	// crashed with a bare TypeError; the caller still returns the untouched body as `raw`, so
	// degrading to zero pubs loses nothing and keeps the failure readable. An entry that is not an
	// object needs the same guard for a stronger reason: reading `pub.data` off a null one threw the
	// downloaded body away, the readable pubs beside it included, and IBM serves a private job's
	// results once.
	const results = Array.isArray(response.results)
		? (response.results as unknown[]).map((entry) =>
				entry && typeof entry === 'object' ? (entry as IDataObject) : {},
			)
		: [];

	// The whole body is one envelope in this encoding, so it is recognised before anything reads
	// `results` or `data`, neither of which it carries. A requested register that no PUB holds is
	// reported in this encoding the same way it is in the plain one below.
	if (looksSerialized(response) && serializedPubResults(response) === null) {
		return {
			pubCount: 0,
			pubs: [],
			resultsUnreadable:
				'The result body is the serialised Qiskit encoding but is not valid JSON: IBM writes a bare Infinity for an unbounded value, which JSON does not allow, so no parser can read it. The untouched body is in raw.',
		};
	}

	const serialized = serializedPubResults(response);
	if (serialized) {
		const available = new Set<string>();
		for (const entry of serialized) {
			const names = unwrap(unwrap(entry).data).field_names;
			if (Array.isArray(names)) for (const name of names) available.add(String(name));
		}
		const layers = serialized.map((entry) => parseSerializedPub(entry, preferredRegister));
		return {
			pubCount: layers.length,
			pubs: layers,
			...registerMismatch(available, preferredRegister),
		};
	}

	// Handled before the register logic below, which is about sampler classical registers and has
	// no meaning for a learned noise layer.
	if (hasNoiseLearnerData(response)) {
		const layers = (response.data as unknown[]).map(parseNoiseLearnerPub);
		return { pubCount: layers.length, pubs: layers };
	}

	const executor = executorEntries(response);
	if (executor) {
		const entries = executor.map(parseExecutorEntry);
		return { pubCount: entries.length, pubs: entries };
	}

	// The register scan belongs here, where every pub is visible. A job can hold several pubs whose
	// circuits name their registers differently, so a name missing from one pub is not a mismatch as
	// long as some pub carries it; a name no pub carries is.
	const registersInResult = new Set<string>();
	for (const pub of results) {
		const data = (pub.data as IDataObject) ?? {};
		for (const [name, value] of Object.entries(data)) {
			if (value && typeof value === 'object' && Array.isArray((value as IDataObject).samples)) {
				registersInResult.add(name);
			}
		}
	}

	const pubs = results.map((pub) => {
		const data = (pub.data as IDataObject) ?? {};
		const isSampler = Object.values(data).some(
			(value) =>
				value && typeof value === 'object' && Array.isArray((value as IDataObject).samples),
		);
		if (isSampler) {
			return {
				type: 'sampler',
				...parseSamplerPub(data, preferredRegister),
				metadata: pub.metadata ?? {},
			};
		}
		return {
			type: 'estimator',
			evs: data.evs ?? null,
			stds: data.stds ?? null,
			ensembleStandardError: data.ensemble_standard_error ?? null,
			metadata: pub.metadata ?? {},
		};
	});
	return {
		pubCount: pubs.length,
		pubs,
		...registerMismatch(registersInResult, preferredRegister),
	};
}
