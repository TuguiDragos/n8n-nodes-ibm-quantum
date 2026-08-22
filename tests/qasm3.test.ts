import { describe, expect, it } from 'vitest';

import {
	buildQasm3,
	parseNumberListStrict,
	validateGateInput,
	type GateOperation,
} from '../nodes/IbmQuantum/qasm3';

describe('parseNumberListStrict', () => {
	it('returns an empty array for empty input', () => {
		expect(parseNumberListStrict('', 'Qubits')).toEqual([]);
		expect(parseNumberListStrict('   ', 'Qubits')).toEqual([]);
	});

	it('parses integers and floats', () => {
		expect(parseNumberListStrict('0,1,2', 'Qubits')).toEqual([0, 1, 2]);
		expect(parseNumberListStrict('1.5708', 'Parameters')).toEqual([1.5708]);
		expect(parseNumberListStrict('0, 1 , 2', 'Qubits')).toEqual([0, 1, 2]);
	});

	it('throws on a non-numeric token instead of dropping it', () => {
		expect(() => parseNumberListStrict('0,foo', 'Qubits')).toThrow(/not a valid number/);
		expect(() => parseNumberListStrict('0,,1', 'Qubits')).toThrow(/not a valid number/);
	});
});

describe('validateGateInput', () => {
	it('accepts well-formed gates', () => {
		expect(validateGateInput('h', [0], [], undefined, 2, 2)).toBeNull();
		expect(validateGateInput('cx', [0, 1], [], undefined, 2, 2)).toBeNull();
		expect(validateGateInput('rx', [0], [1.5708], undefined, 2, 2)).toBeNull();
		expect(validateGateInput('u', [0], [0.1, 0.2, 0.3], undefined, 2, 2)).toBeNull();
		expect(validateGateInput('measure', [0], [], 1, 2, 2)).toBeNull();
		expect(validateGateInput('barrier', [], [], undefined, 2, 2)).toBeNull();
	});

	it('rejects wrong qubit arity', () => {
		expect(validateGateInput('h', [], [], undefined, 2, 2)).toMatch(/expects 1 qubit/);
		expect(validateGateInput('cx', [0], [], undefined, 2, 2)).toMatch(/expects 2 qubit/);
	});

	it('rejects out-of-range, negative and non-integer indices', () => {
		expect(validateGateInput('h', [5], [], undefined, 2, 2)).toMatch(/qubit index 5/);
		expect(validateGateInput('h', [-1], [], undefined, 2, 2)).toMatch(/qubit index -1/);
		expect(validateGateInput('h', [1.5], [], undefined, 2, 2)).toMatch(/qubit index 1.5/);
	});

	// The range is half open: [0, numQubits). Asserting only far-out values let an off-by-one
	// weakening (idx <= numQubits) survive untouched.
	it('accepts the last valid index and rejects the first invalid one', () => {
		expect(validateGateInput('h', [1], [], undefined, 2, 2)).toBeNull();
		expect(validateGateInput('h', [2], [], undefined, 2, 2)).toMatch(/qubit index 2/);
		expect(validateGateInput('h', [0], [], undefined, 1, 1)).toBeNull();
		expect(validateGateInput('h', [1], [], undefined, 1, 1)).toMatch(/qubit index 1/);
	});

	it('applies the same boundary to a classical bit', () => {
		expect(validateGateInput('measure', [0], [], 1, 2, 2)).toBeNull();
		expect(validateGateInput('measure', [0], [], 2, 2, 2)).toMatch(/classical bit 2/);
	});

	it('applies the same boundary to barrier', () => {
		expect(validateGateInput('barrier', [1], [], undefined, 2, 2)).toBeNull();
		expect(validateGateInput('barrier', [2], [], undefined, 2, 2)).toMatch(/qubit index 2/);
	});

	it('rejects wrong parameter counts and non-finite parameters', () => {
		expect(validateGateInput('rx', [0], [], undefined, 2, 2)).toMatch(/expects 1 parameter/);
		expect(validateGateInput('u', [0], [0.1, 0.2], undefined, 2, 2)).toMatch(/expects 3 parameter/);
		expect(validateGateInput('h', [0], [0.5], undefined, 2, 2)).toMatch(/expects 0 parameter/);
		expect(validateGateInput('rx', [0], [Number.POSITIVE_INFINITY], undefined, 2, 2)).toMatch(
			/non-finite/,
		);
	});

	it('validates the measure classical bit against the classical register', () => {
		expect(validateGateInput('measure', [0], [], 0, 2, 0)).toMatch(/classical bit/);
		expect(validateGateInput('measure', [0], [], 2, 2, 2)).toMatch(/classical bit/);
	});

	it('flags an unsupported gate', () => {
		expect(validateGateInput('foo', [0], [], undefined, 2, 2)).toMatch(/Unsupported gate/);
	});

	it('validates barrier indices when present', () => {
		expect(validateGateInput('barrier', [0, 1], [], undefined, 2, 2)).toBeNull();
		expect(validateGateInput('barrier', [9], [], undefined, 2, 2)).toMatch(/qubit index 9/);
	});

	// A repeated index reaches IBM as a queued job that fails with reason code 1603.
	it('rejects a repeated qubit index on every multi-qubit gate', () => {
		expect(validateGateInput('cx', [1, 1], [], undefined, 3, 3)).toMatch(
			/uses qubit index 1 more than once/,
		);
		expect(validateGateInput('cz', [0, 0], [], undefined, 3, 3)).toMatch(/more than once/);
		expect(validateGateInput('swap', [2, 2], [], undefined, 3, 3)).toMatch(/more than once/);
		expect(validateGateInput('crx', [0, 0], [0.5], undefined, 3, 3)).toMatch(/more than once/);
		expect(validateGateInput('cry', [1, 1], [0.5], undefined, 3, 3)).toMatch(/more than once/);
		expect(validateGateInput('crz', [2, 2], [0.5], undefined, 3, 3)).toMatch(/more than once/);
		expect(validateGateInput('ccx', [0, 0, 1], [], undefined, 3, 3)).toMatch(/more than once/);
		expect(validateGateInput('ccx', [0, 1, 1], [], undefined, 3, 3)).toMatch(/more than once/);
	});

	it('names the first repeated index, not the last', () => {
		expect(validateGateInput('ccx', [2, 0, 0], [], undefined, 3, 3)).toMatch(
			/uses qubit index 0 more than once/,
		);
	});

	it('still accepts distinct indices on every multi-qubit gate', () => {
		expect(validateGateInput('cx', [0, 1], [], undefined, 3, 3)).toBeNull();
		expect(validateGateInput('swap', [0, 2], [], undefined, 3, 3)).toBeNull();
		expect(validateGateInput('ccx', [0, 1, 2], [], undefined, 3, 3)).toBeNull();
		expect(validateGateInput('crz', [1, 2], [0.5], undefined, 3, 3)).toBeNull();
	});

	// barrier is a scheduling marker, so a repeated index changes nothing and Qiskit accepts it.
	it('allows a repeated index on barrier', () => {
		expect(validateGateInput('barrier', [0, 0, 1], [], undefined, 3, 3)).toBeNull();
	});

	// The range check runs first, so an out-of-range duplicate reports the range problem.
	it('reports an out-of-range index before the duplicate check', () => {
		expect(validateGateInput('cx', [9, 9], [], undefined, 3, 3)).toMatch(/qubit index 9/);
	});
});

