export interface GateOperation {
	gate: string;
	targets: number[];
	controls: number[];
	params: Array<number | string>;
	clbit?: number;
	duration?: string;
}

export interface CircuitDefinition {
	numQubits: number;
	numClbits: number;
	gates: GateOperation[];
	parameters?: string[];
}

// 'id' is deliberately absent: it is handled separately, see the 'id' case in renderGate.
const SINGLE_QUBIT = new Set(['x', 'y', 'z', 'h', 's', 'sdg', 'sx', 't', 'tdg']);
const SINGLE_QUBIT_PARAM = new Set(['rx', 'ry', 'rz', 'p']);
const CONTROLLED_PARAM = new Set(['crx', 'cry', 'crz']);

// An OpenQASM 3 identifier in its ASCII form. Both the declared circuit parameters and any
// parameter name used as an angle have to satisfy it.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A duration literal: a number and a unit, no space between them. dt is the backend sample time.
const DURATION = /^(\d+(?:\.\d+)?)(ns|us|ms|s|dt)$/;

// Every gate stdgates.inc defines, plus the builtin U. A basis gate outside this set has no
// definition unless the circuit carries one, and IBM's importer refuses the bare call.
export const STDGATES_INC: ReadonlySet<string> = new Set([
	'p',
	'x',
	'y',
	'z',
	'h',
	's',
	'sdg',
	't',
	'tdg',
	'sx',
	'rx',
	'ry',
	'rz',
	'cx',
	'cy',
	'cz',
	'cp',
	'crx',
	'cry',
	'crz',
	'ch',
	'swap',
	'ccx',
	'cswap',
	'cu',
	'CX',
	'phase',
	'cphase',
	'id',
	'u1',
	'u2',
	'u3',
	'U',
]);

// Names a circuit parameter cannot take: the two registers the builder declares, the built-in
// constants, every gate stdgates.inc defines plus the builtin U and rzz, the locals of the rzz
// block below, and the language keywords. Declaring any of them as `input float[64]` makes the
// program invalid or silently shadows a gate.
const RESERVED_NAMES = new Set([
	'q',
	'c',
	'pi',
	'tau',
	'euler',
	...STDGATES_INC,
	'rzz',
	'p0',
	'_gate_q_0',
	'_gate_q_1',
	'OPENQASM',
	'include',
	'defcalgrammar',
	'def',
	'cal',
	'defcal',
	'gate',
	'extern',
	'box',
	'let',
	'break',
	'continue',
	'if',
	'else',
	'end',
	'return',
	'for',
	'while',
	'in',
	'pragma',
	'input',
	'output',
	'const',
	'readonly',
	'mutable',
	'qreg',
	'qubit',
	'creg',
	'bit',
	'bool',
	'int',
	'uint',
	'float',
	'angle',
	'complex',
	'array',
	'void',
	'duration',
	'stretch',
	'gphase',
	'inv',
	'pow',
	'ctrl',
	'negctrl',
	'dim',
	'durationof',
	'delay',
	'reset',
	'measure',
	'barrier',
	'true',
	'false',
	'im',
	'switch',
	'case',
	'default',
	'nop',
	'sizeof',
]);

// The block Qiskit 2.5.2 writes for rzz, verbatim, since stdgates.inc has no definition for it.
// Measured on ibm_fez: the bare call fails with "gate 'rzz' is not defined", the defined call
// completes. Emitted once, right after the include line, whenever a circuit uses rzz.
export const RZZ_DEFINITION = [
	'gate rzz(p0) _gate_q_0, _gate_q_1 {',
	'  cx _gate_q_0, _gate_q_1;',
	'  rz(p0) _gate_q_1;',
	'  cx _gate_q_0, _gate_q_1;',
	'}',
];

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
	delay: 1,
	rx: 1,
	ry: 1,
	rz: 1,
	p: 1,
	u: 1,
	cx: 2,
	cz: 2,
	swap: 2,
	rzz: 2,
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
	rzz: 1,
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

// Parse the comma-separated names of the symbolic parameters, in declaration order. Throws on a
// malformed identifier, a reserved name or a duplicate instead of dropping it.
export function parseParameterNames(value: string): string[] {
	if (!value || !value.trim()) return [];
	// A Set, not an array searched with includes: that search is linear in the names read so far,
	// so 40,000 names blocked the event loop for a second. Insertion order is declaration order.
	const names = new Set<string>();
	for (const part of value.split(',')) {
		const name = part.trim();
		if (!IDENTIFIER.test(name)) {
			throw new Error(
				`Circuit Parameters: "${name}" is not a valid OpenQASM 3 identifier (letters, digits and underscores, not starting with a digit).`,
			);
		}
		if (RESERVED_NAMES.has(name)) {
			throw new Error(
				`Circuit Parameters: "${name}" is reserved (a keyword, a constant, a gate name, one of the registers q and c, or one of p0, _gate_q_0 and _gate_q_1 from the rzz definition).`,
			);
		}
		if (names.has(name)) {
			throw new Error(`Circuit Parameters: "${name}" is listed more than once.`);
		}
		names.add(name);
	}
	return [...names];
}

