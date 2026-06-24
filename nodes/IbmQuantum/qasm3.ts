export interface GateOperation {
	gate: string;
	targets: number[];
	controls: number[];
	params: number[];
	clbit?: number;
}

export interface CircuitDefinition {
	numQubits: number;
	numClbits: number;
	gates: GateOperation[];
}

const SINGLE_QUBIT = new Set(['id', 'x', 'y', 'z', 'h', 's', 'sdg', 't', 'tdg']);
const SINGLE_QUBIT_PARAM = new Set(['rx', 'ry', 'rz', 'p']);
const CONTROLLED_PARAM = new Set(['crx', 'cry', 'crz']);

// Qubit indices each gate consumes (controls + targets). barrier is variable and validated separately.
export const QUBIT_ARITY: Record<string, number> = {
	id: 1,
	x: 1,
	y: 1,
	z: 1,
	h: 1,
	s: 1,
	sdg: 1,
	t: 1,
	tdg: 1,
	reset: 1,
	measure: 1,
	rx: 1,
	ry: 1,
	rz: 1,
	p: 1,
	u: 1,
	cx: 2,
	cz: 2,
	swap: 2,
	crx: 2,
	cry: 2,
	crz: 2,
	ccx: 3,
};

// Angle parameters each gate requires. Gates not listed take zero.
export const PARAM_ARITY: Record<string, number> = {
	rx: 1,
	ry: 1,
	rz: 1,
	p: 1,
	crx: 1,
	cry: 1,
	crz: 1,
	u: 3,
};

// Parse a comma-separated number list, throwing on any non-numeric token instead of dropping it.
export function parseNumberListStrict(value: string, label: string): number[] {
	if (!value || !value.trim()) return [];
	return value.split(',').map((part) => {
		const trimmed = part.trim();
		const parsed = Number(trimmed);
		if (trimmed === '' || Number.isNaN(parsed)) {
			throw new Error(`${label}: "${part}" is not a valid number`);
		}
		return parsed;
	});
}

// Validate a gate's qubit, parameter and clbit input. Returns an error message, or null if valid.
export function validateGateInput(
	gate: string,
	qubits: number[],
	params: number[],
	clbit: number | undefined,
	numQubits: number,
	numClbits: number,
): string | null {
	const inRange = (idx: number): boolean => Number.isInteger(idx) && idx >= 0 && idx < numQubits;

	if (gate === 'barrier') {
		const bad = qubits.find((idx) => !inRange(idx));
		if (bad !== undefined) {
			return `barrier references qubit index ${bad}; expected an integer in [0, ${numQubits}).`;
		}
		return null;
	}

	const expectedQubits = QUBIT_ARITY[gate];
	if (expectedQubits === undefined) return `Unsupported gate: ${gate}`;

	if (qubits.length !== expectedQubits) {
		return `Gate '${gate}' expects ${expectedQubits} qubit index(es), got ${qubits.length}.`;
	}
	const offender = qubits.find((idx) => !inRange(idx));
	if (offender !== undefined) {
		return `Gate '${gate}' references qubit index ${offender}; expected an integer in [0, ${numQubits}).`;
	}

	const expectedParams = PARAM_ARITY[gate] ?? 0;
	if (params.length !== expectedParams) {
		return `Gate '${gate}' expects ${expectedParams} parameter(s), got ${params.length}.`;
	}
	const badParam = params.find((value) => !Number.isFinite(value));
	if (badParam !== undefined) {
		return `Gate '${gate}' has a non-finite parameter (${badParam}).`;
	}

	if (gate === 'measure') {
		const target = clbit ?? 0;
		if (!Number.isInteger(target) || target < 0 || target >= numClbits) {
			return `measure targets classical bit ${target}; expected an integer in [0, ${numClbits}). Increase "Number of Classical Bits".`;
		}
	}

	return null;
}

function fmt(angle: number): string {
	return Number(angle).toString();
}

function q(index: number): string {
	return `q[${index}]`;
}

function renderGate(op: GateOperation): string {
	const { gate, targets, controls, params } = op;

	switch (gate) {
		case 'measure':
			return `c[${op.clbit ?? targets[0]}] = measure ${q(targets[0])};`;
		case 'reset':
			return `reset ${q(targets[0])};`;
		case 'barrier':
			return targets.length ? `barrier ${targets.map(q).join(', ')};` : 'barrier q;';
		case 'swap':
			return `swap ${q(targets[0])}, ${q(targets[1])};`;
		case 'cx':
		case 'cz':
			return `${gate} ${q(controls[0])}, ${q(targets[0])};`;
		case 'ccx':
			return `ccx ${q(controls[0])}, ${q(controls[1])}, ${q(targets[0])};`;
		case 'u':
			return `u(${fmt(params[0])}, ${fmt(params[1])}, ${fmt(params[2])}) ${q(targets[0])};`;
		default:
			if (SINGLE_QUBIT.has(gate)) return `${gate} ${q(targets[0])};`;
			if (SINGLE_QUBIT_PARAM.has(gate)) return `${gate}(${fmt(params[0])}) ${q(targets[0])};`;
			if (CONTROLLED_PARAM.has(gate)) {
				return `${gate}(${fmt(params[0])}) ${q(controls[0])}, ${q(targets[0])};`;
			}
			throw new Error(`Unsupported gate: ${gate}`);
	}
}

export function buildQasm3(circuit: CircuitDefinition): string {
	const lines = [
		'OPENQASM 3.0;',
		'include "stdgates.inc";',
		`qubit[${circuit.numQubits}] q;`,
	];
	if (circuit.numClbits > 0) lines.push(`bit[${circuit.numClbits}] c;`);
	for (const op of circuit.gates) lines.push(renderGate(op));
	return lines.join('\n');
}
