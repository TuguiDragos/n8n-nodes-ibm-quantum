import { describe, expect, it } from 'vitest';

import {
	handleCircuitBuild,
	handleJob,
	identityGateWarnings,
	noiseLearnerWarnings,
	nonIsaInstructions,
	readBasisGates,
	readSupportedInstructions,
	twoQubitStatements,
	undefinedGateWarnings,
	rzzAngle,
	rzzAngleWarnings,
	fractionalTwirlWarnings,
	twirlingSource,
} from '../nodes/IbmQuantum/operations';
import { makeExecuteContext, TEST_CTX, type HttpCall } from './fakeContext';

// Qiskit Runtime does not transpile. The Heron devices (ibm_kingston, ibm_fez, ibm_marrakesh, read
// live) report cz, id, rx, rz, rzz, sx, x, plus measure, reset, delay and barrier among their
// supported instructions; Nighthawk r1 reports cz, id, rz, sx, x. The submit reads the chosen
// backend's basis_gates and falls back to the Heron union when it cannot. A circuit using anything
// else is accepted, queued, and only then fails, so the node says so at submit time.
// rzz is in that basis and stays in it, measured on ibm_fez: the Qiskit export, which carries a
// `gate rzz` block ahead of the call, completed and returned 64/64 shots on `00`. The bare call
// with no definition is what fails, with reason_code 1603, so that case belongs to
// undefinedGateWarnings and not to this scan.
// id is in the basis too and stays there: a bare id fails for a different reason, the stdgates
// definition, so that case belongs to identityGateWarnings.
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

	// Both forms the palette gained in 0.6.0: a delay counted in the backend sample time, and the
	// symbolic-angle declaration that carries a circuit parameter.
	it('accepts a delay in dt and skips an input declaration', () => {
		expect(
			nonIsaInstructions(`${HEAD}input float[64] theta;\ndelay[160dt] q[0];\nrx(theta) q[0];`),
		).toEqual([]);
	});
});

describe('readBasisGates', () => {
	it('returns the list IBM sends, in its order', () => {
		expect(readBasisGates({ basis_gates: ['cz', 'id', 'rz', 'sx', 'x'] })).toEqual([
			'cz',
			'id',
			'rz',
			'sx',
			'x',
		]);
	});

	it('drops entries that are not gate names and deduplicates', () => {
		expect(readBasisGates({ basis_gates: ['cz', 7, ' rz ', '', 'cz', null] })).toEqual([
			'cz',
			'rz',
		]);
	});

	it.each([
		[null],
		['nope'],
		[[]],
		[{}],
		[{ basis_gates: 'cz' }],
		[{ basis_gates: [] }],
		[{ basis_gates: [1, 2] }],
	])('returns null for an unusable configuration: %s', (config) => {
		expect(readBasisGates(config)).toBeNull();
	});
});

// IBM lists measure_2, if_else, store and the like here, and a Heron device with fractional gates
// off may list rx and rzz only here, so the check allows the list beside basis_gates.
describe('readSupportedInstructions', () => {
	it('returns the list IBM sends, cleaned the same way as the basis', () => {
		expect(
			readSupportedInstructions({
				supported_instructions: ['rx', ' rzz ', 'measure_2', 7, '', 'rx', null],
			}),
		).toEqual(['rx', 'rzz', 'measure_2']);
	});

	it.each([
		[null],
		['nope'],
		[{}],
		[{ supported_instructions: 'rx' }],
		[{ supported_instructions: [] }],
	])('returns an empty list when nothing usable is listed: %s', (config) => {
		expect(readSupportedInstructions(config)).toEqual([]);
	});
});

describe('nonIsaInstructions with a backend set', () => {
	it('judges against the set it is given', () => {
		expect(
			nonIsaInstructions(`${HEAD}x q[0];\nrx(0.5) q[0];\ncz q[0], q[1];`, new Set(['x', 'cz'])),
		).toEqual(['rx']);
		expect(nonIsaInstructions(`${HEAD}rx(0.5) q[0];`)).toEqual([]);
	});
});

