import { describe, expect, it } from 'vitest';

import {
	handleJob,
	noiseLearnerWarnings,
	nonIsaInstructions,
	twoQubitStatements,
} from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX } from './fakeContext';

// Qiskit Runtime does not transpile. Every IBM device reports the same basis today
// (cz, id, rx, rz, rzz, sx, x), read live from ibm_kingston, ibm_fez and ibm_marrakesh, plus
// measure, reset, delay and barrier among its supported instructions. A circuit using anything
// else is accepted, queued, and only then fails, so the node says so at submit time.
// rzz is in that basis and stays in it, measured on ibm_fez: the Qiskit export, which carries a
// `gate rzz` block ahead of the call, completed and returned 64/64 shots on `00`. The bare call
// with no definition is what fails, with reason_code 1603, so that case belongs to
// undefinedGateWarnings and not to this scan.
const HEAD = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\n';

describe('nonIsaInstructions', () => {
	it('accepts every basis gate and supported instruction', () => {
		expect(
			nonIsaInstructions(
				`${HEAD}x q[0];\nrx(0.5) q[0];\nrz(0.5) q[0];\nsx q[0];\nid q[1];\ncz q[0], q[1];\nrzz(0.5) q[0], q[1];`,
			),
		).toEqual([]);
	});

	// Pinned against a plausible-looking regression: rzz calls do fail when they arrive bare, so it
	// is tempting to drop it from the basis. Job da4tpje1vhnc73fle760 on ibm_fez completed with a
	// transpiled circuit using it, so removing it would warn about a circuit that demonstrably runs.
	it('keeps rzz in the basis, which a live job confirmed', () => {
		expect(nonIsaInstructions(`${HEAD}rzz(0.5) q[0], q[1];`)).toEqual([]);
	});

	// sx is in the Heron basis and was verified live, so a circuit built from the palette using it
	// must not be told to transpile.
	it('accepts sx, which the palette now offers', () => {
		expect(nonIsaInstructions(`${HEAD}sx q[0];\nsx q[0];`)).toEqual([]);
	});

	it('ignores structural instructions and the declarations', () => {
		expect(
			nonIsaInstructions(`${HEAD}barrier q[0], q[1];\nreset q[0];\ndelay[100ns] q[0];`),
		).toEqual([]);
	});

	it('reads the instruction out of a measure assignment', () => {
		expect(nonIsaInstructions(`${HEAD}c[0] = measure q[0];`)).toEqual([]);
	});

	// Qiskit's exporter writes a definition block for anything outside stdgates, so a circuit using
	// rzz arrives with `gate rzz(p0) a, b { cx a, b; rz(p0) b; cx a, b; }` in front of it. Reading
	// those body lines reported "gate, cx" about the definition rather than the one instruction the
	// program actually issues.
	it('ignores a gate definition block, which is not what the device runs', () => {
		const withDefinition = `OPENQASM 3.0;
include "stdgates.inc";
gate rzz(p0) _gate_q_0, _gate_q_1 {
  cx _gate_q_0, _gate_q_1;
  rz(p0) _gate_q_1;
  cx _gate_q_0, _gate_q_1;
}
bit[2] c;
qubit[2] q;
rzz(0.5) q[0], q[1];
c[0] = measure q[0];`;
		expect(nonIsaInstructions(withDefinition)).toEqual([]);
	});

	it('still sees a real instruction that follows a definition block', () => {
		expect(nonIsaInstructions(`${HEAD}gate foo a { x a; }\nh q[0];`)).toEqual(['h']);
	});

	it('handles nested braces inside a definition', () => {
		expect(nonIsaInstructions(`${HEAD}gate foo a { if (true) { x a; } }\ncx q[0], q[1];`)).toEqual([
			'cx',
		]);
	});

	// A stray closing brace must not push the depth negative and start skipping real instructions.
	it('recovers from an unbalanced closing brace', () => {
		expect(nonIsaInstructions(`${HEAD}}\nh q[0];`)).toEqual(['h']);
	});

	it('ignores the other block-opening declarations too', () => {
		expect(nonIsaInstructions(`${HEAD}def thing() { h q[0]; }\nx q[0];`)).toEqual([]);
	});

	it('flags the textbook gates that need transpiling', () => {
		expect(nonIsaInstructions(`${HEAD}h q[0];\ncx q[0], q[1];`)).toEqual(['h', 'cx']);
		expect(nonIsaInstructions(`${HEAD}swap q[0], q[1];`)).toEqual(['swap']);
		expect(nonIsaInstructions(`${HEAD}U(0.1, 0.2, 0.3) q[0];`)).toEqual(['U']);
	});

	it('reports each instruction once, in the order it first appears', () => {
		expect(nonIsaInstructions(`${HEAD}cx q[0], q[1];\nh q[0];\ncx q[1], q[0];`)).toEqual([
			'cx',
			'h',
		]);
	});

	it('skips comments and blank lines', () => {
		expect(nonIsaInstructions(`${HEAD}// h q[0];\n\n   \nx q[0];`)).toEqual([]);
	});
});

