// End-to-end QA harness for the IBM Quantum n8n nodes.
// Drives the n8n REST API: builds webhook-triggered workflows that exercise every
// operation, fires them, waits for the executions and prints each node's output.
//
// Usage:
//   N8N_API_KEY="..." node scripts/qa-run.mjs
//
// It cleans up the workflows it creates unless KEEP=1 is set.

const BASE = process.env.N8N_BASE || 'http://localhost:5678';
const API = `${BASE}/api/v1`;
const KEY = process.env.N8N_API_KEY;
const CRED = { ibmQuantumApi: { id: process.env.QA_CRED_ID, name: process.env.QA_CRED_NAME || 'IBM Quantum account' } };
const BACKEND = process.env.QA_BACKEND || 'ibm_kingston';
const IBM = 'CUSTOM.ibmQuantum';
const TRIGGER = 'CUSTOM.ibmQuantumTrigger';
const ERROR_TRIGGER = 'CUSTOM.ibmQuantumErrorTrigger';
const KEEP = process.env.KEEP === '1';

if (!KEY) { console.error('Set N8N_API_KEY'); process.exit(1); }
if (!CRED.ibmQuantumApi.id) { console.error('Set QA_CRED_ID (the n8n credential record id)'); process.exit(1); }

const created = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
	const res = await fetch(`${API}${path}`, {
		...opts,
		headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
	});
	const text = await res.text();
	let data;
	try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
	if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
	return data;
}

// --- node + workflow builders -------------------------------------------------
let X = 0;
function webhook(path, mode = 'onReceived') {
	X = 240;
	return { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2,
		position: [0, 0], parameters: { httpMethod: 'GET', path, responseMode: mode } };
}
function ibm(name, params) {
	// The node declares the credential as required for every operation (even local circuit
	// build/import), so always attach it or activation fails validation.
	return { id: name.replace(/\s+/g, '_'), name, type: IBM, typeVersion: 1,
		position: [X += 220, 0], parameters: params, credentials: CRED };
}
function chain(names) {
	const c = {};
	for (let i = 0; i < names.length - 1; i++) c[names[i]] = { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] };
	return c;
}
async function createWf(name, nodes, connections, active = false) {
	const wf = await api('/workflows', { method: 'POST', body: JSON.stringify({ name, nodes, connections, settings: { executionOrder: 'v1' } }) });
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
		if (top && top.id !== beforeId) { execId = top.id; if (top.finished || top.status === 'success' || top.status === 'error') break; }
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
		if (first?.error) { out[node] = { ERROR: first.error.message || String(first.error) }; continue; }
		const json = first?.data?.main?.[0]?.[0]?.json;
		out[node] = json ?? null;
	}
	return { id: full.id, status: full.status, finished: full.finished, nodes: out, topError: full.data?.resultData?.error?.message };
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

// ---------------------------------------------------------------------------
const BELL = { resource: 'circuit', operation: 'build', numQubits: 2, numClbits: 2,
	gates: { gate: [ { gate: 'h', qubits: '0', params: '' }, { gate: 'cx', qubits: '0,1', params: '' },
		{ gate: 'measure', qubits: '0', clbit: 0 }, { gate: 'measure', qubits: '1', clbit: 1 } ] } };
// native X on qubit 0 -> deterministic "1"; ISA-safe for real hardware
const XCIRC = { resource: 'circuit', operation: 'build', numQubits: 1, numClbits: 1,
	gates: { gate: [ { gate: 'x', qubits: '0', params: '' }, { gate: 'measure', qubits: '0', clbit: 0 } ] } };
const XNOMEAS = { resource: 'circuit', operation: 'build', numQubits: 1, numClbits: 0,
	gates: { gate: [ { gate: 'x', qubits: '0', params: '' } ] } };