describe('undefinedGateWarnings covers every basis gate stdgates.inc lacks', () => {
	// IBM added xslow to basis_gates on all three Heron devices on 2026-09-10. Measured on
	// ibm_kingston: a bare `xslow $0;` is accepted, queued, and fails with code 1603 naming
	// `gate 'xslow' is not defined`, and the node had warned about nothing, since xslow is in the
	// basis and the definition check was written for rzz alone.
	const HERON = ['cz', 'id', 'rx', 'rz', 'rzz', 'sx', 'x', 'xslow'];

	it('warns about a bare xslow call when the backend lists it', () => {
		const warnings = undefinedGateWarnings('qasm3', `${HEAD}xslow $0;`, 'ibm_kingston', HERON);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("gate 'xslow' is not defined");
		expect(warnings[0]).toContain('ibm_kingston basis');
		expect(warnings[0]).toContain('Include a gate xslow definition block');
	});

	it('stays silent on xslow when the circuit defines it', () => {
		const source = `${HEAD}gate xslow a { x a; }\nxslow $0;`;
		expect(undefinedGateWarnings('qasm3', source, 'ibm_kingston', HERON)).toEqual([]);
	});

	it('leaves xslow to the ISA warning when the backend does not list it', () => {
		const older = ['cz', 'id', 'rx', 'rz', 'rzz', 'sx', 'x'];
		expect(undefinedGateWarnings('qasm3', `${HEAD}xslow $0;`, 'ibm_fez', older)).toEqual([]);
	});

	it('reports each undefined basis gate the circuit calls, once each', () => {
		const source = `${HEAD}rzz(0.5) $0, $1;\nxslow $0;\nxslow $1;`;
		const warnings = undefinedGateWarnings('qasm3', source, 'ibm_kingston', HERON);
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain("gate 'rzz' is not defined");
		expect(warnings[1]).toContain("gate 'xslow' is not defined");
	});

	it('keeps the rzz wording and the Heron basis name on the fallback basis', () => {
		const [warning] = undefinedGateWarnings('qasm3', `${HEAD}rzz(0.5) q[0], q[1];`);
		expect(warning).toBe(
			"Circuit calls rzz but does not define it. rzz is in the Heron basis, yet stdgates.inc has no definition for it, so IBM fails the job with \"gate 'rzz' is not defined\". Include the gate rzz block that Qiskit's exporter writes, or express the interaction with cz and rz.",
		);
	});

	it('ignores a basis entry that is not an identifier and every gate stdgates.inc defines', () => {
		const odd = ['cz', 'x', 'measure_2', 'if-else', '2q', 'xslow'];
		const source = `${HEAD}cz $0, $1;\nx $0;\nxslow $0;`;
		const warnings = undefinedGateWarnings('qasm3', source, 'ibm_kingston', odd);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('xslow');
	});

	it('does not read a gate name as a prefix of a longer one', () => {
		expect(undefinedGateWarnings('qasm3', `${HEAD}xslower $0;`, 'ibm_kingston', HERON)).toEqual([]);
	});

	it('stays linear on a run of blank lines with several names to check', () => {
		const started = Date.now();
		expect(
			undefinedGateWarnings('qasm3', HEAD + '\n'.repeat(160_000), 'ibm_kingston', HERON),
		).toEqual([]);
		expect(Date.now() - started).toBeLessThan(500);
	});
});