// Parse a gate's comma-separated angles: each entry is a number or one of the declared names.
export function parseAngleList(
	value: string,
	label: string,
	declared: ReadonlySet<string>,
): Array<number | string> {
	if (!value || !value.trim()) return [];
	return value.split(',').map((part) => {
		const trimmed = part.trim();
		if (declared.has(trimmed)) return trimmed;
		const parsed = Number(trimmed);
		// The identifier test keeps Infinity and NaN, which Number accepts, from passing as angles
		// when they were never declared.
		if (trimmed === '' || IDENTIFIER.test(trimmed) || Number.isNaN(parsed)) {
			throw new Error(
				`${label}: "${part}" is not a valid number or a name listed in "Circuit Parameters".`,
			);
		}
		return parsed;
	});
}

// Validate a gate's qubit, parameter and clbit input. Returns an error message, or null if valid.
export function validateGateInput(
	gate: string,
	qubits: number[],
	params: Array<number | string>,
	clbit: number | undefined,
	numQubits: number,
	numClbits: number,
	duration?: string,
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
	const badName = params.find((value) => typeof value === 'string' && !IDENTIFIER.test(value));
	if (badName !== undefined) {
		return `Gate '${gate}' has a parameter "${badName}" that is not a valid OpenQASM 3 identifier.`;
	}
	const badParam = params.find((value) => typeof value === 'number' && !Number.isFinite(value));
	if (badParam !== undefined) {
		return `Gate '${gate}' has a non-finite parameter (${badParam}).`;
	}

	if (gate === 'delay') {
		const text = duration ?? '';
		if (text === '') return 'delay needs a Duration such as 100ns or 160dt.';
		const match = DURATION.exec(text);
		if (!match) {
			return `delay Duration "${text}" is not a number followed by ns, us, ms, s or dt (e.g. 100ns).`;
		}
		if (match[2] === 'dt' && !Number.isInteger(Number(match[1]))) {
			return `delay Duration "${text}" must be a whole number of dt.`;
		}
	}

	if (gate === 'measure') {
		const target = clbit ?? 0;
		if (!Number.isInteger(target) || target < 0 || target >= numClbits) {
			return `measure targets classical bit ${target}; expected an integer in [0, ${numClbits}). Increase "Number of Classical Bits".`;
		}
	}

	return null;
}

function fmt(angle: number | string): string {
	return typeof angle === 'string' ? angle : Number(angle).toString();
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
			// Emit nothing. stdgates.inc defines id as U(0, 0, 0), and a bare "id q[n];" failed every
			// job it appeared in with "the instruction u on qubits (n,) is not supported", measured for
			// 0.3.3 on ibm_kingston and ibm_marrakesh, although IBM lists id as native: the likely
			// cause is IBM's importer expanding that definition before the target sees it. id is the
			// identity, so dropping it leaves a mathematically equivalent circuit that runs. Submit
			// warns about an id it is handed, for the same reason.
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
		case 'rzz':
			return `rzz(${fmt(params[0])}) ${q(targets[0])}, ${q(targets[1])};`;
		case 'delay':
			return `delay[${op.duration}] ${q(targets[0])};`;
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

// The instruction lines the gate rows produce, in order. renderGate returns an empty string for an
// instruction that must not reach the program (id), so the length of this list is what the device
// is asked to run, while gates.length is what the user typed.
export function renderInstructions(circuit: CircuitDefinition): string[] {
	return circuit.gates.map(renderGate).filter((line) => line !== '');
}

export function buildQasm3(circuit: CircuitDefinition): string {
	const lines = ['OPENQASM 3.0;', 'include "stdgates.inc";'];
	if (circuit.gates.some((op) => op.gate === 'rzz')) lines.push(...RZZ_DEFINITION);
	for (const name of circuit.parameters ?? []) lines.push(`input float[64] ${name};`);
	lines.push(`qubit[${circuit.numQubits}] q;`);
	if (circuit.numClbits > 0) lines.push(`bit[${circuit.numClbits}] c;`);
	// One push per line: spread as call arguments, the list overflows the stack past 125,000 rows.
	for (const line of renderInstructions(circuit)) lines.push(line);
	return lines.join('\n');
}