describe('the submit operations warn without blocking', () => {
	const submit = async (operation: string, params: Record<string, unknown>) => {
		const warned: string[] = [];
		const { ctx } = makeExecuteContext({
			params: { backend: 'ibm_kingston', circuitFormat: 'qasm3', ...params },
			http: () => ({ id: 'job-x' }),
		});
		(ctx as unknown as { logger: { warn: (m: string) => void } }).logger = {
			warn: (m: string) => warned.push(m),
		};
		const out = (await handleJob.call(ctx, TEST_CTX, operation, 0)) as Record<string, unknown>;
		return { out, warned };
	};

	it('attaches a warning and still submits a non-ISA sampler job', async () => {
		const { out, warned } = await submit('submitSampler', {
			qasm3: `${HEAD}h q[0];\ncx q[0], q[1];`,
			shots: 100,
		});
		expect(out.jobId).toBe('job-x');
		expect((out.warnings as string[])[0]).toContain('h, cx');
		expect((out.warnings as string[])[0]).toContain('does not transpile');
		expect((out.warnings as string[])[0]).toContain('ibm_kingston');
		expect(warned).toHaveLength(1);
	});

	it('adds no warnings key at all for an ISA circuit', async () => {
		const { out, warned } = await submit('submitSampler', {
			qasm3: `${HEAD}x q[0];\ncz q[0], q[1];`,
			shots: 100,
		});
		expect(out).not.toHaveProperty('warnings');
		expect(warned).toHaveLength(0);
	});

	it('uses singular wording for a single instruction', async () => {
		const { out } = await submit('submitSampler', { qasm3: `${HEAD}h q[0];`, shots: 100 });
		expect((out.warnings as string[])[0]).toContain('which is not in the IBM basis');
	});

	// Job da4tp43otlns739b97qg on ibm_fez: this exact circuit came back Failed with reason_code 1603,
	// `gate 'rzz' is not defined`. The ISA scan cannot catch it, since rzz is genuinely in the basis.
	it('warns when rzz is called with no definition, which IBM rejects', async () => {
		const { out, warned } = await submit('submitSampler', {
			qasm3: `${HEAD}rzz(0.5) q[0], q[1];`,
			shots: 100,
		});
		expect(out.jobId).toBe('job-x');
		const warnings = out.warnings as string[];
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('does not define it');
		expect(warned).toHaveLength(1);
	});

	// The other half of the same pair, job da4tpje1vhnc73fle760, which completed. Warning here would
	// tell someone their working circuit is broken.
	it('stays silent when the Qiskit definition block is present', async () => {
		const { out, warned } = await submit('submitSampler', {
			qasm3: `${HEAD}gate rzz(p0) a, b {\n  cx a, b;\n  rz(p0) b;\n  cx a, b;\n}\nrzz(0.5) q[0], q[1];`,
			shots: 100,
		});
		expect(out).not.toHaveProperty('warnings');
		expect(warned).toHaveLength(0);
	});

	it('warns on the estimator path too', async () => {
		const { out } = await submit('submitEstimator', {
			qasm3: `${HEAD}h q[0];`,
			observables: '"ZZ"',
			resilienceLevel: 1,
			precision: 0,
		});
		expect(out.warnings).toBeTruthy();
	});

	// The circuit is fully ISA, so the only warning it can carry is the classical-register one.
	it('warns about the classical register on a noise learner submit', async () => {
		const { out } = await submit('submitNoiseLearner', {
			qasm3: `${HEAD}cz q[0], q[1];\ncz q[1], q[2];`,
			noiseLearnerOptions: {},
		});
		expect(out.warnings).toEqual([expect.stringMatching(/Number of Classical Bits/)]);
	});

	it('warns on the noise learner path too', async () => {
		const { out } = await submit('submitNoiseLearner', {
			qasm3: `${HEAD}swap q[0], q[1];`,
			noiseLearnerOptions: {},
		});
		expect(out.warnings).toBeTruthy();
	});

	// QPY is zlib-compressed base64, so there is nothing to read without decompressing it.
	it('stays silent for a QPY circuit rather than guessing', async () => {
		const { out, warned } = await submit('submitSampler', {
			circuitFormat: 'qpy',
			qpyCircuit: 'eJwL9Az2dAn2dAYAC9gCVQ==',
			shots: 100,
		});
		expect(out).not.toHaveProperty('warnings');
		expect(warned).toHaveLength(0);
	});
});