describe('undefinedGateWarnings', () => {
	// Both patterns start their run at a line start and stop at the next line terminator, so a call
	// is found from its own line and from nowhere else. Every form here was already matched by the
	// `^\s*` shape they replaced, and every silent form was already silent.
	it('reads the call and the definition through any indentation and any line ending', () => {
		expect(undefinedGateWarnings('qasm3', `${HEAD}   rzz(0.5) q[0], q[1];`)).toHaveLength(1);
		expect(undefinedGateWarnings('qasm3', `${HEAD}\trzz(0.5) q[0], q[1];`)).toHaveLength(1);
		expect(undefinedGateWarnings('qasm3', `${HEAD}\n\n\nrzz(0.5) q[0], q[1];`)).toHaveLength(1);
		expect(undefinedGateWarnings('qasm3', `${HEAD}rzz(0.5) q[0], q[1];\r\n`)).toHaveLength(1);
		expect(undefinedGateWarnings('qasm3', `\ufeff${HEAD}rzz(0.5) q[0], q[1];`)).toHaveLength(1);
		expect(undefinedGateWarnings('qasm3', 'OPENQASM 3.0;\rrzz(0.5) q[0], q[1];\r')).toHaveLength(1);
		expect(
			undefinedGateWarnings(
				'qasm3',
				`${HEAD}  gate rzz(p0) a, b { cx a, b; }\n rzz(0.5) q[0], q[1];`,
			),
		).toEqual([]);
		expect(undefinedGateWarnings('qasm3', `${HEAD}x q[0]; rzz(0.5) q[0], q[1];`)).toEqual([]);
	});

	// 40k blank lines took 1.7 seconds with `^\s*` under /m, and every doubling cost four times as
	// much: the run crossed line starts, so each of them was another place to scan the flood from.
	it('scans a flood of blank lines promptly instead of backtracking', () => {
		const started = Date.now();
		expect(undefinedGateWarnings('qasm3', HEAD + '\n'.repeat(160_000))).toEqual([]);
		expect(undefinedGateWarnings('qasm3', HEAD + ' \n'.repeat(80_000))).toEqual([]);
		expect(undefinedGateWarnings('qasm3', HEAD + '\r\n'.repeat(80_000))).toEqual([]);
		expect(Date.now() - started).toBeLessThan(1000);
	});
});

