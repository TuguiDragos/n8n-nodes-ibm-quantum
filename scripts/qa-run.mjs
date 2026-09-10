// End-to-end QA harness for the IBM Quantum n8n nodes.
// Drives the n8n REST API: builds workflows that exercise every operation except Set Cost Limit,
// Update Tags and, unless QA_NOISE_LEARNER=1 is set, Submit to Noise Learner; fires the webhook
// ones, activates the two triggers, waits for the executions and prints each node's output.
//
// Usage:
//   N8N_API_KEY="..." node scripts/qa-run.mjs
//
// It cleans up the workflows it creates unless KEEP=1 is set.

const BASE = process.env.N8N_BASE || 'http://localhost:5678';
const API = `${BASE}/api/v1`;
const KEY = process.env.N8N_API_KEY;
const CRED = {
	ibmQuantumApi: {
		id: process.env.QA_CRED_ID,
		name: process.env.QA_CRED_NAME || 'IBM Quantum account',
	},
};
const BACKEND = process.env.QA_BACKEND || 'ibm_kingston';
// Node type prefix. n8n names a node loaded through N8N_CUSTOM_EXTENSIONS `CUSTOM.<name>`, but a
// node installed as a community package `<package-name>.<name>`. Default to the community form,
// since that is how users actually get it; set QA_PREFIX=CUSTOM for a custom-extensions checkout.
const PREFIX = process.env.QA_PREFIX || 'n8n-nodes-ibm-quantum';
const IBM = `${PREFIX}.ibmQuantum`;
const TRIGGER = `${PREFIX}.ibmQuantumTrigger`;
const ERROR_TRIGGER = `${PREFIX}.ibmQuantumErrorTrigger`;
const KEEP = process.env.KEEP === '1';

if (!KEY) {
	console.error('Set N8N_API_KEY');
	process.exit(1);
}
if (!CRED.ibmQuantumApi.id) {
	console.error('Set QA_CRED_ID (the n8n credential record id)');
	process.exit(1);
}

const created = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
	const res = await fetch(`${API}${path}`, {
		...opts,
		headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
	});
	const text = await res.text();
	let data;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = { raw: text };
	}
	if (!res.ok)
		throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
	return data;
}

// --- node + workflow builders -------------------------------------------------
let X = 0;
function webhook(path, mode = 'onReceived') {
	X = 240;
	return {
		id: 'wh',
		name: 'Webhook',
		type: 'n8n-nodes-base.webhook',
		typeVersion: 2,
		position: [0, 0],
		parameters: { httpMethod: 'GET', path, responseMode: mode },
	};
}
function ibm(name, params) {
	// The node declares the credential as required for every operation (even local circuit
	// build/import), so always attach it or activation fails validation.
	// typeVersion 2 is what a new node gets, so QA must exercise that path and not version 1.
	return {
		id: name.replace(/\s+/g, '_'),
		name,
		type: IBM,
		typeVersion: 2,
		position: [(X += 220), 0],
		parameters: params,
		credentials: CRED,
	};
}
function chain(names) {
	const c = {};
	for (let i = 0; i < names.length - 1; i++)
		c[names[i]] = { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] };
	return c;
}
async function createWf(name, nodes, connections, active = false) {
	const wf = await api('/workflows', {
		method: 'POST',
		body: JSON.stringify({ name, nodes, connections, settings: { executionOrder: 'v1' } }),
	});
	created.push(wf.id);
	if (active) await api(`/workflows/${wf.id}/activate`, { method: 'POST' });
	return wf.id;
}