describe('buildQasm3', () => {
	it('renders a Bell circuit verbatim', () => {
		const gates: GateOperation[] = [
			{ gate: 'h', targets: [0], controls: [], params: [] },
			{ gate: 'cx', targets: [1], controls: [0], params: [] },
			{ gate: 'measure', targets: [0], controls: [], params: [], clbit: 0 },
			{ gate: 'measure', targets: [1], controls: [], params: [], clbit: 1 },
		];

		expect(buildQasm3({ numQubits: 2, numClbits: 2, gates })).toBe(
			[
				'OPENQASM 3.0;',
				'include "stdgates.inc";',
				'qubit[2] q;',
				'bit[2] c;',
				'h q[0];',
				'cx q[0], q[1];',
				'c[0] = measure q[0];',
				'c[1] = measure q[1];',
			].join('\n'),
		);
	});

	// sx is the only single-qubit gate in the Heron basis besides x, so an ISA circuit written by
	// hand needs it. Verified on ibm_fez: `sx sx` reads 249 of 256 shots as 1, which is X, and a
	// single sx reads a 47/53 split, which is the superposition. stdgates.inc defines it, so the
	// emitted line is the bare form Qiskit itself writes for a transpiled circuit.
	it('renders sx as the bare stdgates form, with no definition block', () => {
		const gates: GateOperation[] = [
			{ gate: 'sx', targets: [0], controls: [], params: [] },
			{ gate: 'sx', targets: [0], controls: [], params: [] },
			{ gate: 'measure', targets: [0], controls: [], params: [], clbit: 0 },
		];
		const qasm = buildQasm3({ numQubits: 1, numClbits: 1, gates });
		expect(qasm.split('\n')).toEqual([
			'OPENQASM 3.0;',
			'include "stdgates.inc";',
			'qubit[1] q;',
			'bit[1] c;',
			'sx q[0];',
			'sx q[0];',
			'c[0] = measure q[0];',
		]);
		// No `gate sx` block, and nothing routed through the builtin U, which hardware rejects.
		expect(qasm).not.toContain('gate sx');
		expect(qasm).not.toContain('U(');
	});

	it('holds sx to one qubit and no angle', () => {
		expect(validateGateInput('sx', [0], [], undefined, 2, 2)).toBeNull();
		expect(validateGateInput('sx', [0, 1], [], undefined, 2, 2)).toMatch(/expects 1 qubit/);
		expect(validateGateInput('sx', [0], [0.5], undefined, 2, 2)).toMatch(/expects 0 parameter/);
		expect(validateGateInput('sx', [5], [], undefined, 2, 2)).toMatch(/qubit index 5/);
	});

	it('omits the classical register when there are no classical bits', () => {
		const qasm = buildQasm3({ numQubits: 1, numClbits: 0, gates: [] });
		expect(qasm).not.toMatch(/^bit\[/m);
		expect(qasm).toContain('qubit[1] q;');
	});

	it('renders parametric, controlled and structural gates', () => {
		const gates: GateOperation[] = [
			{ gate: 'rx', targets: [0], controls: [], params: [1.5708] },
			{ gate: 'u', targets: [1], controls: [], params: [0.1, 0.2, 0.3] },
			{ gate: 'crx', targets: [1], controls: [0], params: [0.5] },
			{ gate: 'ccx', targets: [2], controls: [0, 1], params: [] },
			{ gate: 'swap', targets: [0, 1], controls: [], params: [] },
			{ gate: 'reset', targets: [0], controls: [], params: [] },
			{ gate: 'barrier', targets: [], controls: [], params: [] },
		];
		const lines = buildQasm3({ numQubits: 3, numClbits: 0, gates }).split('\n');

		expect(lines).toContain('rx(1.5708) q[0];');
		// Uppercase U: the builtin gate, since stdgates.inc has no lowercase u.
		expect(lines).toContain('U(0.1, 0.2, 0.3) q[1];');
		expect(lines).toContain('crx(0.5) q[0], q[1];');
		expect(lines).toContain('ccx q[0], q[1], q[2];');
		expect(lines).toContain('swap q[0], q[1];');
		expect(lines).toContain('reset q[0];');
		expect(lines).toContain('barrier q;');
	});

	// validateGateInput range-checks `clbit ?? 0`, so the renderer has to agree. It used to fall
	// back to the qubit index, which passed validation and then wrote past the classical register.
	it('renders a measure with no classical bit into c[0], matching what validation checked', () => {
		const gates: GateOperation[] = [
			{ gate: 'measure', targets: [2], controls: [], params: [] },
		];

		expect(validateGateInput('measure', [2], [], undefined, 3, 1)).toBeNull();
		expect(buildQasm3({ numQubits: 3, numClbits: 1, gates })).toContain('c[0] = measure q[2];');
	});
});

describe('identity is accepted but never emitted', () => {
	// stdgates.inc defines id through the builtin U, which IBM's target rejects, so emitting it
	// fails the job on real hardware. Dropping it leaves a mathematically identical circuit.
	it('drops id from the program while keeping the surrounding instructions', () => {
		const gates: GateOperation[] = [
			{ gate: 'id', targets: [0], controls: [], params: [] },
			{ gate: 'x', targets: [0], controls: [], params: [] },
			{ gate: 'id', targets: [1], controls: [], params: [] },
			{ gate: 'measure', targets: [0], controls: [], params: [], clbit: 0 },
		];
		const qasm = buildQasm3({ numQubits: 2, numClbits: 1, gates });

		expect(qasm).not.toMatch(/\bid\b/);
		expect(qasm).not.toMatch(/\bU\(/);
		expect(qasm.split('\n')).toEqual([
			'OPENQASM 3.0;',
			'include "stdgates.inc";',
			'qubit[2] q;',
			'bit[1] c;',
			'x q[0];',
			'c[0] = measure q[0];',
		]);
	});

	it('still validates the identity operand, so a bad index is caught rather than silently dropped', () => {
		expect(validateGateInput('id', [5], [], undefined, 2, 0)).toMatch(/qubit index 5/);
		expect(validateGateInput('id', [], [], undefined, 2, 0)).toMatch(/expects 1 qubit/);
	});
});
