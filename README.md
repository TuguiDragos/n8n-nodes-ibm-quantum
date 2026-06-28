<h1 align="center">n8n-nodes-ibm-quantum</h1>

<p align="center">Build, run and retrieve quantum circuits on the IBM Quantum Platform, straight from n8n.</p>

<p align="center">
  <a href="https://github.com/TuguiDragos/n8n-nodes-ibm-quantum/actions/workflows/ci.yml"><img src="https://github.com/TuguiDragos/n8n-nodes-ibm-quantum/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/n8n-nodes-ibm-quantum"><img src="https://img.shields.io/npm/v/n8n-nodes-ibm-quantum?style=flat&logo=npm&logoColor=white&color=CB3837" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-2E7D32?style=flat" alt="License: MIT"></a>
</p>

<p align="center"><sub>Unofficial, community-maintained node. Not affiliated with, endorsed by, or sponsored by IBM. IBM Quantum and Qiskit are trademarks of International Business Machines Corporation.</sub></p>

## What it does

The node groups its work into five resources.

| Resource | Operations |
| --- | --- |
| Backend | List, Get Configuration, Get Properties, Get Status, Get Least Busy |
| Circuit | Build (from a gate list), Import OpenQASM 3 |
| Job | Submit to Sampler, Submit to Estimator, Get Status, Get Results, List, Cancel, Delete |
| Session | Create (batch or dedicated), Get, Set Accepting Jobs, Close |
| Account | Get Usage, Get Instance |

It ships three nodes: the main **IBM Quantum** action node and two polling triggers (**IBM Quantum Trigger** and **IBM Quantum Error Trigger**).

<p align="center">
  <img src=".github/images/IBM%20Quantum%20-%20Trigger%20Picker.png" alt="IBM Quantum trigger and error-trigger nodes shown in the n8n trigger picker" width="460">
</p>
<p align="center"><sub>Both trigger nodes appear in the n8n trigger picker.</sub></p>

<p align="center">
  <img src=".github/images/IBM%20Quantum%20-%20Actions%20A.png" alt="IBM Quantum node details listing the trigger and the Account and Backend actions" width="330">
  <img src=".github/images/IBM%20Quantum%20-%20Actions%20B.png" alt="IBM Quantum node details listing the Circuit, Job and Session actions" width="330">
</p>
<p align="center"><sub>All five resources and their operations in the node's action list.</sub></p>

## Architecture

The node is a thin REST wrapper with no runtime dependencies. It does not bundle Qiskit or any quantum library. Circuits are expressed as OpenQASM 3 strings, either built by the node from a gate list or passed in directly. The IBM Cloud API key is exchanged for a short-lived IAM bearer token, which n8n caches and refreshes automatically.

## Installation

On self-hosted n8n, open the community nodes screen and enter the package name `n8n-nodes-ibm-quantum`. Once the package is verified by n8n it also becomes installable on n8n Cloud.

## Prerequisites

- An IBM Cloud account with access to the IBM Quantum Platform
- An IBM Cloud API key
- The Cloud Resource Name (CRN) of your Qiskit Runtime instance
- n8n on a recent version that supports community nodes

## Getting your credentials

Create an **IBM Quantum API** credential in n8n with these fields.