// Fire an active webhook workflow, then wait for its newest execution to finish.
async function runWebhook(id, path, { timeout = 60000 } = {}) {
	const before = await latestExecId(id);
	const r = await fetch(`${BASE}/webhook/${path}`);
	await r.text();
	const exec = await waitNewExecution(id, before, timeout);
	return exec;
}
async function latestExecId(workflowId) {
	const list = await api(`/executions?workflowId=${workflowId}&limit=1`);
	return list.data?.[0]?.id ?? null;
}
async function waitNewExecution(workflowId, beforeId, timeout) {
	const deadline = Date.now() + timeout;
	let execId = null;
	while (Date.now() < deadline) {
		const list = await api(`/executions?workflowId=${workflowId}&limit=1`);
		const top = list.data?.[0];
		if (top && top.id !== beforeId) {
			execId = top.id;
			if (top.finished || top.status === 'success' || top.status === 'error') break;
		}
		await sleep(2000);
	}
	if (!execId) return { status: 'no-execution' };
	// fetch full data
	const full = await api(`/executions/${execId}?includeData=true`);
	return parseExecution(full);
}
function parseExecution(full) {
	const runData = full.data?.resultData?.runData || {};
	const out = {};
	for (const [node, runs] of Object.entries(runData)) {
		const first = runs?.[0];
		if (first?.error) {
			out[node] = { ERROR: first.error.message || String(first.error) };
			continue;
		}
		const json = first?.data?.main?.[0]?.[0]?.json;
		out[node] = json ?? null;
	}
	return {
		id: full.id,
		status: full.status,
		finished: full.finished,
		nodes: out,
		topError: full.data?.resultData?.error?.message,
	};
}

function short(v, n = 220) {
	const s = typeof v === 'string' ? v : JSON.stringify(v);
	return s && s.length > n ? s.slice(0, n) + '…' : s;
}
function report(title, exec) {
	console.log(`\n=== ${title}  [exec ${exec.id ?? '-'} | ${exec.status}] ===`);
	if (exec.topError) console.log('  workflow error:', exec.topError);
	for (const [node, val] of Object.entries(exec.nodes || {})) {
		if (node === 'Webhook') continue;
		const mark = val && val.ERROR ? '✗' : '✓';
		console.log(`  ${mark} ${node}: ${short(val)}`);
	}
}

// One workflow per read, so a failing operation cannot hide the ones chained after it.
async function runRead(label, steps) {
	const path = `qa-read-${label.replace(/\s+/g, '-')}`;
	const nodes = [webhook(path), ...steps.map(([name, params]) => ibm(name, params))];
	const id = await createWf(`[QA] Read ${label}`, nodes, chain(nodes.map((n) => n.name)), true);
	report(`Read: ${label}`, await runWebhook(id, path, { timeout: 60000 }));
}

// ---------------------------------------------------------------------------
const BELL = {
	resource: 'circuit',
	operation: 'build',
	numQubits: 2,
	numClbits: 2,
	gates: {
		gate: [
			{ gate: 'h', qubits: '0', params: '' },
			{ gate: 'cx', qubits: '0,1', params: '' },
			{ gate: 'measure', qubits: '0', clbit: 0 },
			{ gate: 'measure', qubits: '1', clbit: 1 },
		],
	},
};
// native X on qubit 0 -> deterministic "1"; ISA-safe for real hardware
const XCIRC = {
	resource: 'circuit',
	operation: 'build',
	numQubits: 1,
	numClbits: 1,
	gates: {
		gate: [
			{ gate: 'x', qubits: '0', params: '' },
			{ gate: 'measure', qubits: '0', clbit: 0 },
		],
	},
};
const XNOMEAS = {
	resource: 'circuit',
	operation: 'build',
	numQubits: 1,
	numClbits: 0,
	gates: { gate: [{ gate: 'x', qubits: '0', params: '' }] },
};

