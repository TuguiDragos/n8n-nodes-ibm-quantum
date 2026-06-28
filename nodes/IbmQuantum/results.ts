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

// Bit order follows the classical register: c[0] is the right most bit.
function parseSamplerPub(data: IDataObject, preferredRegister?: string): IDataObject {
	const registerNames = Object.keys(data);
	const hasSamples = (name: string): boolean => {
		const register = data[name] as IDataObject | undefined;
		return Boolean(register) && Array.isArray((register as IDataObject).samples);
	};
	const registerName =
		preferredRegister && hasSamples(preferredRegister)
			? preferredRegister
			: registerNames.find(hasSamples);

	if (!registerName) return { register: null, counts: {}, shots: 0 };

	const register = data[registerName] as IDataObject;
	const samples = (register.samples as string[]) ?? [];
	const numBits = (register.num_bits as number) ?? inferNumBits(samples);
	return {
		register: registerName,
		numBits,
		shots: samples.length,
		counts: samplesToCounts(samples, numBits),
	};
}

export function parseResults(response: IDataObject, preferredRegister?: string): IDataObject {
	const results = (response.results as IDataObject[]) ?? [];
	const pubs = results.map((pub) => {
		const data = (pub.data as IDataObject) ?? {};
		const isSampler = Object.values(data).some(
			(value) => value && typeof value === 'object' && Array.isArray((value as IDataObject).samples),
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
