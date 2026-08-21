import { describe, expect, it } from 'vitest';

import { handleJob, nonIsaInstructions } from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX } from './fakeContext';

// Qiskit Runtime does not transpile. Every IBM device reports the same basis today
// (cz, id, rx, rz, rzz, sx, x), read live from ibm_kingston, ibm_fez and ibm_marrakesh, plus
// measure, reset, delay and barrier among its supported instructions. A circuit using anything
// else is accepted, queued, and only then fails, so the node says so at submit time.
const HEAD = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\n';

describe('nonIsaInstructions', () => {
	it('accepts every basis gate and supported instruction', () => {
		expect(
			nonIsaInstructions(
				`${HEAD}x q[0];\nrx(0.5) q[0];\nrz(0.5) q[0];\nsx q[0];\nid q[1];\ncz q[0], q[1];\nrzz(0.5) q[0], q[1];`,
			),
		).toEqual([]);
	});

	it('ignores structural instructions and the declarations', () => {
		expect(
			nonIsaInstructions(`${HEAD}barrier q[0], q[1];\nreset q[0];\ndelay[100ns] q[0];`),
		).toEqual([]);
	});

	it('reads the instruction out of a measure assignment', () => {
		expect(nonIsaInstructions(`${HEAD}c[0] = measure q[0];`)).toEqual([]);
	});

	// Qiskit's exporter writes a definition block for anything outside stdgates, so a fully ISA
	// circuit using rzz arrives with `gate rzz(p0) a, b { cx a, b; rz(p0) b; cx a, b; }` in front of
	// it. Reading those body lines reported "gate, cx" about a correct circuit.
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

	it('warns on the estimator path too', async () => {
		const { out } = await submit('submitEstimator', {
			qasm3: `${HEAD}h q[0];`,
			observables: '"ZZ"',
			resilienceLevel: 1,
			precision: 0,
		});
		expect(out.warnings).toBeTruthy();
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