// Measured on ibm_fez: a three-qubit circuit with cz(0,1) and cz(1,2) FAILS with "ClassicalRegister
// with name 'c' appears in multiple layers with different sizes (3 != 2)" when the builder's default
// two classical bits are left in place, and COMPLETES with two learned layers when they are set to
// zero. The register is what breaks it, and the default is what puts it there.
describe('noiseLearnerWarnings', () => {
	const NO_CLBITS = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[3] q;\n';

	// Two entangling gates plus a register is the shape that failed on ibm_fez.
	it('warns when a multi-layer circuit carries a classical register', () => {
		const warnings = noiseLearnerWarnings('qasm3', `${HEAD}cz q[0], q[1];\ncz q[1], q[2];`);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/Number of Classical Bits/);
	});

	it('stays silent when there is no register', () => {
		expect(noiseLearnerWarnings('qasm3', `${NO_CLBITS}cz q[0], q[1];\ncz q[1], q[2];`)).toEqual([]);
	});

	// One entangling gate cannot produce a second layer, so the register is harmless and warning
	// about it would be noise on every single-layer circuit anyone submits.
	it('stays silent below two entangling gates, register or not', () => {
		expect(noiseLearnerWarnings('qasm3', `${HEAD}cz q[0], q[1];`)).toEqual([]);
		expect(noiseLearnerWarnings('qasm3', `${HEAD}x q[0];`)).toEqual([]);
	});

	describe('twoQubitStatements', () => {
		it('counts statements acting on two or more distinct qubits', () => {
			expect(twoQubitStatements(`${HEAD}x q[0];`)).toBe(0);
			expect(twoQubitStatements(`${HEAD}cz q[0], q[1];`)).toBe(1);
			expect(twoQubitStatements(`${HEAD}cz q[0], q[1];\ncz q[1], q[2];`)).toBe(2);
			expect(twoQubitStatements(`${HEAD}ccx q[0], q[1], q[2];`)).toBe(1);
		});

		// barrier spans qubits without entangling them, so it is not a layer.
		it('ignores barrier and the declarations', () => {
			expect(twoQubitStatements(`${HEAD}barrier q[0], q[1], q[2];`)).toBe(0);
			expect(twoQubitStatements(HEAD)).toBe(0);
		});

		// A repeated index is one qubit, and the builder refuses it anyway.
		it('counts distinct operands, not occurrences', () => {
			expect(twoQubitStatements(`${HEAD}cz q[0], q[0];`)).toBe(0);
		});

		// A stray closing brace would drive the depth below zero and make every later line read as
		// though it were inside a block, so the counter would silently return zero.
		it('recovers from an unbalanced closing brace', () => {
			expect(twoQubitStatements(`${HEAD}}\ncz q[0], q[1];\ncz q[1], q[2];`)).toBe(2);
		});

		// A statement naming no qubit at all must count as zero rather than throw.
		it('handles a statement with no qubit operands', () => {
			expect(twoQubitStatements(`${HEAD}delay[100ns];\ncz q[0], q[1];`)).toBe(1);
		});

		// Same reasoning as the ISA scan: a gate definition body is not what the device runs.
		it('does not count a gate definition block', () => {
			const withBlock = `OPENQASM 3.0;\ngate rzz(p0) a, b {\n  cx a, b;\n  cz q[0], q[1];\n}\nqubit[2] q;\nx q[0];`;
			expect(twoQubitStatements(withBlock)).toBe(0);
		});
	});

	// `qubit[2] q;` contains the substring `bit[2]`, so the check has to be anchored or every
	// circuit ever written would warn.
	it('does not mistake the quantum register for a classical one', () => {
		expect(noiseLearnerWarnings('qasm3', 'OPENQASM 3.0;\nqubit[2] q;\n')).toEqual([]);
		expect(noiseLearnerWarnings('qasm3', 'qubit[2] q;')).toEqual([]);
	});

	// Same reasoning as the ISA check: a QPY blob cannot be read without Qiskit.
	it('stays silent for QPY', () => {
		expect(noiseLearnerWarnings('qpy', `${HEAD}cz q[0], q[1];`)).toEqual([]);
	});
});
