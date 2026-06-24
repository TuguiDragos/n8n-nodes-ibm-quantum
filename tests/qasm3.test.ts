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
		expect(lines).toContain('u(0.1, 0.2, 0.3) q[1];');
		expect(lines).toContain('crx(0.5) q[0], q[1];');
		expect(lines).toContain('ccx q[0], q[1], q[2];');
		expect(lines).toContain('swap q[0], q[1];');
		expect(lines).toContain('reset q[0];');
		expect(lines).toContain('barrier q;');
	});
});
