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

// 'id' is deliberately absent: it is handled separately, see the 'id' case in renderGate.
const SINGLE_QUBIT = new Set(['x', 'y', 'z', 'h', 's', 'sdg', 'sx', 't', 'tdg']);
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
	sx: 1,
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
	// A multi-qubit gate needs distinct qubits. IBM queues a program with a repeated index and only
	// then fails it with reason code 1603 ("duplicate bit arguments"), which Qiskit's own parser
	// raises. barrier is exempt and returned above: repeating an index there is harmless.
	const repeated = qubits.find((idx, at) => qubits.indexOf(idx) !== at);
	if (repeated !== undefined) {
		return `Gate '${gate}' uses qubit index ${repeated} more than once; a multi-qubit gate needs distinct qubits.`;
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
			// Fall back to 0, matching the bound validateGateInput range-checks. Falling back to the
			// qubit index instead emitted c[i] for a register validation had only proved has a bit 0,
			// so a 3-qubit / 1-clbit circuit produced an out-of-range c[2] that IBM rejects.
			return `c[${op.clbit ?? 0}] = measure ${q(targets[0])};`;
		case 'id':
			// Emit nothing. stdgates.inc defines id as U(0, 0, 0), and IBM's target rejects the
			// builtin U, so "id q[n];" fails the job on real hardware with "the instruction u is
			// not supported" even though the backend lists id among its basis gates. id is the
			// identity, so dropping it leaves a mathematically equivalent circuit that runs.
			return '';
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
			// Uppercase U is the OpenQASM 3 builtin unitary. stdgates.inc defines no lowercase u,
			// so emitting "u(...)" would be an undefined gate and IBM's parser rejects the program.
			return `U(${fmt(params[0])}, ${fmt(params[1])}, ${fmt(params[2])}) ${q(targets[0])};`;
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
	const lines = ['OPENQASM 3.0;', 'include "stdgates.inc";', `qubit[${circuit.numQubits}] q;`];
	if (circuit.numClbits > 0) lines.push(`bit[${circuit.numClbits}] c;`);
	// renderGate returns an empty string for instructions that must not reach the program (id).
	for (const op of circuit.gates) {
		const line = renderGate(op);
		if (line) lines.push(line);
	}
	return lines.join('\n');
}
