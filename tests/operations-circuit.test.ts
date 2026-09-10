import { describe, expect, it } from 'vitest';

import { handleCircuitBuild, handleCircuitImport } from '../nodes/IbmQuantum/operations';
import { makeExecuteContext } from './fakeContext';

function build(params: Record<string, unknown>) {
	const { ctx } = makeExecuteContext({ params });
	return handleCircuitBuild.call(ctx, 0) as ReturnType<typeof handleCircuitBuild>;
}

describe('handleCircuitBuild gate mapping and ordering (TEST-06)', () => {
	it('emits the correct operand order across single, controlled, swap and measure gates', () => {
		const result = build({
			numQubits: 3,
			numClbits: 1,
			gates: {
				gate: [
					{ gate: 'h', qubits: '0', params: '' },
					{ gate: 'cx', qubits: '0,1', params: '' },
					{ gate: 'crx', qubits: '0,1', params: '0.5' },
					{ gate: 'ccx', qubits: '0,1,2', params: '' },
					{ gate: 'swap', qubits: '0,1', params: '' },
					{ gate: 'measure', qubits: '0', params: '', clbit: 0 },
				],
			},
		});
		const lines = (result.qasm3 as string).split('\n');
		expect(lines).toContain('h q[0];');
		expect(lines).toContain('cx q[0], q[1];');
		expect(lines).toContain('crx(0.5) q[0], q[1];');
		expect(lines).toContain('ccx q[0], q[1], q[2];');
		expect(lines).toContain('swap q[0], q[1];');
		expect(lines).toContain('c[0] = measure q[0];');
		expect(result.gateCount).toBe(6);
		expect(result.instructionCount).toBe(6);
	});

	// A gate object built outside the UI (an AI Agent tool call, an imported workflow, the public
	// API) can omit clbit entirely. That has to land on c[0], the bit validation range-checked,
	// rather than on the qubit index, which produced a write past the classical register.
	it('measures into c[0] when the gate carries no classical bit', () => {
		const result = build({
			numQubits: 3,
			numClbits: 1,
			gates: { gate: [{ gate: 'measure', qubits: '2', params: '' }] },
		});
		expect((result.qasm3 as string).split('\n')).toContain('c[0] = measure q[2];');
	});

	it('reports instructionCount from the emitted lines and gateCount from the rows', () => {
		const result = build({
			numQubits: 2,
			numClbits: 2,
			gates: {
				gate: [
					{ gate: 'h', qubits: '0', params: '' },
					{ gate: 'id', qubits: '0', params: '' },
					{ gate: 'cx', qubits: '0,1', params: '' },
					{ gate: 'id', qubits: '1', params: '' },
					{ gate: 'measure', qubits: '0', params: '', clbit: 0 },
					{ gate: 'measure', qubits: '1', params: '', clbit: 1 },
				],
			},
		});
		expect(result.gateCount).toBe(6);
		expect(result.instructionCount).toBe(4);
		expect((result.qasm3 as string).split('\n')).toHaveLength(8);
		expect(result.qasm3).not.toMatch(/\bid\b/);
	});

	// The spread that briefly replaced the per-line push threw RangeError from about 125,000 rows,
	// where the loop it replaced rendered a million; this pins the loop.
	it('renders a gate list of 200,000 rows without overflowing the stack', () => {
		const gate = Array.from({ length: 200000 }, () => ({ gate: 'x', qubits: '0', params: '' }));
		const result = build({ numQubits: 1, numClbits: 0, gates: { gate } });
		expect(result.gateCount).toBe(200000);
		expect(result.instructionCount).toBe(200000);
		const lines = (result.qasm3 as string).split('\n');
		expect(lines).toHaveLength(200003);
		expect(lines[200002]).toBe('x q[0];');
	});
});

