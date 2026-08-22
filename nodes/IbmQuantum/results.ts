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
	// circuits name their registers differently. parseResults raises when NO pub carries it.
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
export function parseNoiseLearnerPub(entry: unknown): IDataObject {
	const layer = unwrap(entry);
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

// The noise learner answers on a different shape from the sampler and the estimator: its payload
// sits under `data` rather than `results`, and each entry is a serialised LayerError, not a PUB.
// Reading only `results` reported a real result as zero pubs, and told the caller the body was
// empty when it was not.
export function hasNoiseLearnerData(response: IDataObject): boolean {
	return !Array.isArray(response.results) && Array.isArray(response.data);
}

export function parseResults(response: IDataObject, preferredRegister?: string): IDataObject {
	// Guard on the shape, not just on null. `?? []` let a non-array `results` through to .map and
	// crashed with a bare TypeError; the caller still returns the untouched body as `raw`, so
	// degrading to zero pubs loses nothing and keeps the failure readable.
	const results = Array.isArray(response.results) ? (response.results as IDataObject[]) : [];

	// Handled before the register logic below, which is about sampler classical registers and has
	// no meaning for a learned noise layer.
	if (hasNoiseLearnerData(response)) {
		const layers = (response.data as unknown[]).map(parseNoiseLearnerPub);
		return { pubCount: layers.length, pubs: layers };
	}

	// The register check belongs here, where every pub is visible. A job can hold several pubs whose
	// circuits name their registers differently, so a name missing from one pub is not an error as
	// long as some pub carries it; a name no pub carries is.
	if (preferredRegister) {
		const registersInResult = new Set<string>();
		for (const pub of results) {
			const data = (pub.data as IDataObject) ?? {};
			for (const [name, value] of Object.entries(data)) {
				if (value && typeof value === 'object' && Array.isArray((value as IDataObject).samples)) {
					registersInResult.add(name);
				}
			}
		}
		if (registersInResult.size > 0 && !registersInResult.has(preferredRegister)) {
			throw new Error(
				`Register "${preferredRegister}" is not in this result. Available: ${[
					...registersInResult,
				].join(', ')}.`,
			);
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
	return { pubCount: pubs.length, pubs };
}