describe('identityGateWarnings', () => {
	it('warns on id in every operand form', () => {
		for (const call of ['id q[0];', 'id $0;', 'id qr[3];', 'id q;']) {
			const warnings = identityGateWarnings('qasm3', `${HEAD}${call}`);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('U(0, 0, 0)');
			expect(warnings[0]).toContain('the instruction u on qubits (n,) is not supported');
			expect(warnings[0]).toContain('Circuit Build drops it');
		}
	});

	it('stays silent for a circuit that never calls id', () => {
		expect(identityGateWarnings('qasm3', `${HEAD}x q[0];\ncz q[0], q[1];\nsx q[1];`)).toEqual([]);
	});

	it('does not match identifiers that merely start with id, or a commented call', () => {
		expect(identityGateWarnings('qasm3', `${HEAD}idle q[0];`)).toEqual([]);
		expect(identityGateWarnings('qasm3', `${HEAD}id_x q[0];`)).toEqual([]);
		expect(identityGateWarnings('qasm3', `${HEAD}// id q[0];\nx q[0];`)).toEqual([]);
	});

	it('stays silent for QPY, which cannot be read', () => {
		expect(identityGateWarnings('qpy', `${HEAD}id q[0];`)).toEqual([]);
	});

	// 160k newlines took 14 seconds with ^\s* under /m, the shape the header check moved off.
	it('scans a flood of blank lines promptly instead of backtracking', () => {
		const started = Date.now();
		expect(identityGateWarnings('qasm3', HEAD + '\n'.repeat(160_000))).toEqual([]);
		expect(Date.now() - started).toBeLessThan(1000);
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
	// `gate 'rzz' is not defined`. The ISA scan cannot catch it on the fallback path used here, since
	// rzz is genuinely in the Heron basis.
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

	it('warns about id on a sampler submit and still sends the job', async () => {
		const { out, warned } = await submit('submitSampler', {
			qasm3: `${HEAD}id q[0];`,
			shots: 100,
		});
		expect(out.jobId).toBe('job-x');
		expect(out.warnings).toEqual([expect.stringMatching(/^Circuit calls id\./)]);
		expect(warned).toHaveLength(1);
	});

	// No two-qubit statement, so the noise learner register warning stays out and the list holds
	// exactly the id entry.
	it('warns about id on the estimator and noise learner paths too', async () => {
		const estimator = await submit('submitEstimator', {
			qasm3: `${HEAD}id q[0];`,
			observables: '"ZZ"',
			resilienceLevel: 1,
			precision: 0,
		});
		expect(estimator.out.warnings).toEqual([expect.stringMatching(/^Circuit calls id\./)]);
		const learner = await submit('submitNoiseLearner', {
			qasm3: `${HEAD}id q[0];`,
			noiseLearnerOptions: {},
		});
		expect(learner.out.warnings).toEqual([expect.stringMatching(/^Circuit calls id\./)]);
	});

	it('reports the id warning once for a list of circuits', async () => {
		const { out } = await submit('submitSampler', {
			qasm3: [`${HEAD}id q[0];`, `${HEAD}id q[1];`],
			shots: 100,
		});
		expect(out.warnings).toHaveLength(1);
	});

	// The palette writes the definition block itself, so the circuit it emits is the form that ran
	// and none of the three checks may object to it.
	it('stays silent for an rzz circuit built by the palette, which carries its own block', async () => {
		const { ctx } = makeExecuteContext({
			params: {
				numQubits: 2,
				numClbits: 1,
				gates: {
					gate: [
						{ gate: 'rzz', qubits: '0,1', params: '0.5' },
						{ gate: 'measure', qubits: '0', params: '', clbit: 0 },
					],
				},
			},
		});
		const built = handleCircuitBuild.call(ctx, 0) as Record<string, unknown>;
		const { out, warned } = await submit('submitSampler', {
			qasm3: built.qasm3 as string,
			shots: 100,
		});
		expect(out).not.toHaveProperty('warnings');
		expect(warned).toHaveLength(0);
		expect(out.jobId).toBe('job-x');
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

// The basis lists come from IBM's published fake-backend configurations: Nighthawk r1 (ibm_miami,
// ibm_berlin) has no rx and no rzz, Heron with fractional gates has both. A live Nighthawk
// configuration has not been read from this node.
describe("the ISA check uses the backend's own basis", () => {
	const NIGHTHAWK = { basis_gates: ['cz', 'id', 'rz', 'sx', 'x'] };
	const HERON = { basis_gates: ['cz', 'id', 'rx', 'rz', 'rzz', 'sx', 'x'] };
	const RX = `${HEAD}rx(0.3) q[0];`;
	const RX_ON_MIAMI =
		'Circuit uses rx, which is not in the ibm_miami basis (cz, id, rz, sx, x). Qiskit Runtime does not transpile, so this job will most likely fail. Transpile the circuit for ibm_miami before submitting.';
	const FALLBACK = 'which is not in the IBM basis (cz, id, rx, rz, rzz, sx, x)';

	// `config` is what the configuration GET answers with; an Error is thrown from it instead.
	const submitTo = async (operation: string, params: Record<string, unknown>, config: unknown) => {
		const warned: string[] = [];
		const { ctx, requests } = makeExecuteContext({
			params: { backend: 'ibm_miami', circuitFormat: 'qasm3', shots: 100, ...params },
			http: (call: HttpCall) => {
				if (!String(call.url).endsWith('/configuration')) return { id: 'job-x' };
				if (config instanceof Error) throw config;
				return config;
			},
		});
		(ctx as unknown as { logger: { warn: (m: string) => void } }).logger = {
			warn: (m: string) => warned.push(m),
		};
		const out = (await handleJob.call(ctx, TEST_CTX, operation, 0)) as Record<string, unknown>;
		return { out, warned, requests: requests as HttpCall[] };
	};

	it('names the backend basis and flags rx on a Nighthawk device', async () => {
		const { out, warned } = await submitTo('submitSampler', { qasm3: RX }, NIGHTHAWK);
		expect(out.warnings).toHaveLength(1);
		expect((out.warnings as string[])[0]).toBe(RX_ON_MIAMI);
		expect(out.jobId).toBe('job-x');
		expect(warned).toHaveLength(1);
	});

	// The definition block keeps undefinedGateWarnings quiet, and the ISA check, not the definition,
	// is what says the device cannot run it.
	it('flags rzz on a backend that does not list it, even with the Qiskit definition block', async () => {
		const { out } = await submitTo(
			'submitSampler',
			{
				qasm3: `${HEAD}gate rzz(p0) a, b {\n  cx a, b;\n  rz(p0) b;\n  cx a, b;\n}\nrzz(0.5) q[0], q[1];`,
			},
			NIGHTHAWK,
		);
		const warnings = out.warnings as string[];
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('rzz, which is not in the ibm_miami basis');
		expect(warnings[0]).not.toContain('does not define it');
	});

	it('accepts rx on a Heron device that lists it', async () => {
		const { out, warned } = await submitTo(
			'submitSampler',
			{ backend: 'ibm_fez', qasm3: RX },
			HERON,
		);
		expect(out).not.toHaveProperty('warnings');
		expect(warned).toHaveLength(0);
	});

	it('always allows measure, reset, delay and barrier on top of the basis', async () => {
		const { out } = await submitTo(
			'submitSampler',
			{
				qasm3: `${HEAD}barrier q[0], q[1];\nreset q[0];\ndelay[100ns] q[0];\nc[0] = measure q[0];`,
			},
			NIGHTHAWK,
		);
		expect(out).not.toHaveProperty('warnings');
	});

	it('allows what supported_instructions lists beside the basis, and still names the basis alone', async () => {
		const config = { ...NIGHTHAWK, supported_instructions: ['rx', 'rzz', 'measure_2', 'if_else'] };
		const clean = await submitTo('submitSampler', { qasm3: RX }, config);
		expect(clean.out).not.toHaveProperty('warnings');
		const flagged = await submitTo('submitSampler', { qasm3: `${HEAD}h q[0];` }, config);
		expect((flagged.out.warnings as string[])[0]).toContain(
			'h, which is not in the ibm_miami basis (cz, id, rz, sx, x)',
		);
	});

	// Without a usable basis_gates the configuration is not trusted for the check at all.
	it('ignores supported_instructions when basis_gates is unusable', async () => {
		const { out } = await submitTo(
			'submitSampler',
			{ qasm3: `${HEAD}h q[0];` },
			{ supported_instructions: ['h'] },
		);
		expect((out.warnings as string[])[0]).toContain(FALLBACK);
	});

	it('uses plural wording for several instructions', async () => {
		const { out } = await submitTo(
			'submitSampler',
			{ qasm3: `${HEAD}h q[0];\ncx q[0], q[1];` },
			NIGHTHAWK,
		);
		expect((out.warnings as string[])[0]).toContain('h, cx, which are not in the ibm_miami basis');
	});

	it('falls back to the Heron union, with the old wording, when basis_gates is missing', async () => {
		const flagged = await submitTo('submitSampler', { qasm3: `${HEAD}h q[0];` }, { n_qubits: 156 });
		expect((flagged.out.warnings as string[])[0]).toContain(FALLBACK);
		const clean = await submitTo('submitSampler', { qasm3: RX }, { n_qubits: 156 });
		expect(clean.out).not.toHaveProperty('warnings');
	});

	it('falls back when the configuration cannot be read at all', async () => {
		const { out, requests } = await submitTo(
			'submitSampler',
			{ qasm3: `${HEAD}h q[0];` },
			new Error('backend unreachable'),
		);
		expect((out.warnings as string[])[0]).toContain(FALLBACK);
		expect(out.jobId).toBe('job-x');
		expect(requests.some((call) => call.method === 'POST')).toBe(true);
	});

	// The transport turns a null body into {}, so null lands on the missing-basis path; a string
	// or an array is not an object at all and is discarded before any field is read.
	it.each([[null], [''], ['nope'], [[1, 2]]])(
		'falls back when the configuration is %s',
		async (config) => {
			const { out } = await submitTo('submitSampler', { qasm3: `${HEAD}h q[0];` }, config);
			expect((out.warnings as string[])[0]).toContain(FALLBACK);
			expect(out.jobId).toBe('job-x');
		},
	);

	it('applies the backend basis on the estimator path', async () => {
		const { out } = await submitTo(
			'submitEstimator',
			{ qasm3: RX, observables: '"ZZ"', resilienceLevel: 1, precision: 0 },
			NIGHTHAWK,
		);
		expect((out.warnings as string[])[0]).toContain('ibm_miami basis');
	});

	// No classical register, so the learner's own register warning stays out of the list.
	it('applies the backend basis on the noise learner path', async () => {
		const NO_REGISTER = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\n';
		const { out } = await submitTo(
			'submitNoiseLearner',
			{ qasm3: `${NO_REGISTER}rx(0.3) q[0];`, noiseLearnerOptions: {} },
			NIGHTHAWK,
		);
		// Two warnings now: rx is outside the Nighthawk basis, and it is a fractional gate on the
		// noise learner, which always twirls.
		expect(out.warnings).toEqual([
			expect.stringContaining('ibm_miami basis'),
			expect.stringContaining('gate twirling is on through the noise learner, which always twirls'),
		]);
	});

	it('reads the configuration once per submit, before the job, and shares it with the coupling check', async () => {
		const { out, requests } = await submitTo(
			'submitSampler',
			{ qasm3: `${HEAD}cz q[0], q[5];\nh q[0];` },
			{
				...NIGHTHAWK,
				coupling_map: [
					[0, 1],
					[1, 0],
				],
			},
		);
		const configCalls = requests.filter((call) => String(call.url).endsWith('/configuration'));
		expect(configCalls).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			method: 'GET',
			url: `${TEST_CTX.baseUrl}/backends/ibm_miami/configuration`,
		});
		expect(requests.filter((call) => call.method === 'POST')).toHaveLength(1);
		const warnings = out.warnings as string[];
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain('ibm_miami basis');
		expect(warnings[1]).toContain('qubits 0 and 5');
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

	// One entangling gate beside a barrier is one layer, whichever line the barrier shares.
	it('stays silent for one layer beside a barrier on the same line', () => {
		expect(noiseLearnerWarnings('qasm3', `${HEAD}cz q[0], q[1]; barrier q[0], q[1];`)).toEqual([]);
	});

	it('warns for the physical-qubit form as well', () => {
		expect(
			noiseLearnerWarnings(
				'qasm3',
				'OPENQASM 3.0;\ninclude "stdgates.inc";\nbit[3] c;\ncz $0, $1;\ncz $1, $2;',
			),
		).toHaveLength(1);
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

		// An input declaration names no qubit, and it is a declaration rather than a statement.
		it('ignores an input declaration', () => {
			expect(twoQubitStatements(`${HEAD}input float[64] theta;\nrzz(theta) q[0], q[1];`)).toBe(1);
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

		// Qiskit writes physical qubits for a transpiled circuit, and a register can carry any name.
		it('counts physical qubits and registers not named q', () => {
			expect(twoQubitStatements('OPENQASM 3.0;\nbit[3] c;\ncz $0, $1;\ncz $1, $2;')).toBe(2);
			expect(twoQubitStatements('OPENQASM 3.0;\nqubit[3] qr;\ncz qr[0], qr[1];')).toBe(1);
		});

		// IBM splits by statement, not by line, so two on one line are two layers, and a barrier
		// sharing the line is still not one.
		it('counts each statement on a shared line', () => {
			expect(twoQubitStatements(`${HEAD}cz q[0], q[1]; cz q[1], q[2];`)).toBe(2);
			expect(twoQubitStatements(`${HEAD}cz q[0], q[1]; barrier q[0], q[1];`)).toBe(1);
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

	// A file whose lines end with a bare carriage return declared its register where `(^|\n)` could
	// not see it, while the header check and the rzz and id scans beside it all read that same line.
	it('reads a classical register on a line ended with a carriage return', () => {
		expect(
			noiseLearnerWarnings('qasm3', 'OPENQASM 3.0;\rbit[3] c;\rcz $0, $1;\rcz $1, $2;\r'),
		).toHaveLength(1);
	});

	// 40k blank lines took 830 ms while the run was allowed to cross line starts. The second case
	// carries a register, so the flood reaches the statement scan behind the declaration test too.
	it('scans a flood of blank lines promptly instead of backtracking', () => {
		const started = Date.now();
		expect(noiseLearnerWarnings('qasm3', NO_CLBITS + '\n'.repeat(160_000))).toEqual([]);
		expect(noiseLearnerWarnings('qasm3', HEAD + ' \n'.repeat(80_000))).toEqual([]);
		expect(Date.now() - started).toBeLessThan(1000);
	});
});

describe('rzzAngleWarnings', () => {
	// Measured on ibm_marrakesh on 2026-09-10: a Grover circuit transpiled by Qiskit against a bare
	// basis_gates list carried rzz(-1.5707963267948966) and failed with code 1517, "supported only
	// for angles in the range [0, pi/2]", after the node had warned about nothing.
	it.each([
		['-1.5707963267948966'],
		['-0.7853981633974483'],
		['1.6'],
		['-pi/2'],
		['pi'],
		['3*pi/4'],
		['2 * pi'],
		['-0.1'],
	])('warns about rzz(%s)', (angle) => {
		const warnings = rzzAngleWarnings('qasm3', `${HEAD}rzz(${angle}) $0, $1;`);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain(`(${angle.trim()})`);
		expect(warnings[0]).toContain('supported only for angles in the range [0, pi/2]');
	});

	it.each([['0'], ['0.5'], ['1.5707963267948966'], ['pi/2'], ['pi/4'], ['0.25*pi'], ['+0.3']])(
		'accepts rzz(%s)',
		(angle) => {
			expect(rzzAngleWarnings('qasm3', `${HEAD}rzz(${angle}) $0, $1;`)).toEqual([]);
		},
	);

	it('leaves a parameter, an expression it cannot read, and a gate body alone', () => {
		const source = `${HEAD}input float[64] theta;\ngate rzz(p0) a, b { cx a, b; rz(p0) b; cx a, b; }\nrzz(theta) $0, $1;\nrzz(pi/2 + 0.1) $0, $1;\nrzz(2*theta) $0, $1;`;
		expect(rzzAngleWarnings('qasm3', source)).toEqual([]);
	});

	it('names each distinct offending angle once and ignores qpy', () => {
		const source = `${HEAD}rzz(-pi/2) $0, $1;\nrzz(-pi/2) $2, $3;\nrzz(3) $0, $1;`;
		const [warning] = rzzAngleWarnings('qasm3', source);
		expect(warning).toContain('(-pi/2, 3)');
		expect(rzzAngleWarnings('qpy', source)).toEqual([]);
	});

	it('reads the angle spellings Qiskit and a hand write, and refuses a zero divisor', () => {
		expect(rzzAngle('pi')).toBeCloseTo(Math.PI);
		expect(rzzAngle('-pi/2')).toBeCloseTo(-Math.PI / 2);
		expect(rzzAngle('3*pi/4')).toBeCloseTo((3 * Math.PI) / 4);
		expect(rzzAngle('1e-3')).toBeCloseTo(0.001);
		expect(rzzAngle('pi/0')).toBeNull();
		expect(rzzAngle('theta')).toBeNull();
		expect(rzzAngle('')).toBeNull();
	});

	it('stays linear on a run of blank lines', () => {
		const started = Date.now();
		expect(rzzAngleWarnings('qasm3', HEAD + '\n'.repeat(160_000))).toEqual([]);
		expect(Date.now() - started).toBeLessThan(500);
	});
});

describe('fractionalTwirlWarnings', () => {
	// Measured on ibm_marrakesh on 2026-09-10: an Estimator job at resilience 2 on an ansatz with rx,
	// and a noise learner job on a layer carrying rzz, both queued and failed with code 1519,
	// "Gate twirling does not support fractional gates", with no warning from the node.
	const RX = `${HEAD}rx(0.3) $0;\ncz $0, $1;`;
	const RZZ = `${HEAD}rzz(0.5) $0, $1;`;
	const PLAIN = `${HEAD}sx $0;\ncz $0, $1;`;

	it.each([
		[
			'the Gate Twirling toggle',
			{ options: { twirling: { enable_gates: true } } },
			'sampler',
			'Gate Twirling',
		],
		[
			'resilience level 2',
			{ resilience_level: 2 },
			'estimator',
			'Resilience Level 2, which IBM twirls',
		],
		[
			'PEC',
			{ options: { resilience: { pec_mitigation: true } } },
			'estimator',
			'PEC Mitigation, which IBM twirls',
		],
		['the noise learner', {}, 'noise-learner', 'the noise learner, which always twirls'],
	])('names %s as the twirling source', (_label, params, program, expected) => {
		expect(twirlingSource(params, program)).toBe(expected);
	});

	it.each([
		[{ resilience_level: 1 }, 'estimator'],
		[{ options: { twirling: { enable_measure: true } } }, 'sampler'],
		[{ options: { twirling: { enable_gates: false } } }, 'sampler'],
		[{}, 'sampler'],
	])('finds no twirling in %j', (params, program) => {
		expect(twirlingSource(params, program)).toBeNull();
	});

	it('warns about rx and rzz under each twirling source, naming the gates found', () => {
		const [rx] = fractionalTwirlWarnings('qasm3', RX, 'Gate Twirling');
		expect(rx).toContain(
			'Circuit uses rx, a fractional gate, and gate twirling is on through Gate Twirling.',
		);
		expect(rx).toContain('code 1519');
		const [both] = fractionalTwirlWarnings(
			'qasm3',
			`${RX}\nrzz(0.2) $0, $1;`,
			'the noise learner, which always twirls',
		);
		expect(both).toContain(
			'Circuit uses rx, rzz, fractional gates, and gate twirling is on through the noise learner',
		);
		expect(
			fractionalTwirlWarnings('qasm3', RZZ, 'Resilience Level 2, which IBM twirls'),
		).toHaveLength(1);
	});

	it('stays silent without twirling, without fractional gates, and on qpy', () => {
		expect(fractionalTwirlWarnings('qasm3', RX, null)).toEqual([]);
		expect(fractionalTwirlWarnings('qasm3', PLAIN, 'Gate Twirling')).toEqual([]);
		expect(fractionalTwirlWarnings('qpy', RX, 'Gate Twirling')).toEqual([]);
	});

	it('reads an rx inside a gate body and does not read rxx or a definition line as a call', () => {
		// Qiskit writes a gate body over several lines, the calls indented, which is what is read.
		const body = `${HEAD}gate mine a {\n  rx(0.1) a;\n}\nmine $0;`;
		expect(fractionalTwirlWarnings('qasm3', body, 'Gate Twirling')).toHaveLength(1);
		expect(fractionalTwirlWarnings('qasm3', `${HEAD}rxx(0.1) $0, $1;`, 'Gate Twirling')).toEqual(
			[],
		);
	});

	it('stays linear on a run of blank lines', () => {
		const started = Date.now();
		expect(fractionalTwirlWarnings('qasm3', HEAD + '\n'.repeat(160_000), 'Gate Twirling')).toEqual(
			[],
		);
		expect(Date.now() - started).toBeLessThan(500);
	});
});