describe('handleCircuitBuild register size validation', () => {
	it('rejects a zero or negative qubit count injected by expression', () => {
		expect(() => build({ numQubits: 0, numClbits: 0, gates: {} })).toThrow(/Number of Qubits/);
		expect(() => build({ numQubits: -3, numClbits: 0, gates: {} })).toThrow(/Number of Qubits/);
	});

	it('rejects non-integer register sizes', () => {
		expect(() => build({ numQubits: 2.5, numClbits: 0, gates: {} })).toThrow(/Number of Qubits/);
		expect(() => build({ numQubits: 2, numClbits: 1.5, gates: {} })).toThrow(
			/Number of Classical Bits/,
		);
		expect(() => build({ numQubits: NaN, numClbits: 0, gates: {} })).toThrow(/Number of Qubits/);
	});

	it('rejects a negative classical register', () => {
		expect(() => build({ numQubits: 2, numClbits: -1, gates: {} })).toThrow(
			/Number of Classical Bits/,
		);
	});
});

describe('handleCircuitBuild validation errors (TEST-07)', () => {
	it('indexes a validation failure by gate position', () => {
		expect(() =>
			build({
				numQubits: 2,
				numClbits: 0,
				gates: {
					gate: [
						{ gate: 'h', qubits: '0', params: '' },
						{ gate: 'cx', qubits: '0', params: '' },
					],
				},
			}),
		).toThrow(/Gate #2/);
	});

	it('indexes a parse failure by gate position and names the gate', () => {
		expect(() =>
			build({
				numQubits: 2,
				numClbits: 0,
				gates: { gate: [{ gate: 'h', qubits: '0,foo', params: '' }] },
			}),
		).toThrow(/Gate #1 \(h\):/);
	});

	it('survives a gate list that an expression replaced with something else', () => {
		for (const gate of ['h', { gate: 'h' }, 7, true]) {
			const result = build({ numQubits: 2, numClbits: 0, gates: { gate } });
			expect(result.gateCount).toBe(0);
			expect(result.qasm3).not.toContain('h q[0];');
		}
	});

	it('refuses a null entry by its gate number instead of throwing on it', () => {
		expect(() =>
			build({
				numQubits: 2,
				numClbits: 0,
				gates: { gate: [{ gate: 'h', qubits: '0', params: '' }, null] },
			}),
		).toThrow(/Gate #2: Unsupported gate/);
	});
});

describe('handleCircuitImport OPENQASM 3 header (TEST-07)', () => {
	const importQasm = (qasm3Input: string) => {
		const { ctx } = makeExecuteContext({ params: { qasm3Input } });
		return () => handleCircuitImport.call(ctx, 0);
	};

	it('accepts a real OpenQASM 3 version header', () => {
		expect(importQasm('OPENQASM 3.0;\nqubit[1] q;')()).toEqual({
			qasm3: 'OPENQASM 3.0;\nqubit[1] q;',
		});
		expect(importQasm('OPENQASM 3;')()).toEqual({ qasm3: 'OPENQASM 3;' });
	});

	it('rejects OpenQASM 2, mid-text matches and empty input', () => {
		expect(importQasm('OPENQASM 2.0;\nqreg q[1];')).toThrow(/OpenQASM 3 version header/);
		expect(importQasm('// OPENQASM 3.0; appears in a comment\nfoo')).toThrow(
			/OpenQASM 3 version header/,
		);
		expect(importQasm('')).toThrow(/OpenQASM 3 version header/);
	});
});

describe('handleCircuitBuild with rzz, delay and circuit parameters', () => {
	it('builds an rzz circuit that carries the definition block exactly once', () => {
		const result = build({
			numQubits: 3,
			numClbits: 1,
			gates: {
				gate: [
					{ gate: 'rzz', qubits: '0,1', params: '0.5' },
					{ gate: 'rzz', qubits: '1,2', params: '0.25' },
					{ gate: 'measure', qubits: '0', params: '', clbit: 0 },
				],
			},
		});
		const lines = (result.qasm3 as string).split('\n');
		expect(lines).toContain('rzz(0.5) q[0], q[1];');
		expect(lines).toContain('rzz(0.25) q[1], q[2];');
		expect(lines.filter((line) => line.startsWith('gate rzz'))).toHaveLength(1);
		expect(result.gateCount).toBe(3);
		expect(result.instructionCount).toBe(3);
		expect(result).not.toHaveProperty('parameterNames');
	});

	it('reads the Duration field for delay and reports a bad one by gate position', () => {
		const result = build({
			numQubits: 1,
			numClbits: 0,
			gates: { gate: [{ gate: 'delay', qubits: '0', duration: '100ns' }] },
		});
		expect((result.qasm3 as string).split('\n')).toContain('delay[100ns] q[0];');
		expect(result.instructionCount).toBe(1);

		expect(() =>
			build({
				numQubits: 1,
				numClbits: 0,
				gates: { gate: [{ gate: 'delay', qubits: '0', duration: '12.5dt' }] },
			}),
		).toThrow(/Gate #1: delay Duration "12.5dt" must be a whole number of dt/);
		expect(() =>
			build({ numQubits: 1, numClbits: 0, gates: { gate: [{ gate: 'delay', qubits: '0' }] } }),
		).toThrow(/Gate #1: delay needs a Duration/);
		expect(() =>
			build({
				numQubits: 1,
				numClbits: 0,
				gates: { gate: [{ gate: 'delay', qubits: '0', duration: 100 }] },
			}),
		).toThrow(/is not a number followed by/);
	});

	it('declares circuit parameters, accepts them as angles and reports parameterNames', () => {
		const result = build({
			numQubits: 2,
			numClbits: 0,
			circuitParameters: 'theta, phi',
			gates: {
				gate: [
					{ gate: 'rx', qubits: '0', params: 'theta' },
					{ gate: 'rzz', qubits: '0,1', params: 'phi' },
					{ gate: 'u', qubits: '1', params: 'theta,0,phi' },
				],
			},
		});
		const lines = (result.qasm3 as string).split('\n');
		expect(lines).toContain('input float[64] theta;');
		expect(lines).toContain('input float[64] phi;');
		expect(lines).toContain('rx(theta) q[0];');
		expect(lines).toContain('rzz(phi) q[0], q[1];');
		expect(lines).toContain('U(theta, 0, phi) q[1];');
		expect(result.parameterNames).toEqual(['theta', 'phi']);
		// The declarations sit after the rzz block and before the quantum register.
		expect(lines.indexOf('input float[64] theta;')).toBeGreaterThan(lines.indexOf('}'));
		expect(lines.indexOf('input float[64] theta;')).toBeLessThan(lines.indexOf('qubit[2] q;'));
	});

	it('rejects an undeclared name in Parameters by gate position', () => {
		expect(() =>
			build({
				numQubits: 1,
				numClbits: 0,
				circuitParameters: 'theta',
				gates: { gate: [{ gate: 'rx', qubits: '0', params: 'alpha' }] },
			}),
		).toThrow(
			/Gate #1 \(rx\): Parameters: "alpha" is not a valid number or a name listed in "Circuit Parameters"/,
		);
	});

	it('rejects a reserved or duplicated circuit parameter without a gate prefix', () => {
		const failWith = (circuitParameters: unknown) => {
			try {
				build({ numQubits: 1, numClbits: 0, circuitParameters, gates: {} });
			} catch (error) {
				return (error as Error).message;
			}
			return '';
		};
		expect(failWith('rz')).toMatch(/^Circuit Parameters: "rz" is reserved/);
		expect(failWith('theta,theta')).toMatch(/listed more than once/);
		expect(failWith('2theta')).toMatch(/not a valid OpenQASM 3 identifier/);
	});

	it('accepts an array or a lone name for Circuit Parameters through an expression, and treats an object as none', () => {
		const withParams = (circuitParameters: unknown) =>
			build({ numQubits: 1, numClbits: 0, circuitParameters, gates: {} });

		expect(withParams(['theta', 'phi']).parameterNames).toEqual(['theta', 'phi']);
		expect(withParams('theta').parameterNames).toEqual(['theta']);
		for (const value of [{}, null]) {
			const result = withParams(value);
			expect(result).not.toHaveProperty('parameterNames');
			expect(result.qasm3).not.toContain('input float[64]');
		}
		const absent = build({ numQubits: 1, numClbits: 0, gates: {} });
		expect(absent).not.toHaveProperty('parameterNames');
		expect(absent.qasm3).not.toContain('input float[64]');
	});
});