1. **API Key**: in the IBM Cloud console open [Manage > Access (IAM) > API keys](https://cloud.ibm.com/iam/apikeys), create a key, and copy it immediately (it is shown only once). The node exchanges it for a short-lived IAM token at request time.
2. **Instance CRN**: open the [IBM Quantum Platform instances page](https://quantum.cloud.ibm.com/instances) and copy the CRN of your Qiskit Runtime instance. It is sent as the `Service-CRN` header.
3. **Region**: pick US East or EU (Germany) to match your instance. This selects the API host.
4. **API Version**: the date sent in the `IBM-API-Version` header. The response schema is versioned by this date. The default is a known good value that you can update as IBM publishes newer versions.

The credential includes a test that calls the backends endpoint, so you can confirm all four fields at once with the **Test** button.

<p align="center">
  <img src=".github/images/IBM%20Quantum%20account%20-%20Credentials.png" alt="IBM Quantum API credential in n8n showing a successful connection test" width="720">
</p>
<p align="center"><sub>The credential form after a successful connection test.</sub></p>

## Example workflow

A four-node flow that prepares a Bell state, picks a backend, runs it and reads the counts.

1. **Circuit > Build**: Number of Qubits `2`, Number of Classical Bits `2`. Add gates in order: Hadamard on qubits `0`; CNOT / CX on qubits `0,1`; Measure on qubits `0` with Classical Bit `0`; Measure on qubits `1` with Classical Bit `1`. Outputs `qasm3`, `numQubits`, `numClbits`, `gateCount`.
2. **Backend > Get Least Busy**: Minimum Qubits `2`, Include Simulators off. Outputs `leastBusy` with the backend name.
3. **Job > Submit**: Primitive Sampler, Backend `={{ $json.leastBusy }}`, OpenQASM 3 Circuit `={{ $('Build').item.json.qasm3 }}` (use the name of your Circuit node), Shots `1024`. Outputs `jobId`.
4. **Job > Get Results**: Job ID `={{ $json.jobId }}`, Poll Interval `5`, Max Wait `300`. Outputs the parsed `pubs`, each carrying `counts` for the Sampler.

<p align="center">
  <img src=".github/images/Get%20Least%20Busy%20QPU.png" alt="Get Least Busy backend node choosing the least busy QPU" width="720">
</p>
<p align="center"><sub>Get Least Busy ranks the online devices by queue length and returns the best one.</sub></p>

<p align="center">
  <img src=".github/images/IBM%20Quantum%20-%20Workflow%20A.png" alt="Submit to Sampler node with an ISA circuit, returning a job ID" width="720">
</p>
<p align="center"><sub>Submit to Sampler sends the circuit and returns immediately with a <code>jobId</code>.</sub></p>

## Long-running jobs

Real hardware jobs can spend a long time in the queue, sometimes minutes to hours. How you wait for the result matters.

**Get Results blocks the execution while it polls.** It calls the job endpoint every Poll Interval seconds until the job finishes or Max Wait is reached, holding that one execution open the whole time. That is fine for quick jobs and simulators, but for a long hardware queue it is fragile: if n8n restarts or the run hits a limit, the execution is interrupted and you see "Execution stopped at this node". IBM exposes no push or callback (verified against the API), so something has to poll; the question is whether it blocks a running execution.

**The healthy pattern is to decouple submission from result handling** with the **IBM Quantum Trigger**:

- One workflow submits the job and finishes immediately with the `jobId`. Nothing blocks.
- A second, **active** workflow starts with the IBM Quantum Trigger. It polls IBM in the background (the n8n scheduler, not a held-open execution) and fires only when a job reaches a terminal state. Its Get Results then returns at once, because the job is already finished.

So polling still happens, but in the background instead of inside a blocking node held open for the whole Max Wait window (300 seconds by default). Use Get Results directly for short jobs and simulators; use Submit plus the trigger for long hardware runs.

<p align="center">
  <img src=".github/images/IBM%20Quantum%20-%20Workflow%20B.png" alt="IBM Quantum Trigger firing on job completion, then Get Results returning measurement counts" width="720">
</p>
<p align="center"><sub>The IBM Quantum Trigger fires when the job finishes, and Get Results returns the measurement counts at once.</sub></p>

IBM does not push notifications, so the trigger polls. Set the interval with the built-in Poll Times field, and choose which terminal status should fire it. The trigger only polls while its workflow is **active** (toggle Active); for a one-off test use Fetch Test Event.

For production, pair it with the **IBM Quantum Error Trigger**, which fires only when a job fails or is canceled (queue timeout, a calibration fault, or a manual cancel from the IBM dashboard). It emits the failure `reason`, `reasonCode` and `reasonSolution` from the job, so a second workflow can alert an engineer or fall back to a simulator instead of stalling.

## Sessions and batches

Hybrid quantum-classical loops (VQE, QAOA) submit many circuits in sequence, adjusting parameters between iterations. Submitting each as a standalone job sends every iteration back to the general queue. The **Session** resource avoids that:

- **Create** a session with mode **Batch** (queues jobs to run consecutively; the default and the only mode the Open plan allows) or **Dedicated** (reserves the backend for low-latency back-to-back jobs, paid plans only). It returns a `sessionId`.
- Pass that `sessionId` into the **Session ID** field of each Submit, so the jobs run inside the reservation.
- **Close** the session at the end of the workflow (or set Accepting Jobs to false), so it does not hold the backend.

Use the **Account** resource (Get Usage) to check `usage_consumed_seconds` against `usage_limit_seconds` before launching a large run.

## Gate syntax

In the Circuit Build operation each gate has a Qubits field and, for parametric gates, a Parameters field. Both are comma separated.

- Single qubit gates take one qubit index, for example `0`.
- Two qubit controlled gates take the control first and the target last, for example `0,1` for control 0 and target 1.
- The Toffoli (CCX) gate takes two controls and a target, for example `0,1,2`.
- Parametric gates read their angles in radians from the Parameters field. RX, RY, RZ, Phase and the Controlled-R gates take one value; the U gate takes exactly three (theta, phi, lambda).
- The Measure instruction writes to the classical bit given in the Classical Bit field.

Invalid input (wrong number of qubits or parameters, an out-of-range index, or a non-numeric value) is rejected at build time with a clear error, so a malformed program never reaches IBM.

The Build operation outputs a `qasm3` string that you pass into a Job Submit node using an expression.

## Primitives and options

The Submit operation is split per primitive, since their inputs differ:

- **Submit to Sampler** returns measurement counts. Set Shots to the number of repetitions.
- **Submit to Estimator** returns expectation values. Set Observables to a Pauli string whose length matches the qubit count (for example `ZZ` for two qubits) or an array of such strings, pick a Resilience Level, and optionally a Precision.

Both share error-suppression toggles that matter on real hardware: **Dynamical Decoupling**, **Gate Twirling** and **Measurement Twirling**. For parametrized circuits, set **Parameters** to a JSON object binding parameter names to values, e.g. `{"theta": 1.5708}`. **Additional Options** is a JSON escape hatch merged into the primitive `options`, for example `{"default_shots": 4096}`.

## Bit order

Sampler counts follow the classical register order. The bit `c[0]` is the rightmost bit in each output bitstring, which matches the standard Qiskit convention.

## Transpilation

This is the single most common reason a real-hardware job fails, so it is worth understanding.

### Why it is needed

A textbook circuit uses high-level gates such as `h` (Hadamard) and `cx` (CNOT). A real quantum chip does not run those directly. Each backend executes only a small set of **native gates** (for example a Heron processor like `ibm_fez` runs `rz`, `sx`, `x`, `cz`, plus measure and reset), and its qubits are wired in a fixed topology. Translating a circuit into a backend's native gates and connectivity is called **transpilation**, and the result is an **ISA** (Instruction Set Architecture) circuit.

The Qiskit Runtime REST API **does not transpile**. It expects an ISA circuit and rejects anything else. If you submit a raw circuit to a real backend you get a failed job with `reason_code: 1517`:

```
The instruction h on qubits (0,) is not supported by the target system.
Transpile your circuits for the target before submitting a primitive query.
```

This is not a node bug. The node builds, submits and reads the job correctly; the hardware refuses a non-ISA circuit.

### How to transpile (free, any plan)

Transpile locally with Qiskit, then feed the ISA string into the node. You do not need live credentials: a fake backend carries the real topology and native gate set.

```python
from qiskit import QuantumCircuit, qasm3
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
from qiskit_ibm_runtime.fake_provider import FakeFez  # mirrors ibm_fez

backend = FakeFez()

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure(0, 0)
qc.measure(1, 1)

isa = generate_preset_pass_manager(optimization_level=1, backend=backend).run(qc)
print(qasm3.dumps(isa))  # paste this ISA string into the node
```

For a real run, swap the fake backend for the live one (`QiskitRuntimeService(channel="ibm_cloud", token=..., instance=...).backend("ibm_fez")`) so the layout matches the exact device.

A Bell circuit transpiled for `ibm_fez` comes out in native gates only:

```
OPENQASM 3.0;
include "stdgates.inc";
bit[2] c;
rz(pi/2) $0;
sx $0;
rz(pi/2) $0;
rz(pi/2) $1;
sx $1;
rz(pi/2) $1;
cz $0, $1;
rz(pi/2) $1;
sx $1;
rz(pi/2) $1;
c[0] = measure $0;
c[1] = measure $1;
```

### How to run it in the node

1. Put the ISA string into **Circuit, Import OpenQASM 3**, or paste it straight into the **OpenQASM 3 Circuit** field of a Submit operation.
2. Pin **Backend** to the exact device you transpiled for (for example `ibm_fez`), not Get Least Busy. An ISA circuit is specific to one topology; another device may reject it.
3. Submit to Sampler or Estimator as usual.

### The cloud Transpiler Service (paid plans only)

IBM also offers the [Qiskit Transpiler Service](https://quantum.cloud.ibm.com/docs/en/api/qiskit-transpiler-service-rest/tags/transpiler-methods), a separate cloud API (`https://cloud-transpiler.quantum.ibm.com/transpile`) that transpiles remotely, optionally with AI-powered passes. It is **only available on the Premium, Flex and On-Prem plans**, not the free Open plan, and it lives at a different host from the Qiskit Runtime API, so it is not wired into this node. On the Open plan, transpile locally as shown above.

### Simulators

Simulators accept any gate and need no transpilation, so setting **Include Simulators** on Get Least Busy lets a circuit run as written. Note that the current IBM Quantum Platform has largely retired cloud simulators, so an instance may have none available and fall back to hardware.

## Troubleshooting

- **401 or IAM token errors on every call**: the API key is wrong, revoked or expired. Regenerate it in IBM Cloud and update the credential.
- **404 or an empty backends list**: the Region does not match the region of your instance CRN. US East and EU (Germany) are separate hosts.
- **Job never completes in Get Results**: large hardware queues can exceed the Max Wait. Raise Max Wait, or poll separately with Get Status and call Get Results once the job is done.
- **Job fails with `reason_code: 1517` (instruction not supported)**: the circuit was not transpiled to the backend's native gates. See the Transpilation section above.
- **Submit rejected by IBM**: the Observables length does not match the qubit count, or the circuit is not valid ISA for the chosen backend.

## Development

```bash
npm install   # on Node 24+, use: npm install --ignore-scripts
npm run lint
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow. Release history lives in the Git commit log and the GitHub Releases page.

## Releasing

Releases publish to npm with provenance through the `publish.yml` GitHub Actions workflow when a GitHub release is created. Authentication uses an npm automation token stored as the `NPM_TOKEN` repository secret; provenance still works because the repo is public and the job has `id-token: write`. The package version must match the release tag.

## Notes on the live API

The request and response shapes follow the published Qiskit Runtime REST API reference. The job body sends the primitive as `program_id`, the circuit inside a PUB, and `version` 2 in `params`, with `resilience_level` at the params level for the Estimator. Sampler results are read from `results[i].data[register].samples` as hex strings, and the least busy backend is chosen from the backends list, which already carries the status, qubit count and queue length for each device.

## License

[MIT](LICENSE)
