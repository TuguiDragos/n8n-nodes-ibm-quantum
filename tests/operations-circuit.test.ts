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
	});
});

describe('handleCircuitBuild validation errors (TEST-07)', () => {
	it('indexes a validation failure by gate position', () => {
		expect(() =>
			build({
				numQubits: 2,
				numClbits: 0,
				gates: { gate: [{ gate: 'h', qubits: '0', params: '' }, { gate: 'cx', qubits: '0', params: '' }] },
			}),
		).toThrow(/Gate #2/);
	});

	it('indexes a parse failure by gate position and names the gate', () => {
		expect(() =>
			build({ numQubits: 2, numClbits: 0, gates: { gate: [{ gate: 'h', qubits: '0,foo', params: '' }] } }),
		).toThrow(/Gate #1 \(h\):/);
	});
});

describe('handleCircuitImport OPENQASM 3 header (TEST-07)', () => {
	const importQasm = (qasm3Input: string) => {
		const { ctx } = makeExecuteContext({ params: { qasm3Input } });
		return () => handleCircuitImport.call(ctx, 0);
	};

	it('accepts a real OpenQASM 3 version header', () => {
		expect(importQasm('OPENQASM 3.0;\nqubit[1] q;')()).toEqual({ qasm3: 'OPENQASM 3.0;\nqubit[1] q;' });
		expect(importQasm('OPENQASM 3;')()).toEqual({ qasm3: 'OPENQASM 3;' });
	});

	it('rejects OpenQASM 2, mid-text matches and empty input', () => {
		expect(importQasm('OPENQASM 2.0;\nqreg q[1];')).toThrow(/OpenQASM 3 version header/);
		expect(importQasm('// OPENQASM 3.0; appears in a comment\nfoo')).toThrow(/OpenQASM 3 version header/);
		expect(importQasm('')).toThrow(/OpenQASM 3 version header/);
	});
});