async function main() {
	console.log('IBM Quantum n8n QA harness');
	console.log('backend:', BACKEND, '| credential:', CRED.ibmQuantumApi.id);

	// ---- Phase 1: activate the two polling triggers FIRST (so later jobs are "fresh")
	console.log('\n[1] Activating polling triggers...');
	const wfTrig = await createWf('[QA] Trigger - any terminal',
		[{ id: 't', name: 'IBM Quantum Trigger', type: TRIGGER, typeVersion: 1, position: [0, 0],
			parameters: { statusFilter: 'any', limit: 20 }, credentials: CRED }], {}, true);
	const wfErr = await createWf('[QA] Error Trigger - any',
		[{ id: 'e', name: 'IBM Quantum Error Trigger', type: ERROR_TRIGGER, typeVersion: 1, position: [0, 0],
			parameters: { errorFilter: 'any', limit: 20 }, credentials: CRED }], {}, true);
	const trigActivatedAt = Date.now();
	console.log('  triggers active:', wfTrig, wfErr, '(seeding cursor on first poll)');

	// ---- Phase 2: read-only smoke test
	console.log('\n[2] Read-only smoke test...');
	const nodesA = [
		webhook('qa-readonly'),
		ibm('account getUsage', { resource: 'account', operation: 'getUsage' }),
		ibm('account getInstance', { resource: 'account', operation: 'getInstance' }),
		ibm('backend list', { resource: 'backend', operation: 'list' }),
		ibm('backend getLeastBusy', { resource: 'backend', operation: 'getLeastBusy', minQubits: 5, includeSimulators: false }),
		ibm('backend getStatus', { resource: 'backend', operation: 'getStatus', backendName: BACKEND }),
		ibm('backend getConfiguration', { resource: 'backend', operation: 'getConfiguration', backendName: BACKEND }),
		ibm('backend getProperties', { resource: 'backend', operation: 'getProperties', backendName: BACKEND }),
		ibm('circuit build', BELL),
		ibm('circuit import', { resource: 'circuit', operation: 'import',
			qasm3Input: 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nh q[0];\nc[0] = measure q[0];' }),
	];
	const idA = await createWf('[QA] Read-only smoke', nodesA, chain(nodesA.map((n) => n.name)), true);
	report('Read-only smoke', await runWebhook(idA, 'qa-readonly', { timeout: 60000 }));

	// ---- Phase 3: session lifecycle
	console.log('\n[3] Session lifecycle...');
	const nodesE = [
		webhook('qa-session'),
		// batch mode: the Open plan forbids "dedicated" sessions (IBM error 1352)
		ibm('session create', { resource: 'session', operation: 'create', mode: 'batch', sessionBackend: BACKEND, maxTtl: 300 }),
		ibm('session get', { resource: 'session', operation: 'get', sessionId: "={{ $('session create').item.json.sessionId }}" }),
		ibm('session setAccepting', { resource: 'session', operation: 'setAccepting', sessionId: "={{ $('session create').item.json.sessionId }}", acceptingJobs: false }),
		ibm('session close', { resource: 'session', operation: 'close', sessionId: "={{ $('session create').item.json.sessionId }}" }),
	];
	const idE = await createWf('[QA] Session lifecycle', nodesE, chain(nodesE.map((n) => n.name)), true);
	report('Session lifecycle', await runWebhook(idE, 'qa-session', { timeout: 60000 }));

	// ---- Phase 4: submit + cancel (fast terminal job) + getStatus + list
	// Ensure the triggers seeded their cursor (first poll) before any terminal job exists,
	// so the jobs we create count as "fresh" and actually fire the triggers.
	const waitMs = Math.max(0, 75000 - (Date.now() - trigActivatedAt));
	if (waitMs > 0) { console.log(`\n  waiting ${Math.round(waitMs / 1000)}s for trigger cursor to seed...`); await sleep(waitMs); }
	console.log('\n[4] Submit + cancel + status + list...');
	const nodesC = [
		webhook('qa-cancel'),
		ibm('circuit build', XCIRC),
		ibm('submit sampler', { resource: 'job', operation: 'submitSampler', backend: BACKEND,
			qasm3: "={{ $('circuit build').item.json.qasm3 }}", shots: 256 }),
		ibm('job getStatus', { resource: 'job', operation: 'getStatus', jobId: "={{ $('submit sampler').item.json.jobId }}" }),
		ibm('job cancel', { resource: 'job', operation: 'cancel', jobId: "={{ $('submit sampler').item.json.jobId }}" }),
		ibm('job list', { resource: 'job', operation: 'list', limit: 10 }),
	];
	const idC = await createWf('[QA] Submit+cancel lifecycle', nodesC, chain(nodesC.map((n) => n.name)), true);
	const execC = await runWebhook(idC, 'qa-cancel', { timeout: 90000 });
	report('Submit+cancel lifecycle', execC);
	const canceledJobId = execC.nodes?.['submit sampler']?.jobId || null;
	console.log('  canceled jobId:', canceledJobId);

	// ---- Phase 5: real Sampler + real Estimator (fire both, then wait in parallel)
	console.log('\n[5] Real Sampler + Estimator on hardware (parallel)...');
	const nodesB = [
		webhook('qa-sampler'),
		ibm('circuit build', XCIRC),
		ibm('submit sampler', { resource: 'job', operation: 'submitSampler', backend: BACKEND,
			qasm3: "={{ $('circuit build').item.json.qasm3 }}", shots: 512 }),
		ibm('get results', { resource: 'job', operation: 'getResults',
			jobId: "={{ $('submit sampler').item.json.jobId }}", pollInterval: 5, maxWait: 280 }),
	];
	const idB = await createWf('[QA] Real Sampler run', nodesB, chain(nodesB.map((n) => n.name)), true);

	const nodesD = [
		webhook('qa-estimator'),
		ibm('circuit build', XNOMEAS),
		ibm('submit estimator', { resource: 'job', operation: 'submitEstimator', backend: BACKEND,
			qasm3: "={{ $('circuit build').item.json.qasm3 }}", observables: '"Z"', resilienceLevel: 1 }),
		ibm('get results', { resource: 'job', operation: 'getResults',
			jobId: "={{ $('submit estimator').item.json.jobId }}", pollInterval: 5, maxWait: 280 }),
	];
	const idD = await createWf('[QA] Real Estimator run', nodesD, chain(nodesD.map((n) => n.name)), true);

	const [execB, execD] = await Promise.all([
		runWebhook(idB, 'qa-sampler', { timeout: 300000 }),
		runWebhook(idD, 'qa-estimator', { timeout: 300000 }),
	]);
	report('Real Sampler run', execB);
	report('Real Estimator run', execD);

	// ---- Phase 6: wait for the polling triggers to fire on the terminal jobs
	console.log('\n[6] Waiting for polling triggers to fire (up to 4 min)...');
	const trigDeadline = Date.now() + 240000;
	let trigFired = null, errFired = null;
	while (Date.now() < trigDeadline && (!trigFired || !errFired)) {
		if (!trigFired) { const l = await api(`/executions?workflowId=${wfTrig}&limit=1`); if (l.data?.[0]) trigFired = l.data[0]; }
		if (!errFired) { const l = await api(`/executions?workflowId=${wfErr}&limit=1`); if (l.data?.[0]) errFired = l.data[0]; }
		if (trigFired && errFired) break;
		await sleep(5000);
	}
	if (trigFired) report('Trigger fired', parseExecution(await api(`/executions/${trigFired.id}?includeData=true`)));
	else console.log('  ✗ Trigger did not fire within window');
	if (errFired) report('Error Trigger fired', parseExecution(await api(`/executions/${errFired.id}?includeData=true`)));
	else console.log('  ✗ Error Trigger did not fire within window (no failed/canceled job picked up yet)');

	// ---- Phase 7: delete a job (the canceled one) to exercise job:delete
	if (canceledJobId) {
		console.log('\n[7] Job delete...');
		const nodesDel = [
			webhook('qa-delete'),
			ibm('job delete', { resource: 'job', operation: 'delete', jobId: canceledJobId }),
		];
		const idDel = await createWf('[QA] Job delete', nodesDel, chain(nodesDel.map((n) => n.name)), true);
		report('Job delete', await runWebhook(idDel, 'qa-delete', { timeout: 30000 }));
	}

	// ---- cleanup
	if (!KEEP) {
		console.log('\n[cleanup] removing QA workflows...');
		for (const id of created) { try { await api(`/workflows/${id}/deactivate`, { method: 'POST' }); } catch {} try { await api(`/workflows/${id}`, { method: 'DELETE' }); } catch {} }
		console.log('  removed', created.length, 'workflows');
	} else {
		console.log('\n[cleanup] KEEP=1, leaving', created.length, 'workflows in n8n');
	}
	console.log('\nDONE.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