async function main() {
	console.log('IBM Quantum n8n QA harness');
	console.log('backend:', BACKEND, '| credential:', CRED.ibmQuantumApi.id);

	// ---- Phase 1: activate the two polling triggers FIRST (so later jobs are "fresh")
	console.log('\n[1] Activating polling triggers...');
	const wfTrig = await createWf(
		'[QA] Trigger - any terminal',
		[
			{
				id: 't',
				name: 'IBM Quantum Trigger',
				type: TRIGGER,
				typeVersion: 1,
				position: [0, 0],
				parameters: { statusFilter: 'any', limit: 20 },
				credentials: CRED,
			},
		],
		{},
		true,
	);
	const wfErr = await createWf(
		'[QA] Error Trigger - any',
		[
			{
				id: 'e',
				name: 'IBM Quantum Error Trigger',
				type: ERROR_TRIGGER,
				typeVersion: 1,
				position: [0, 0],
				parameters: { errorFilter: 'any', limit: 20 },
				credentials: CRED,
			},
		],
		{},
		true,
	);
	const trigActivatedAt = Date.now();
	console.log('  triggers active:', wfTrig, wfErr, '(seeding cursor on first poll)');

	// ---- Phase 2: read-only smoke test
	console.log('\n[2] Read-only smoke test...');
	const nodesA = [
		webhook('qa-readonly'),
		ibm('account getUsage', { resource: 'account', operation: 'getUsage' }),
		ibm('account getInstance', { resource: 'account', operation: 'getInstance' }),
		ibm('backend list', { resource: 'backend', operation: 'list' }),
		ibm('backend getLeastBusy', {
			resource: 'backend',
			operation: 'getLeastBusy',
			minQubits: 5,
			includeSimulators: false,
		}),
		ibm('backend getStatus', { resource: 'backend', operation: 'getStatus', backendName: BACKEND }),
		ibm('backend getConfiguration', {
			resource: 'backend',
			operation: 'getConfiguration',
			backendName: BACKEND,
		}),
		ibm('backend getProperties', {
			resource: 'backend',
			operation: 'getProperties',
			backendName: BACKEND,
		}),
		ibm('backend getDefaults', {
			resource: 'backend',
			operation: 'getDefaults',
			backendName: BACKEND,
		}),
		ibm('workload list', {
			resource: 'workload',
			operation: 'list',
			limit: 10,
			workloadFilters: { workloadMode: 'job', status: ['completed'] },
		}),
		ibm('account getConfiguration', { resource: 'account', operation: 'getConfiguration' }),
		ibm('account analytics', { resource: 'account', operation: 'getAnalytics' }),
		ibm('account analytics grouped', {
			resource: 'account',
			operation: 'getAnalyticsGrouped',
			groupBy: 'backend',
		}),
		ibm('account analytics by date', { resource: 'account', operation: 'getAnalyticsByDate' }),
		ibm('account analytics filters', { resource: 'account', operation: 'getAnalyticsFilters' }),
		ibm('account api versions', { resource: 'account', operation: 'getApiVersions' }),
		ibm('job list tags', { resource: 'job', operation: 'listTags', tagSearch: 'qa-' }),
		ibm('circuit build', BELL),
		ibm('circuit import', {
			resource: 'circuit',
			operation: 'import',
			qasm3Input:
				'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nh q[0];\nc[0] = measure q[0];',
		}),
	];
	const idA = await createWf(
		'[QA] Read-only smoke',
		nodesA,
		chain(nodesA.map((n) => n.name)),
		true,
	);
	report('Read-only smoke', await runWebhook(idA, 'qa-readonly', { timeout: 60000 }));

	// ---- Phase 2b: the guards that must fire locally, before a request is ever sent.
	// Every node here is expected to FAIL. A green mark in this phase is the bug.
	console.log('\n[2b] Local guards (each node must fail, and spend no quota)...');
	const nodesG = [
		webhook('qa-guards'),
		ibm('reject non-qasm', {
			resource: 'job',
			operation: 'submitSampler',
			backend: BACKEND,
			circuitFormat: 'qasm3',
			qasm3: 'this is not qasm',
			shots: 1,
		}),
	];
	const idG = await createWf('[QA] Local guards', nodesG, chain(nodesG.map((n) => n.name)), true);
	const execG = await runWebhook(idG, 'qa-guards', { timeout: 60000 });
	report('Local guards (failures are the pass)', execG);
	// Each guard runs in its own workflow, because the first failure stops the chain.
	for (const [label, params] of [
		[
			'reject bad qpy',
			{
				resource: 'job',
				operation: 'submitSampler',
				backend: BACKEND,
				circuitFormat: 'qpy',
				qpyCircuit: 'bm90IGEgcXB5IGZpbGU=',
				shots: 1,
			},
		],
		[
			'reject qasm2',
			{
				resource: 'job',
				operation: 'submitSampler',
				backend: BACKEND,
				circuitFormat: 'qasm3',
				qasm3: 'OPENQASM 2.0;\nqreg q[1];',
				shots: 1,
			},
		],
	]) {
		const path = `qa-guard-${label.replace(/\s+/g, '-')}`;
		const nodes = [webhook(path), ibm(label, params)];
		const id = await createWf(`[QA] Guard ${label}`, nodes, chain(nodes.map((n) => n.name)), true);
		report(`Guard: ${label}`, await runWebhook(id, path, { timeout: 60000 }));
	}

	// ---- Phase 2c: the reads added in 0.6.0. None of them had answered from a live account
	// when they were written, so each runs on its own and the report says exactly which one fails.
	console.log('\n[2c] Reads added in 0.6.0, one workflow each...');
	await runRead('account configuration', [
		[
			'account getAccountConfiguration',
			{ resource: 'account', operation: 'getAccountConfiguration' },
		],
	]);
	// Get Instance reports plan_id as a Global Catalog id. Feeding it back shows whether the two
	// endpoints agree on the identifier, which the spec states and nothing has confirmed.
	await runRead('account configuration by plan', [
		['account getInstance', { resource: 'account', operation: 'getInstance' }],
		[
			'account getAccountConfiguration by plan',
			{
				resource: 'account',
				operation: 'getAccountConfiguration',
				planId: "={{ $('account getInstance').item.json.plan_id }}",
			},
		],
	]);
	// A different host. These two calls also show whether the Resource Controller minds the two
	// IBM Quantum headers the credential adds to every request it signs. With Return All on the
	// answer is the merged { resources, rows_count, next_url, truncated }, where rows_count counts
	// what came back and truncated is true only when the twenty page cap stopped the walk.
	await runRead('instances', [
		['account getManyInstances', { resource: 'account', operation: 'getManyInstances', limit: 10 }],
		[
			'account getManyInstances all',
			{ resource: 'account', operation: 'getManyInstances', returnAll: true },
		],
	]);
	await runRead('least busy by wait', [
		[
			'backend getLeastBusy by wait',
			{
				resource: 'backend',
				operation: 'getLeastBusy',
				minQubits: 5,
				includeSimulators: false,
				rankBy: 'waitP50',
			},
		],
		[
			'backend getLeastBusy Heron',
			{
				resource: 'backend',
				operation: 'getLeastBusy',
				minQubits: 5,
				includeSimulators: false,
				rankBy: 'waitAverage',
				processorFamily: 'Heron',
			},
		],
	]);

	// ---- Phase 2d: the noise learner, opt-in because it runs on the QPU and spends quota.
	// Randomizations multiply shots, so the values here are the smallest that still produce a
	// result, and Max Cost caps the damage if the backend is slower than expected.
	if (process.env.QA_NOISE_LEARNER === '1') {
		console.log('\n[2d] Noise learner (spends QPU quota)...');
		const nodesN = [
			webhook('qa-noise'),
			ibm('circuit build', XCIRC),
			ibm('submit noise learner', {
				resource: 'job',
				operation: 'submitNoiseLearner',
				backend: BACKEND,
				circuitFormat: 'qasm3',
				qasm3: "={{ $('circuit build').item.json.qasm3 }}",
				maxCost: 120,
				jobTags: 'qa-noise-learner',
				noiseLearnerOptions: {
					maxLayersToLearn: 1,
					numRandomizations: 4,
					shotsPerRandomization: 32,
				},
			}),
			ibm('noise results', {
				resource: 'job',
				operation: 'getResults',
				jobId: "={{ $('submit noise learner').item.json.jobId }}",
				pollInterval: 5,
				maxWait: 300,
			}),
		];
		const idN = await createWf(
			'[QA] Noise learner',
			nodesN,
			chain(nodesN.map((n) => n.name)),
			true,
		);
		report('Noise learner', await runWebhook(idN, 'qa-noise', { timeout: 330000 }));
	} else {
		console.log('\n[2d] Noise learner skipped (set QA_NOISE_LEARNER=1 to include it)');
	}

	// ---- Phase 2e: one shot of a bare id, opt-in because it runs on the QPU. Every job carrying
	// id failed when this was measured for 0.3.3, which is why the node warns about it and the
	// palette leaves it out. Only a fresh run on today's firmware can say whether that still holds.
	if (process.env.QA_IDENTITY_PROBE === '1') {
		console.log('\n[2e] Identity probe (spends QPU quota)...');
		const nodesI = [
			webhook('qa-id-probe'),
			ibm('submit id probe', {
				resource: 'job',
				operation: 'submitSampler',
				backend: BACKEND,
				circuitFormat: 'qasm3',
				qasm3: 'OPENQASM 3.0;\ninclude "stdgates.inc";\nbit[1] c;\nid $0;\nc[0] = measure $0;',
				shots: 1,
				maxCost: 10,
				jobTags: 'qa-id-probe',
			}),
			ibm('id probe results', {
				resource: 'job',
				operation: 'getResults',
				jobId: "={{ $('submit id probe').item.json.jobId }}",
				pollInterval: 5,
				maxWait: 300,
			}),
		];
		const idI = await createWf(
			'[QA] Identity probe',
			nodesI,
			chain(nodesI.map((n) => n.name)),
			true,
		);
		const execI = await runWebhook(idI, 'qa-id-probe', { timeout: 330000 });
		report('Identity probe', execI);
		const probe = execI.nodes?.['id probe results'];
		console.log(
			`  id probe: status ${probe?.status ?? 'no body'} | reason ${probe?.reason ?? probe?.ERROR ?? 'none'}`,
		);
	} else {
		console.log('\n[2e] Identity probe skipped (set QA_IDENTITY_PROBE=1 to include it)');
	}

	// ---- Phase 3: session lifecycle
	console.log('\n[3] Session lifecycle...');
	const nodesE = [
		webhook('qa-session'),
		// batch mode: the Open plan forbids "dedicated" sessions (IBM error 1352). The parameter is
		// sessionMode on typeVersion 2; a node still on version 1 would read it as `mode`.
		ibm('session create', {
			resource: 'session',
			operation: 'create',
			sessionMode: 'batch',
			sessionBackend: BACKEND,
			maxTtl: 300,
		}),
		ibm('session get', {
			resource: 'session',
			operation: 'get',
			sessionId: "={{ $('session create').item.json.sessionId }}",
		}),
		ibm('session setAccepting', {
			resource: 'session',
			operation: 'setAccepting',
			sessionId: "={{ $('session create').item.json.sessionId }}",
			acceptingJobs: false,
		}),
		ibm('session close', {
			resource: 'session',
			operation: 'close',
			sessionId: "={{ $('session create').item.json.sessionId }}",
		}),
	];
	const idE = await createWf(
		'[QA] Session lifecycle',
		nodesE,
		chain(nodesE.map((n) => n.name)),
		true,
	);
	report('Session lifecycle', await runWebhook(idE, 'qa-session', { timeout: 60000 }));

	// ---- Phase 4: submit + cancel (fast terminal job) + getStatus + list
	// Ensure the triggers seeded their cursor (first poll) before any terminal job exists,
	// so the jobs we create count as "fresh" and actually fire the triggers.
	const waitMs = Math.max(0, 75000 - (Date.now() - trigActivatedAt));
	if (waitMs > 0) {
		console.log(`\n  waiting ${Math.round(waitMs / 1000)}s for trigger cursor to seed...`);
		await sleep(waitMs);
	}
	console.log('\n[4] Submit + cancel + status + list...');
	const nodesC = [
		webhook('qa-cancel'),
		ibm('circuit build', XCIRC),
		// maxCost caps the runtime seconds IBM may spend on this job before cancelling it.
		ibm('submit sampler', {
			resource: 'job',
			operation: 'submitSampler',
			backend: BACKEND,
			circuitFormat: 'qasm3',
			qasm3: "={{ $('circuit build').item.json.qasm3 }}",
			shots: 256,
			maxCost: 60,
		}),
		ibm('job getStatus', {
			resource: 'job',
			operation: 'getStatus',
			jobId: "={{ $('submit sampler').item.json.jobId }}",
		}),
		ibm('job getStatus light', {
			resource: 'job',
			operation: 'getStatus',
			jobId: "={{ $('submit sampler').item.json.jobId }}",
			includeParams: false,
		}),
		ibm('job cancel', {
			resource: 'job',
			operation: 'cancel',
			jobId: "={{ $('submit sampler').item.json.jobId }}",
		}),
		ibm('job list', { resource: 'job', operation: 'list', limit: 10 }),
	];
	const idC = await createWf(
		'[QA] Submit+cancel lifecycle',
		nodesC,
		chain(nodesC.map((n) => n.name)),
		true,
	);
	const execC = await runWebhook(idC, 'qa-cancel', { timeout: 90000 });
	report('Submit+cancel lifecycle', execC);
	// The spec alone says what exclude_params does on GET /jobs/{id}. Print what IBM returns, so
	// the run shows the default body carrying params and the light one without them.
	const paramsField = (name) => {
		const body = execC.nodes?.[name];
		if (!body || body.ERROR) return 'no body';
		if (!Object.hasOwn(body, 'params')) return 'absent';
		return body.params === null ? 'null' : typeof body.params;
	};
	console.log(
		`  getStatus params: default -> ${paramsField('job getStatus')} | includeParams=false -> ${paramsField('job getStatus light')}`,
	);
	const canceledJobId = execC.nodes?.['submit sampler']?.jobId || null;
	console.log('  canceled jobId:', canceledJobId);

	// ---- Phase 5: real Sampler + real Estimator (fire both, then wait in parallel)
	console.log('\n[5] Real Sampler + Estimator on hardware (parallel)...');
	const nodesB = [
		webhook('qa-sampler'),
		ibm('circuit build', XCIRC),
		ibm('submit sampler', {
			resource: 'job',
			operation: 'submitSampler',
			backend: BACKEND,
			qasm3: "={{ $('circuit build').item.json.qasm3 }}",
			shots: 512,
		}),
		ibm('get results', {
			resource: 'job',
			operation: 'getResults',
			jobId: "={{ $('submit sampler').item.json.jobId }}",
			pollInterval: 5,
			maxWait: 280,
		}),
	];
	const idB = await createWf(
		'[QA] Real Sampler run',
		nodesB,
		chain(nodesB.map((n) => n.name)),
		true,
	);

	const nodesD = [
		webhook('qa-estimator'),
		ibm('circuit build', XNOMEAS),
		ibm('submit estimator', {
			resource: 'job',
			operation: 'submitEstimator',
			backend: BACKEND,
			qasm3: "={{ $('circuit build').item.json.qasm3 }}",
			observables: '"Z"',
			resilienceLevel: 1,
		}),
		ibm('get results', {
			resource: 'job',
			operation: 'getResults',
			jobId: "={{ $('submit estimator').item.json.jobId }}",
			pollInterval: 5,
			maxWait: 280,
		}),
	];
	const idD = await createWf(
		'[QA] Real Estimator run',
		nodesD,
		chain(nodesD.map((n) => n.name)),
		true,
	);

	const [execB, execD] = await Promise.all([
		runWebhook(idB, 'qa-sampler', { timeout: 300000 }),
		runWebhook(idD, 'qa-estimator', { timeout: 300000 }),
	]);
	report('Real Sampler run', execB);
	report('Real Estimator run', execD);

	// ---- Phase 5b: the two reads that need a job which actually ran. Logs exist only for such a
	// job, and Get Logs throws when there are none, so each gets its own workflow.
	const sampledJobId = execB.nodes?.['submit sampler']?.jobId || null;
	if (sampledJobId) {
		console.log('\n[5b] Metrics and logs of the completed sampler job...');
		await runRead('job metrics', [
			['job getMetrics', { resource: 'job', operation: 'getMetrics', jobId: sampledJobId }],
		]);
		await runRead('job logs', [
			['job getLogs', { resource: 'job', operation: 'getLogs', jobId: sampledJobId }],
		]);
	} else {
		console.log('\n[5b] Metrics and logs skipped: the sampler run returned no job id');
	}

	// ---- Phase 6: wait for the polling triggers to fire on the terminal jobs
	console.log('\n[6] Waiting for polling triggers to fire (up to 4 min)...');
	const trigDeadline = Date.now() + 240000;
	let trigFired = null,
		errFired = null;
	while (Date.now() < trigDeadline && (!trigFired || !errFired)) {
		if (!trigFired) {
			const l = await api(`/executions?workflowId=${wfTrig}&limit=1`);
			if (l.data?.[0]) trigFired = l.data[0];
		}
		if (!errFired) {
			const l = await api(`/executions?workflowId=${wfErr}&limit=1`);
			if (l.data?.[0]) errFired = l.data[0];
		}
		if (trigFired && errFired) break;
		await sleep(5000);
	}
	if (trigFired)
		report(
			'Trigger fired',
			parseExecution(await api(`/executions/${trigFired.id}?includeData=true`)),
		);
	else console.log('  ✗ Trigger did not fire within window');
	if (errFired)
		report(
			'Error Trigger fired',
			parseExecution(await api(`/executions/${errFired.id}?includeData=true`)),
		);
	else
		console.log(
			'  ✗ Error Trigger did not fire within window (no failed/canceled job picked up yet)',
		);

	// ---- Phase 7: delete a job (the canceled one) to exercise job:delete
	if (canceledJobId) {
		console.log('\n[7] Job delete...');
		const nodesDel = [
			webhook('qa-delete'),
			ibm('job delete', { resource: 'job', operation: 'delete', jobId: canceledJobId }),
		];
		const idDel = await createWf(
			'[QA] Job delete',
			nodesDel,
			chain(nodesDel.map((n) => n.name)),
			true,
		);
		report('Job delete', await runWebhook(idDel, 'qa-delete', { timeout: 30000 }));
	}

	// ---- cleanup
	if (!KEEP) {
		console.log('\n[cleanup] removing QA workflows...');
		// Best effort: a deactivate or delete that fails must not stop the rest of the list from
		// being removed.
		for (const id of created) {
			await api(`/workflows/${id}/deactivate`, { method: 'POST' }).catch(() => {});
			await api(`/workflows/${id}`, { method: 'DELETE' }).catch(() => {});
		}
		console.log('  removed', created.length, 'workflows');
	} else {
		console.log('\n[cleanup] KEEP=1, leaving', created.length, 'workflows in n8n');
	}
	console.log('\nDONE.');
}

main().catch((e) => {
	console.error('FATAL', e);
	process.exit(1);
});
