import { describe, expect, it } from 'vitest';

import {
	buildQasm3,
	parseAngleList,
	parseNumberListStrict,
	parseParameterNames,
	renderInstructions,
	RZZ_DEFINITION,
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
		const gates: GateOperation[] = [{ gate: 'measure', targets: [2], controls: [], params: [] }];

		expect(validateGateInput('measure', [2], [], undefined, 3, 1)).toBeNull();
		expect(buildQasm3({ numQubits: 3, numClbits: 1, gates })).toContain('c[0] = measure q[2];');
	});
});

describe('identity is accepted but never emitted', () => {
	// stdgates.inc defines id as U(0, 0, 0), and a job carrying it failed on real hardware although
	// IBM lists id as native (measured for 0.3.3). Dropping it leaves a mathematically identical
	// circuit.
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

	it('lists only the emitted instructions, so a count can be reported beside the gate rows', () => {
		const gates: GateOperation[] = [
			{ gate: 'id', targets: [0], controls: [], params: [] },
			{ gate: 'x', targets: [0], controls: [], params: [] },
			{ gate: 'id', targets: [1], controls: [], params: [] },
			{ gate: 'measure', targets: [0], controls: [], params: [], clbit: 0 },
		];
		expect(renderInstructions({ numQubits: 2, numClbits: 1, gates })).toEqual([
			'x q[0];',
			'c[0] = measure q[0];',
		]);
	});

	it('still validates the identity operand, so a bad index is caught rather than silently dropped', () => {
		expect(validateGateInput('id', [5], [], undefined, 2, 0)).toMatch(/qubit index 5/);
		expect(validateGateInput('id', [], [], undefined, 2, 0)).toMatch(/expects 1 qubit/);
	});
});

// stdgates.inc has no rzz, so a bare call comes back Failed naming `gate 'rzz' is not defined`,
// while the same call carrying Qiskit's block completed on ibm_fez with 64 of 64 shots on `00`.
describe('rzz renders with its definition block', () => {
	it('writes the Qiskit block once, after the include line, however many rzz rows there are', () => {
		const gates: GateOperation[] = [
			{ gate: 'rzz', targets: [0, 1], controls: [], params: [0.5] },
			{ gate: 'rzz', targets: [1, 2], controls: [], params: [0.25] },
			{ gate: 'measure', targets: [0], controls: [], params: [], clbit: 0 },
		];
		const lines = buildQasm3({ numQubits: 3, numClbits: 1, gates }).split('\n');

		expect(lines.slice(0, 7)).toEqual([
			'OPENQASM 3.0;',
			'include "stdgates.inc";',
			...RZZ_DEFINITION,
		]);
		expect(lines.slice(7)).toEqual([
			'qubit[3] q;',
			'bit[1] c;',
			'rzz(0.5) q[0], q[1];',
			'rzz(0.25) q[1], q[2];',
			'c[0] = measure q[0];',
		]);
		expect(lines.filter((line) => line.startsWith('gate rzz'))).toHaveLength(1);
	});

	it('emits no block when no row uses rzz', () => {
		const gates: GateOperation[] = [
			{ gate: 'h', targets: [0], controls: [], params: [] },
			{ gate: 'cx', targets: [1], controls: [0], params: [] },
		];
		expect(buildQasm3({ numQubits: 2, numClbits: 0, gates })).not.toContain('gate rzz');
	});

	it('holds rzz to two distinct qubits and one angle', () => {
		expect(validateGateInput('rzz', [0, 1], [0.5], undefined, 2, 2)).toBeNull();
		expect(validateGateInput('rzz', [0], [0.5], undefined, 2, 2)).toMatch(/expects 2 qubit/);
		expect(validateGateInput('rzz', [0, 0], [0.5], undefined, 2, 2)).toMatch(/more than once/);
		expect(validateGateInput('rzz', [0, 1], [], undefined, 2, 2)).toMatch(/expects 1 parameter/);
	});
});

describe('delay renders with its duration', () => {
	it('emits delay[duration] on the qubit', () => {
		const gates: GateOperation[] = [
			{ gate: 'delay', targets: [0], controls: [], params: [], duration: '160dt' },
		];
		expect(buildQasm3({ numQubits: 1, numClbits: 0, gates })).toContain('delay[160dt] q[0];');
	});

	it('accepts every unit and a decimal on the time units', () => {
		for (const duration of ['100ns', '2.5us', '1ms', '1s', '160dt', '0ns']) {
			expect(validateGateInput('delay', [0], [], undefined, 1, 0, duration), duration).toBeNull();
		}
	});

	it('rejects a missing, malformed or fractional-dt duration', () => {
		expect(validateGateInput('delay', [0], [], undefined, 1, 0)).toMatch(/needs a Duration/);
		expect(validateGateInput('delay', [0], [], undefined, 1, 0, '')).toMatch(/needs a Duration/);
		for (const duration of ['100', '100 ns', '100NS', '1e2ns', 'ns', '-5ns']) {
			expect(validateGateInput('delay', [0], [], undefined, 1, 0, duration), duration).toMatch(
				/is not a number followed by/,
			);
		}
		expect(validateGateInput('delay', [0], [], undefined, 1, 0, '12.5dt')).toMatch(
			/whole number of dt/,
		);
	});

	it('refuses an angle on delay and ignores a duration on other gates', () => {
		expect(validateGateInput('delay', [0], [0.5], undefined, 1, 0, '100ns')).toMatch(
			/expects 0 parameter/,
		);
		expect(validateGateInput('x', [0], [], undefined, 1, 0, 'nonsense')).toBeNull();
	});
});

describe('parseParameterNames', () => {
	it('returns an empty list for empty input', () => {
		expect(parseParameterNames('')).toEqual([]);
		expect(parseParameterNames('   ')).toEqual([]);
	});

	it('keeps declaration order and trims', () => {
		expect(parseParameterNames(' phi , theta ')).toEqual(['phi', 'theta']);
	});

	it('treats a name that also sits on Object.prototype like any other', () => {
		// The duplicate check reads from a Set. A plain object as the seen map would answer for a name
		// never listed and refuse all three of these on sight.
		expect(parseParameterNames('__proto__,constructor,toString')).toEqual([
			'__proto__',
			'constructor',
			'toString',
		]);
		expect(() => parseParameterNames('__proto__,__proto__')).toThrow(/more than once/);
	});

	it('rejects a malformed identifier, a reserved word, a register name and a duplicate', () => {
		expect(() => parseParameterNames('2theta')).toThrow(/not a valid OpenQASM 3 identifier/);
		expect(() => parseParameterNames('theta,,phi')).toThrow(/not a valid OpenQASM 3 identifier/);
		for (const name of ['pi', 'rz', 'input', 'q', 'c', 'p0']) {
			expect(() => parseParameterNames(name), name).toThrow(/is reserved/);
		}
		// None of the rzz block's own names is a keyword, a constant, a gate or a register, so the
		// message has to name them or it explains the refusal with a reason that does not apply.
		for (const name of ['p0', '_gate_q_0', '_gate_q_1']) {
			expect(() => parseParameterNames(name), name).toThrow(
				/one of p0, _gate_q_0 and _gate_q_1 from the rzz definition/,
			);
		}
		expect(() => parseParameterNames('theta,theta')).toThrow(/more than once/);
	});
});

describe('parseAngleList', () => {
	it('returns numbers and declared names, mixed', () => {
		expect(parseAngleList('theta, 0, 1e-3', 'Parameters', new Set(['theta']))).toEqual([
			'theta',
			0,
			0.001,
		]);
		expect(parseAngleList('', 'Parameters', new Set(['theta']))).toEqual([]);
	});

	it('rejects an undeclared name and a non-number with one message', () => {
		for (const value of ['alpha', 'Infinity', '1..5', '0,,1']) {
			expect(() => parseAngleList(value, 'Parameters', new Set()), value).toThrow(
				/not a valid number or a name listed in "Circuit Parameters"/,
			);
		}
	});
});

describe('symbolic parameters', () => {
	it('declares each name after the header and renders it in place of an angle', () => {
		const gates: GateOperation[] = [
			{ gate: 'rx', targets: [0], controls: [], params: ['theta'] },
			{ gate: 'crx', targets: [1], controls: [0], params: ['phi'] },
			{ gate: 'u', targets: [1], controls: [], params: ['theta', 0, 'phi'] },
		];
		const qasm = buildQasm3({
			numQubits: 2,
			numClbits: 0,
			parameters: ['theta', 'phi'],
			gates,
		});

		expect(qasm.split('\n')).toEqual([
			'OPENQASM 3.0;',
			'include "stdgates.inc";',
			'input float[64] theta;',
			'input float[64] phi;',
			'qubit[2] q;',
			'rx(theta) q[0];',
			'crx(phi) q[0], q[1];',
			'U(theta, 0, phi) q[1];',
		]);
	});

	it('puts the rzz block before the input declarations', () => {
		const gates: GateOperation[] = [
			{ gate: 'rzz', targets: [0, 1], controls: [], params: ['theta'] },
		];
		const lines = buildQasm3({
			numQubits: 2,
			numClbits: 0,
			parameters: ['theta'],
			gates,
		}).split('\n');

		expect(lines.indexOf('gate rzz(p0) _gate_q_0, _gate_q_1 {')).toBe(2);
		expect(lines.indexOf('input float[64] theta;')).toBe(7);
		expect(lines).toContain('rzz(theta) q[0], q[1];');
	});

	it('validates a string parameter as an identifier and keeps the non-finite check for numbers', () => {
		expect(validateGateInput('rx', [0], ['theta'], undefined, 1, 0)).toBeNull();
		expect(validateGateInput('rx', [0], ['1 2'], undefined, 1, 0)).toMatch(
			/not a valid OpenQASM 3 identifier/,
		);
		expect(validateGateInput('rx', [0], [Number.NaN], undefined, 1, 0)).toMatch(/non-finite/);
	});
});
