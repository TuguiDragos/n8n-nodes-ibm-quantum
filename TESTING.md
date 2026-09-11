# Testing record

Every job this project has run on IBM Quantum hardware through the n8n node, and every test round
that produced it, in one place. Times are UTC, as IBM records them; the machine the tests ran from
was on UTC+2. QPU seconds are IBM's own `usage.qpu_charge_time_seconds` per job, read from the job
listing; a job that never ran on a device reports 0.

## Scope and method

The account behind this project has also run jobs from Qiskit and from other programs, and only
the jobs that went through this node belong here. The list was read on 2026-09-10 at 20:31 UTC,
after the last round, with **Job > Get Many**, **Return All** on and **Include Circuit Params**
on, which returns every job with the parameters IBM stored for it. A job counts as run through the
node when all three hold:

- its program is `sampler`, `estimator` or `noise-learner`, the three the node submits;
- `support_qiskit` appears nowhere in its `params`: `qiskit-ibm-runtime` sets that flag on every
  job it sends, in `params` for the primitives and in `params.options` for the noise learner, and
  this node never does;
- its `params` carry the request shape this node builds, `pubs` for the primitives and `circuits`
  for the noise learner, or no parameters at all, which is what IBM stores for a job submitted with
  **Private** on, since a private job hides its inputs.

Of the 327 jobs on the account, 283 pass the rule and 44 do not: 25 Sampler and 8 Estimator jobs
carrying `support_qiskit`, 5 jobs of the `executor` program, which the node cannot submit, and 6
noise learner jobs of 2026-07-20 written in that program's older request schema, `instructions`
and `schema_version`, which the node has never sent. Of the 283, 269 carry OpenQASM 3 text, 7
carry QPY, 2 carry a deliberately invalid circuit sent to measure the refusal, and 5 are private
jobs with no parameters stored.

Every number below comes from that listing or from the n8n execution store, decoded from the
database n8n writes, never from a console print. A documented-shape checker holding the 45 output
shapes transcribed from `llms-full.txt` compared every output key by key; for a shape the node
builds itself, any key beyond the documented ones counts as a violation.

## Totals

| jobs through the node | completed | failed | cancelled | QPU seconds | first | last |
| --- | --- | --- | --- | --- | --- | --- |
| 283 | 187 | 68 | 28 | 1799 (30.0 minutes) | 2026-06-24 19:39 | 2026-09-10 20:27 |

By program: 238 Sampler, 29 Estimator, 16 Noise Learner. By backend: 123 on `ibm_fez`, 81 on
`ibm_marrakesh`, 79 on `ibm_kingston`, all three Heron r2 devices with 156 qubits. Failed and
cancelled jobs are part of the record on purpose: most were sent to measure exactly how IBM refuses
something, and the reason codes they returned are what the documentation quotes.

## By day

| date | jobs | completed | failed | cancelled | QPU s | backends |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-06-24 | 9 | 7 | 2 | 0 | 28 | ibm_fez, ibm_kingston, ibm_marrakesh |
| 2026-06-26 | 4 | 4 | 0 | 0 | 8 | ibm_fez, ibm_kingston |
| 2026-06-30 | 1 | 1 | 0 | 0 | 2 | ibm_fez |
| 2026-07-01 | 1 | 1 | 0 | 0 | 12 | ibm_fez |
| 2026-08-02 | 28 | 22 | 6 | 0 | 121 | ibm_kingston, ibm_marrakesh |
| 2026-08-06 | 1 | 0 | 1 | 0 | 2 | ibm_kingston |
| 2026-08-17 | 8 | 6 | 0 | 2 | 12 | ibm_kingston, ibm_marrakesh |
| 2026-08-18 | 6 | 4 | 1 | 1 | 18 | ibm_kingston, ibm_marrakesh |
| 2026-08-19 | 2 | 0 | 1 | 1 | 0 | ibm_kingston |
| 2026-08-20 | 3 | 1 | 0 | 2 | 2 | ibm_kingston |
| 2026-08-21 | 10 | 7 | 1 | 2 | 17 | ibm_fez, ibm_kingston, ibm_marrakesh |
| 2026-08-22 | 80 | 44 | 32 | 4 | 370 | ibm_fez, ibm_kingston |
| 2026-08-30 | 1 | 1 | 0 | 0 | 3 | ibm_fez |
| 2026-09-07 | 34 | 27 | 7 | 0 | 236 | ibm_fez, ibm_kingston, ibm_marrakesh |
| 2026-09-08 | 18 | 11 | 3 | 4 | 89 | ibm_marrakesh |
| 2026-09-10 | 77 | 51 | 14 | 12 | 879 | ibm_fez, ibm_kingston, ibm_marrakesh |

The days before 2026-09-07 are the hardware runs made while building 0.1.x through 0.5.0, and
CHANGELOG.md records, release by release, what each of them measured; the releases were dated
2026-07-07 (0.2.2), 2026-07-09 (0.2.3), 2026-08-02 (0.3.3), 2026-08-18 (0.4.1) and 2026-08-21
(0.5.0). The tags of August name those runs in Romanian, `qa22h`, `qa22aug`, `faza2` and the like,
and 2026-08-22 alone holds 80 jobs, 76 of them on `ibm_fez`, the day 0.5.0 was proved on hardware.
The untagged jobs of June and July carry the node's request shape and no other client's markers.
2026-09-07 and 2026-09-08 are the 0.6.0 live campaign and its hardening pass, 52 jobs and 325
QPU seconds, summarised under Verified on hardware in CHANGELOG.md. 2026-09-10 is the
confirmation campaign for 0.6.0 described in full below: 77 jobs and 879 QPU seconds, 14.7
minutes of hardware time, in eight rounds.

## 2026-09-10: the confirmation campaign for 0.6.0

### Environment

- n8n 2.38.6, installed fresh that day, with the package installed from a tarball packed off
  commit `7d92f70` and verified file by file against the tarball; `n8n-workflow` 2.38.1, the
  version n8n 2.38.6 ships. Round 7 ran the working tree with the three warnings added that day,
  reinstalled the same way.
- Every workflow was created through n8n's public API and executed with `n8n execute`, so each
  run is a real n8n execution with a stored result; outputs were read back from n8n's execution
  store and decoded with n8n's own `flatted`, item by item, `pairedItem` included.
- Circuits were transpiled with Qiskit 2.2.3 against the coupling map and basis of the chosen
  device, and the ideal outcome of every algorithm was computed from the statevector before the
  job was sent, so a measured distribution is judged against a number, not a guess.
- The device was chosen with **Backend > Get Least Busy** at the start: `ibm_kingston` with a
  queue of 0. Its results turned out far noisier than `ibm_marrakesh` the same day, which was
  checked with the same circuit on both, so algorithms ran on `ibm_marrakesh` and the deep-shot
  runs on `ibm_kingston`.
- The instance cost limit was 600 seconds at the start; round 5 raised it to 2000 through
  **Account > Set Cost Limit**, read it back, and the seven rounds ended at 1179 of those 2000;
  round 8 ended at 1209, and on 2026-09-11 the limit was set back to 600 through the same
  operation and read back as 600.
- Round 8 added an OpenAI credential, `gpt-4.1-mini` behind n8n's AI Agent node, for the agent
  cases, and a second n8n, 2.35.7 on Node 22.23.2, the oldest line the README names, installed
  on its own port from the same tarball with the same IBM credential.

### Round 1, 18:44 to 18:53 UTC: every read operation, the hardening probes, the edge cases

- 37 read operations, one workflow each, every output checked against its documented shape:
  37 of 37 match, 0 violations. The 11 Get Results reads covered every result encoding the node
  reads, on real jobs from the account: plain Sampler (100 pubs, every `sum(counts) == shots`),
  plain Estimator, Noise Learner in both envelopes, the serialised Qiskit encoding (12 pubs), the
  Executor and flat learner array encodings, the empty body (`resultsAvailable: false`), the body
  IBM writes with a bare `Infinity` (`resultsUnreadable`), and a failed and a cancelled job, both
  in the terminal shape with `reasonCode`.
- 15 live probes, one per hardening finding of 0.6.0, each asserting the fixed behaviour against
  the live API: 15 of 15 pass. Among them, an unreadable tag list is refused and the real job's
  tags survive; a 200,000 blank line circuit submits in 3.6 seconds; a bad Register Name keeps the
  downloaded result; Get Logs returns a string; Workload Return All returns 283 workloads with 283
  distinct ids.
- 20 edge cases at the input bounds: 20 of 20 behave as specified. Shots 10,000,001 refused
  locally, 10,000,000 accepted and cancelled by IBM under a 1 second cost cap; 87 character tag,
  nine tags, 101 character calibration id, 40 character session id, unknown Additional Options key,
  non-object options, invalid observables, resilience level 9, empty circuit, headerless circuit,
  path traversal in a backend name and in a job id, unknown job, malformed workload cursor, cost
  limit 0, unknown Session Mode, unknown Circuit Format, each refused with the documented message.

### Round 2, 18:54 to 18:57 UTC: real submissions, writes, the session lifecycle

25 steps, every output matching its documented shape. Nine jobs on `ibm_kingston`: a Bell state
at 4096 shots, GHZ on 5 qubits, a 7 qubit circuit of 4 layers, an Estimator at resilience 2 with
three observables, a Noise Learner, a Sampler carrying all four option collections at once, a job
with three circuits, and a parametrised `rx(theta)` bound through **Parameters**. Eight completed
with `sum(counts) == shots` on every pub; the ninth was submitted into a batch session that the
same round then closed while the job was still queued, and it failed with code 1217, "Session has
been closed", which is what the documentation says Close does. Get Status, Get Metrics and Get
Logs read the fresh jobs; Update Tags set two tags, read them back through Get Status, and
restored the original; a throwaway job was cancelled, read back as Cancelled, deleted, and then
answered "Job not found". Session Create, Get, Set Accepting and Close ran in order, and a
Dedicated session on the Open plan was refused by IBM with "You are not authorized to run a
session when using the open plan", as documented.

### Round 3, 18:57 to 19:01 UTC, triggers read at 19:03: workflows, items, triggers

- A nine node pipeline: Get Least Busy, Split Out over the three candidates, Get Status per
  candidate (three items, `pairedItem` 0, 1, 2), Filter, Set, Limit, Submit, Get Results. Every
  node succeeded and the Bell state came back with 512 of 512 shots.
- Continue on Fail with four items, two of them unknown job ids: all four items came back,
  the two bad ones carrying `error`, `pairedItem` aligned 0 to 3.
- The same Bell circuit on `ibm_marrakesh`: 00 and 11 in 97.3 per cent of 2048 shots, against
  71 per cent on `ibm_kingston` an hour earlier, which settles that the difference is the device.
- An untranspiled circuit (`h`, `cx`) was warned about at submit time, naming the device's basis,
  and failed at IBM with code 1517 as the warning said it would.
- A heavy job read at once with Max Wait 1 returned the documented `timedOut` shape,
  `{ jobId, status: "running", timedOut: true, job }`.
- Three items each carrying its own circuit and tag, submitted through expressions: three jobs,
  `pairedItem` 0, 1, 2, all three completed.
- Both polling triggers activated with a one minute poll: the job trigger caught 8 jobs that
  completed after activation across three polls, 8 distinct, 0 duplicates; the error trigger
  caught the two failures of the round, codes 1603 and 1517. Every emitted item matched the
  documented trigger shape.

### Round 4, submitted 19:04 UTC, read 19:09 to 19:10

Algorithms, deep shots, sweeps, a workflow that compares mitigation.

On `ibm_marrakesh` unless stated, 4096 shots unless stated, each against the ideal computed from
the statevector.

| test | result |
| --- | --- |
| Bernstein-Vazirani, secret 1011 | `1011` in 91.0 per cent of shots (ideal 100) |
| Deutsch-Jozsa, balanced oracle | `011` in 93.8 per cent (ideal 100) |
| GHZ on 8 qubits | `00000000` plus `11111111` in 79.2 per cent (ideal 100) |
| Bell at 100,000 shots on `ibm_kingston` | 100,000 of 100,000 samples counted, 700 KB result body |
| 20 circuits in one job, `rx(k pi/10)` sweep | 20 pubs, every `sum(counts) == shots`, largest deviation from the ideal P(1) 0.018 |
| Estimator sweep, four items with theta 0, pi/3, pi/2, pi bound through an expression per item | four jobs, `pairedItem` 0 to 3, expectation values within 0.036 of theory for ZZ, ZI, XX at every theta |
| Bernstein-Vazirani built with **Circuit > Build** from the palette alone, `sx`, `rz`, `cz` on coupled qubits, no transpiler | 32 instructions, no warning, secret `11` in 97.2 per cent |
| Mitigation comparison: three Estimator nodes at resilience 0, 1 and 2 into Merge and Code | resilience 0 within 0.045 of theory, resilience 1 within 0.011, resilience 2 failed with code 1519 (below) |
| A trigger with **Tag** set to one tag, activated before the submissions | emitted exactly the one job carrying that tag |

Two jobs failed with code 1517 before reaching the device: Grover and a QFT round trip, both
carrying `rzz(-pi/2)` written by Qiskit when transpiling against a bare `basis_gates` list. That
became the second finding below.

### Round 5, 19:09 to 19:16 UTC: the heavy round

| test | result |
| --- | --- |
| **Account > Set Cost Limit** 600 to 2000, read back with Get Instance | 2000 |
| Grover on 4 qubits, depth 332, 121 `cz` | failed, code 1517, `rzz(-0.39)` from the same transpile shape |
| Bell submitted as QPY (`circuitFormat: qpy`) | completed, 98.6 per cent in 00 and 11 |
| 100 circuits in one job, `rx(k pi/50)`, 2048 shots each | 100 pubs, every sum right, largest deviation from ideal 0.038, 1.4 MB result body |
| Bell at 1,000,000 shots on `ibm_kingston` | 1,000,000 of 1,000,000 counted, 6.8 MB result body, read through n8n in one item |
| Two parameters bound by name, then positionally as `[alpha, beta]` | the same distribution, P(1) 0.006 and 0.004, so positional binding follows the alphabetical order the documentation states |
| Two classical registers `c` and `meas`, read with Register Name empty, `c`, `meas`, `nope` | auto picks `c`; `meas` returns its own 1 bit; `nope` falls back to `c` with `requestedRegister`, `registerFallback: true` and `registerError` naming both registers |
| Dynamic circuit: measure, `if (c[0]) x`, measure | completed, the two bits equal in 98.9 per cent of 4096 shots |
| Estimator at resilience 2 on a 4 qubit ansatz with six observables | failed, code 1501: the transpiled circuit spans five physical qubits and four-character observables do not match; documented as a pitfall |
| Noise Learner, 5 qubits, two layers, 64 randomisations | failed, code 1519, "Gate twirling does not support fractional gates"; the third finding below |
| A batch done in order: Create, three jobs in, Set Accepting false, results, Close | all three jobs completed, session read back `closed` |
| A job cancelled while queued, with a `failedOrCanceled` trigger active | the trigger emitted it as Cancelled with `reason` null, and the three failed jobs of the round with their codes |
| Get Many filtered by tag, by backend with Created After, by session id | 3 of 3 tagged, 18 of 18 on the backend, 3 of 3 in the session |
| Workload Get Many filtered by mode with two pages through Next Cursor | two disjoint pages, every workload in batch mode |

### Round 6, 19:17 to 19:23 UTC: the retries

Grover transpiled without `rzz`, so that Qiskit writes the interaction with `cz` and `rz`: on 3
qubits the marked state `101` came back in 79.0 per cent of 8192 shots against 12.5 for a uniform
answer, on 4 qubits `1101` in 39.0 per cent against 6.25, on a circuit of depth 283 with 113 `cz`.
The Noise Learner transpiled without fractional gates completed with two learned layers over five
qubits, 51 generators each.

### Round 7, 19:24 to 19:31 UTC: the fixes, live, on the reinstalled build

The three warnings added that day, run against the node reinstalled from the working tree:

- a bare `xslow` on `ibm_kingston`: warned, naming `gate 'xslow' is not defined`;
- the Grover circuit with `rzz(-pi/2)`: warned, naming the angles `-pi/2, -pi/4`;
- a Noise Learner circuit with `rzz`: warned, "gate twirling is on through the noise learner,
  which always twirls";
- an Estimator at resilience 2 on a circuit with `rx`: warned, naming Resilience Level 2;
- a Sampler with the Gate Twirling toggle on a circuit with `rx`: warned, naming Gate Twirling;
- three circuits with no fractional gate, under Gate Twirling, resilience 2 and the Noise Learner:
  no warning, so the check has no false positive.

Then the 15 hardening probes again, 15 of 15, and the 37 read operations again, 37 of 37 matching
their documented shapes.

### Round 8, 19:58 to 20:30 UTC: the extended matrix, an AI agent, restarts, an older n8n

Run after the seven rounds above, on the same instance, once the fixes were in. 15 jobs, 30 QPU
seconds, every one tagged `n8n-r8`, `n8n-r8c`, `n8n-r8c2` or `n8n-smoke235`.

- **The extended matrix, 48 steps, 19:58 to 20:00.** Get Least Busy ranked by queue length and by
  each of the three wait estimates, which the Open plan answers with `null`, so all four fell back
  to the queue and named `ibm_fez`; a minimum of 200 qubits and a Nighthawk family filter each
  returned no candidate rather than an error. Workload Get Many paged forward twice and back once,
  and the page reached through Previous Cursor was the first page again; the status, created
  after, search and sort filters each returned what they asked for. Analytics with a backend
  filter, with a date range, grouped by backend, instance, plan and user, and by date; Get Many
  Instances with a plan filter and with Return All; Get Account Configuration with a plan filter;
  List Tags with a search that matches nothing. A calibration id on Backend > Get Configuration
  was refused by IBM with the plan message, as on 2026-09-07. Set Cost Limit with Clear Limit
  read back 600, the plan default, not null, which corrected the documentation; the limit was
  restored to 2000; a foreign CRN was refused by IBM and a malformed one locally. A session asking
  for `maxTtl` 28800 was created with 600, the Open plan's cap; Get and Close on a session id that
  does not exist both answered "Session not found". A QPY circuit went through Submit Estimator
  and Submit Noise Learner with no local warning and both failed at IBM, 1501 and 1519, because
  the submit checks read OpenQASM text and a QPY circuit is opaque to them, which the
  documentation now says. A Private job hid its `params` on Get Status, returned its counts on
  the first Get Results, 256 of 256 shots, and `resultsAvailable: false` on the second. A 50,000
  shot job was cancelled while IBM reported it Running and read back Cancelled; the 4096 shot
  Bell job of round 2 was deleted and then answered "Job not found", which is why the account
  lists one job fewer than it did at 19:31.
- **Version 1 nodes, 20:00.** Nine workflows saved the way 0.5.0 stores them, `typeVersion: 1`
  with the old parameter name `mode` on Session Create: Get Least Busy, Get Usage, a batch session
  created through `mode` and closed, a 128 shot Sampler and its results, Circuit Build, Job Get
  Many, every one succeeded, and `mode: nonsense` was refused with the Session Mode message, so
  the guard applies to version 1 too. A workflow holding a version 1 node and a version 2 node in
  one graph ran both.
- **An AI agent driving the Tool node, 20:04 to 20:05.** Five workflows with n8n's AI Agent node
  over `gpt-4.1-mini` and the IBM Quantum Tool node on its `ai_tool` connection, judged from the
  tool outputs stored on that connection, not from the agent's prose: a fixed Get Least Busy tool,
  called once, answered `ibm_fez`; a Get Status tool whose Job ID is a `$fromAI` expression was
  called once with the id extracted from the question and answered Completed; two tools in one
  question, Get Usage and Get Least Busy, were both called once, 1189 QPU seconds and `ibm_fez`; a
  chain the agent drove itself, Get Least Busy, then Submit Sampler on the backend it chose, then
  Get Results, ran a 64 shot Bell state on `ibm_fez` and reported 00 in 34 and 11 in 27 shots; and
  a Get Status tool given a job id that does not exist passed "Job not found" to the agent, which
  reported it and invented nothing.
- **Three executions at once, 20:06.** Job Get Many with Return All, Backend Get Properties and
  Get Usage in three n8n processes started in the same second: 318 jobs, 156 qubits and the usage
  figure, each in its own execution, nothing crossed over.
- **Jobs to Scan smaller than the burst, 20:06 to 20:10.** A trigger with Jobs to Scan 2 and a
  one minute poll, seeded, then five 32 shot jobs submitted within ten seconds; all five finished
  inside one poll interval, and the poll fired the two newest. The window is the parameter, which
  the documentation now says.
- **An n8n restart with an active trigger, 20:19 to 20:29.** A trigger with Jobs to Scan 50 was
  activated and seeded 31 job ids into its static data; n8n was stopped; with n8n down, a job was
  submitted through `n8n execute` and ran to completion; n8n was started again with debug logging
  on. Its first poll, the activation poll at 20:27:41, fired one execution holding exactly the
  three jobs that had completed since the seed, that one and the two the 2.35.7 instance had sent
  in the meantime; the two cron polls that followed fired nothing; the stored set grew from 31 to
  34 and none of the seeded ids fired. A first attempt at 20:09 to 20:13 was inconclusive, not
  failed: its window closed 23 seconds after the job finished, before n8n's cron, which polls at a
  random second of each minute, had run again.
- **n8n 2.35.7 on Node 22.23.2, 20:21 to 20:30.** All four node types registered, the error
  trigger hidden; Get Least Busy, Get Usage, a Submit to Get Results chain with 32 of 32 shots, Get
  Status, the local shots guard, a version 1 Get Least Busy, a version 1 session created through
  `mode` and closed, Continue on Fail turning "Job not found" into an item with `pairedItem`; and a
  trigger activated with a one minute poll, seeded with 31 ids, which fired a new job exactly once
  and nothing else.

### What the day found

1. **`xslow`.** On 2026-09-08 the three Heron devices listed `cz, id, rx, rz, rzz, sx, x`; on
   2026-09-10 all three list `xslow` as well. A bare `xslow $0;` was accepted, queued and failed
   with code 1603, "gate 'xslow' is not defined", with no warning: the gate is in the basis, and
   the definition check was written for `rzz` by name. The check now covers every basis gate
   `stdgates.inc` does not define.
2. **`rzz` outside `[0, pi/2]`.** Qiskit transpiling against a bare `basis_gates` list writes
   `rzz` with any angle; IBM's fractional `rzz` runs `[0, pi/2]` only and fails the job after
   queueing with code 1517. Grover and QFT both failed that way with no warning. A warning now
   reads every numeric `rzz` angle at submit time.
3. **A fractional gate where twirling is on.** IBM refuses `rx` or `rzz` wherever gate twirling
   runs, code 1519, and twirling runs through Resilience Level 2, PEC and always through the Noise
   Learner, not only through the toggle. Two jobs failed that way with no warning. A warning now
   names the gates and what turned twirling on.
4. **Observables and layout**, code 1501: observables written for the logical circuit do not match
   a transpiled one that spans more physical qubits. Documented, with `apply_layout` as the fix.
5. **Code 1217** for a job still queued when Close runs, and the correct batch order that avoids
   it. Documented.
6. **`ibm_kingston` on that day** returned 71 per cent on a Bell state where `ibm_marrakesh`
   returned 97 with the same circuit and the same code path, and 85 per cent on a single `x`. The
   node reports what the device returns; Get Least Busy ranks by queue, as documented, and the
   least busy device can be the worst one.
7. **Clear Limit reads back the plan default.** After Clear Limit, `instanceLimitSeconds` is 600
   on the Open plan, not null; the documentation said null and now says what IBM returns.
8. **QPY is opaque to the submit checks.** The ISA, identity, `rzz` angle and twirling checks read
   OpenQASM text. A QPY circuit with `rx` under the Noise Learner failed with 1519, and a QPY
   Estimator whose 2 qubit observables met a 156 qubit layout failed with 1501, both with no
   warning. Documented as a property of the format, with the OpenQASM path as the way to be warned.
9. **Jobs to Scan is a window.** Five jobs finishing inside one poll interval with the parameter
   at 2 fired the two newest. Documented, with the default of 50 as the reason it rarely shows.

Everything the node was promised to do it did: no output diverged from its documented shape in 99
shape checks, every local bound refused before the request, Job Get Many with Return All walking
two pages for 313 jobs with every id distinct, every warning it already had predicted the failure
IBM then returned, and the three warnings it lacked were added and verified live the same day.
Round 8 found no defect: the trigger's state survived an n8n restart, an AI agent drove the Tool
node end to end, workflows saved by 0.5.0 ran unchanged, and the same tarball behaved the same on
n8n 2.35.7 with Node 22 as on 2.38.6.

## Every job through the node

Columns: created (UTC), job id, backend, program, shots per circuit for the Sampler, precision for
the Estimator, randomisations x shots for the Noise Learner, number of circuits, final status,
reason code when IBM gave one, QPU seconds, tags. Jobs submitted by the 2026-09-10 rounds carry an
`n8n-r1` to `n8n-r6`, `n8n-verify`, `n8n-r8`, `n8n-r8c`, `n8n-r8c2` or `n8n-smoke235` tag naming the
round; earlier campaigns tagged fewer jobs.

| date | time | job | backend | program | shots | circuits | status | code | QPU s | tags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-24 | 19:39:19 | `d8u34pstqbtc73d16dog` | ibm_kingston | sampler | 512 | 1 | Completed |  | 2 |  |
| 2026-06-24 | 19:39:20 | `d8u34ptbh0os73eqdiu0` | ibm_kingston | estimator | precision | 1 | Completed |  | 12 |  |
| 2026-06-24 | 19:41:00 | `d8u35j5bh0os73eqdk60` | ibm_fez | sampler | 1024 | 1 | Failed | 1517 | 2 |  |
| 2026-06-24 | 19:55:26 | `d8u3cbkbp3hs7385chig` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-06-24 | 19:55:33 | `d8u3cddbh0os73eqds0g` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-06-24 | 20:10:25 | `d8u3jcdposuc738pi3e0` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-06-24 | 20:12:03 | `d8u3k4stqbtc73d16ukg` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-06-24 | 20:12:16 | `d8u3k84bp3hs7385cqm0` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-06-24 | 20:24:47 | `d8u3q3tposuc738picn0` | ibm_marrakesh | sampler | 1024 | 1 | Failed | 1517 | 2 |  |
| 2026-06-26 | 11:46:15 | `d8v6d1opknjs73a0d3tg` | ibm_kingston | sampler | 256 | 1 | Completed |  | 2 |  |
| 2026-06-26 | 11:52:16 | `d8v6fs1ropqc738bp26g` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-06-26 | 11:53:18 | `d8v6gbhropqc738bp350` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-06-26 | 20:00:24 | `d8vdkm06c68s73agf1ag` | ibm_kingston | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-06-30 | 16:46:55 | `d91v5vr57qjs73b74dh0` | ibm_fez | sampler | 256 | 1 | Completed |  | 2 |  |
| 2026-07-01 | 03:59:04 | `d929127qq29s738otqig` | ibm_fez | estimator | precision | 1 | Completed |  | 12 |  |
| 2026-08-02 | 13:38:45 | `d9nkgpcsfqic73ar5av0` | ibm_kingston | sampler | 256 | 1 | Completed |  | 2 | qa-audit,retagged |
| 2026-08-02 | 13:40:26 | `d9nkhik60llc73ca7810` | ibm_kingston | estimator | precision | 1 | Completed |  | 12 |  |
| 2026-08-02 | 13:43:11 | `d9nkirksfqic73ar5d20` | ibm_kingston | sampler | 16 | 1 | Failed | 1506 | 2 |  |
| 2026-08-02 | 13:46:31 | `d9nkkdssfqic73ar5er0` | ibm_kingston | sampler | 512 | 1 | Completed |  | 2 | qa-wide |
| 2026-08-02 | 13:47:30 | `d9nkksk60llc73ca7bmg` | ibm_kingston | sampler | 256 | 1 | Completed |  | 2 | qa-tworeg |
| 2026-08-02 | 13:47:47 | `d9nkl0gqs0bc73e3i0q0` | ibm_kingston | sampler |  | 0 | Completed |  | 2 | qa-options |
| 2026-08-02 | 13:47:57 | `d9nkl3csfqic73ar5fg0` | ibm_kingston | sampler | 512 | 1 | Failed | 1517 | 2 | qa-isa |
| 2026-08-02 | 13:49:14 | `d9nklmk60llc73ca7ct0` | ibm_kingston | sampler | 128 | 1 | Completed |  | 2 | qa-isolate |
| 2026-08-02 | 13:49:15 | `d9nklms60llc73ca7cug` | ibm_kingston | sampler | 128 | 1 | Completed |  | 2 | qa-isolate |
| 2026-08-02 | 13:49:16 | `d9nkln460llc73ca7cv0` | ibm_kingston | sampler | 128 | 1 | Failed | 1517 | 2 | qa-isolate |
| 2026-08-02 | 13:50:39 | `d9nkmboqs0bc73e3i3cg` | ibm_kingston | estimator | precision | 1 | Completed |  | 11 | qa-est-array |
| 2026-08-02 | 13:50:39 | `d9nkmbs60llc73ca7e90` | ibm_kingston | estimator | precision | 1 | Completed |  | 11 | qa-est-map |
| 2026-08-02 | 13:51:13 | `d9nkmkc60llc73ca7epg` | ibm_kingston | sampler | 128 | 1 | Completed |  | 2 | qa-param |
| 2026-08-02 | 13:51:25 | `d9nkmncsfqic73ar5ihg` | ibm_kingston | sampler | 128 | 1 | Completed |  | 2 | qa-session-job |
| 2026-08-02 | 13:51:26 | `d9nkmngqs0bc73e3i450` | ibm_kingston | sampler | 128 | 1 | Completed |  | 2 | qa-session-job |
| 2026-08-02 | 13:52:31 | `d9nkn7oqs0bc73e3i53g` | ibm_kingston | sampler | 4096 | 1 | Completed |  | 3 | qa-bigpayload |
| 2026-08-02 | 13:59:05 | `d9nkqacsfqic73ar5o0g` | ibm_kingston | sampler | 256 | 1 | Completed |  | 2 | qa-idfix |
| 2026-08-02 | 14:02:20 | `d9nkrqssfqic73ar5pgg` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | qa-marrakesh |
| 2026-08-02 | 14:04:23 | `d9nkspssfqic73ar5qe0` | ibm_marrakesh | estimator | precision | 1 | Completed |  | 12 | qa-vqe-sweep |
| 2026-08-02 | 14:05:51 | `d9nktfoqs0bc73e3id5g` | ibm_marrakesh | sampler | 2048 | 1 | Completed |  | 3 | qa-bell-native |
| 2026-08-02 | 14:10:32 | `d9nkvm4sfqic73ar5t5g` | ibm_kingston | sampler | 2048 | 1 | Failed | 1506 | 2 | qa-rzz-pi |
| 2026-08-02 | 14:10:33 | `d9nkvmcsfqic73ar5t60` | ibm_kingston | sampler | 2048 | 1 | Failed | 1506 | 2 | qa-rzz-half |
| 2026-08-02 | 14:11:36 | `d9nl060qs0bc73e3ifvg` | ibm_kingston | sampler | 512 | 1 | Completed |  | 2 | qa-rzz-control |
| 2026-08-02 | 14:17:26 | `d9nl2tk60llc73ca7v1g` | ibm_kingston | sampler | 8192 | 1 | Completed |  | 4 | qa-ghz12-qiskit |
| 2026-08-02 | 14:19:27 | `d9nl3rssfqic73ar622g` | ibm_kingston | sampler | 20000 | 1 | Failed | 1519 | 2 | qa-ghz40 |
| 2026-08-02 | 14:20:04 | `d9nl450qs0bc73e3ikm0` | ibm_kingston | sampler | 15000 | 1 | Completed |  | 6 | qa-ghz40 |
| 2026-08-02 | 14:21:24 | `d9nl4p4sfqic73ar6310` | ibm_kingston | sampler | 25000 | 1 | Completed |  | 9 | qa-ghz80-max |
| 2026-08-02 | 14:22:19 | `d9nl56ssfqic73ar63fg` | ibm_kingston | sampler | 45000 | 1 | Completed |  | 14 | qa-ghz80-max |
| 2026-08-06 | 20:38:08 | `d9qf1c0pdb6s73e3flig` | ibm_kingston | sampler | 1024 | 1 | Failed | 1517 | 2 | qrng,n8n |
| 2026-08-17 | 19:37:58 | `da1m65mg52gs73clqlcg` | ibm_kingston | sampler | 256 | 1 | Cancelled |  | 0 | n8n-probe-fullwidth |
| 2026-08-17 | 19:37:59 | `da1m65ug52gs73clqld0` | ibm_kingston | sampler | 256 | 1 | Cancelled |  | 0 | n8n-probe-narrow |
| 2026-08-17 | 19:53:14 | `da1mdaiein7c73bdjmbg` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | quantum-watchtower |
| 2026-08-17 | 20:43:00 | `da1n4l6g52gs73clrpq0` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | quantum-watchtower |
| 2026-08-17 | 21:10:52 | `da1nhn4dedkc73er90jg` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | quantum-watchtower |
| 2026-08-17 | 21:13:47 | `da1nj2ug52gs73clsa10` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | quantum-watchtower |
| 2026-08-17 | 21:19:30 | `da1nlom3kjvs7386vgng` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | quantum-watchtower |
| 2026-08-17 | 21:22:23 | `da1nn3qein7c73bdl4gg` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | quantum-watchtower |
| 2026-08-18 | 06:00:44 | `da1va363kjvs73878k90` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | quantum-watchtower |
| 2026-08-18 | 12:27:06 | `da24v6iein7c73be57eg` | ibm_kingston | sampler | 256 | 1 | Completed |  | 2 | faza2,sampler |
| 2026-08-18 | 12:27:10 | `da24v7iein7c73be57fg` | ibm_kingston | estimator | precision | 1 | Completed |  | 12 | faza2,estimator |
| 2026-08-18 | 12:27:14 | `da24v8m3kjvs7387fm9g` | ibm_kingston | sampler | 256 | 1 | Failed | 1603 | 0 | faza2,qpy |
| 2026-08-18 | 12:27:18 | `da24v9mg52gs73cmchl0` | ibm_kingston | sampler | 256 | 1 | Cancelled |  | 0 | faza2,cancel |
| 2026-08-18 | 12:35:08 | `da252v6g52gs73cmclig` | ibm_kingston | sampler | 256 | 1 | Completed |  | 2 | faza2,qpy |
| 2026-08-19 | 20:02:40 | `da30no3otlns73993h50` | ibm_kingston | sampler | 1 | 1 | Failed | 1603 | 0 | audit-invalid-circuit |
| 2026-08-19 | 21:39:54 | `da325amaa69c739i3lrg` | ibm_kingston | sampler | 1 | 1 | Cancelled |  | 0 | audit-err |
| 2026-08-20 | 07:50:22 | `da3b3fm1vhnc73fjjumg` | ibm_kingston | sampler | 1 | 1 | Cancelled |  | 0 | audit-isa-warning |
| 2026-08-20 | 08:38:39 | `da3bq3s3jnrc73aes3ng` | ibm_kingston | sampler | 128 | 1 | Completed |  | 2 | audit-live,ok |
| 2026-08-20 | 08:38:40 | `da3bq443jnrc73aes3o0` | ibm_kingston | sampler | 1 | 1 | Cancelled |  | 0 | audit-live,bad |
| 2026-08-21 | 13:59:22 | `da45jem1vhnc73fkj6t0` | ibm_marrakesh | sampler | 4096 | 1 | Completed |  | 3 | demo,bell-state |
| 2026-08-21 | 18:21:39 | `da49ecrotlns739aire0` | ibm_marrakesh | sampler | 128 | 1 | Completed |  | 2 | qa21aug,sampler |
| 2026-08-21 | 18:21:41 | `da49edeaa69c739jh5ag` | ibm_marrakesh | estimator | precision | 1 | Completed |  | 3 | qa21aug,estimator |
| 2026-08-21 | 18:21:44 | `da49ee43jnrc73afv1g0` | ibm_marrakesh | sampler | 16 | 1 | Failed | 1603 | 0 | qa21aug,invalid |
| 2026-08-21 | 18:21:46 | `da49eem1vhnc73fknn5g` | ibm_kingston | sampler | 16 | 1 | Cancelled |  | 0 | qa21aug,anulat |
| 2026-08-21 | 18:21:50 | `da49efk3jnrc73afv1ig` | ibm_kingston | noise-learner | 1x10 | 1 | Cancelled |  | 0 | qa21aug,noise |
| 2026-08-21 | 18:40:43 | `da49nauaa69c739jhigg` | ibm_fez | noise-learner | 1x10 | 1 | Completed |  | 2 | qa21aug,noiselearner-real |
| 2026-08-21 | 22:10:22 | `da4cpjjotlns739amu6g` | ibm_fez | noise-learner | 1x10 | 1 | Completed |  | 2 | qa22aug,nl-dupa-fix |
| 2026-08-21 | 22:10:25 | `da4cpkeaa69c739jl6e0` | ibm_fez | sampler | 128 | 1 | Completed |  | 2 | qa22aug,sampler-dupa-fix |
| 2026-08-21 | 22:10:27 | `da4cpkuaa69c739jl6f0` | ibm_fez | estimator | precision | 1 | Completed |  | 3 | qa22aug,estimator-dupa-fix |
| 2026-08-22 | 04:16:39 | `da4i59uaa69c739jr4g0` | ibm_fez | sampler | 4096 | 1 | Completed |  | 3 | qa22aug,bell-isa-4096 |
| 2026-08-22 | 04:17:00 | `da4i5f6aa69c739jr4l0` | ibm_fez | noise-learner | 1x10 | 1 | Failed |  | 2 | qa22aug,nl-doua-straturi |
| 2026-08-22 | 04:29:08 | `da4ib561vhnc73fl1tmg` | ibm_fez | noise-learner | 1x10 | 1 | Completed |  | 2 | qa22aug,nl-doua-straturi-fara-registru |
| 2026-08-22 | 04:32:45 | `da4icreaa69c739jrct0` | ibm_fez | sampler | 60000 | 1 | Cancelled | 1305 | 2 | qa22aug,maxcost-taiere |
| 2026-08-22 | 04:33:42 | `da4id9jotlns739at3gg` | ibm_fez | estimator | precision | 1 | Completed |  | 3 | qa22aug,reziliente-0 |
| 2026-08-22 | 04:33:43 | `da4id9s3jnrc73ag97c0` | ibm_fez | estimator | precision | 1 | Completed |  | 12 | qa22aug,reziliente-1 |
| 2026-08-22 | 04:33:44 | `da4id9s3jnrc73ag97d0` | ibm_fez | estimator | precision | 1 | Completed |  | 14 | qa22aug,reziliente-2 |
| 2026-08-22 | 04:37:24 | `da4if0u1vhnc73fl21u0` | ibm_fez | sampler | 16 | 1 | Completed |  | 2 | qa22aug,fara-plafon |
| 2026-08-22 | 04:37:24 | `da4if161vhnc73fl21ug` | ibm_fez | sampler | 16 | 1 | Failed | 1506 | 2 | qa22aug,rzz |
| 2026-08-22 | 04:37:25 | `da4if1e1vhnc73fl21v0` | ibm_fez | sampler | 100 | 1 | Failed | 1519 | 2 | qa22aug,twirl-gates |
| 2026-08-22 | 04:37:26 | `da4if1k3jnrc73ag9970` | ibm_fez | sampler | 100 | 1 | Completed |  | 2 | qa22aug,dd-twirl-masura |
| 2026-08-22 | 04:40:07 | `da4ig9u1vhnc73fl23c0` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | qa22fin,trigger-final |
| 2026-08-22 | 05:49:57 | `da4jh1e1vhnc73fl377g` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | qa22h,sesiune-job1 |
| 2026-08-22 | 05:49:58 | `da4jh1eaa69c739jskg0` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | qa22h,sesiune-job2 |
| 2026-08-22 | 05:51:18 | `da4jhlm1vhnc73fl381g` | ibm_fez | sampler | 128 | 1 | Completed |  | 2 | qa22h,lat-20q |
| 2026-08-22 | 05:51:19 | `da4jhls3jnrc73agaf10` | ibm_fez | sampler | 128 | 1 | Completed |  | 2 | qa22h,parametrizat |
| 2026-08-22 | 05:51:19 | `da4jhlrotlns739aub20` | ibm_fez | estimator | precision | 1 | Completed |  | 4 | qa22h,trei-observabile |
| 2026-08-22 | 05:51:20 | `da4jhm3otlns739aub30` | ibm_fez | estimator | precision | 1 | Completed |  | 2 | qa22h,precizie |
| 2026-08-22 | 05:51:21 | `da4jhm3otlns739aub40` | ibm_fez | sampler | 128 | 1 | Completed |  | 2 | qa22h,qpy-complet |
| 2026-08-22 | 05:51:22 | `da4jhmc3jnrc73agaf20` | ibm_fez | sampler | 32 | 1 | Completed |  | 2 | qa22h,log-debug |
| 2026-08-22 | 05:51:23 | `da4jhmmaa69c739jsl8g` | ibm_fez | sampler |  | 0 | Failed | 1515 | 2 | qa22h,privat |
| 2026-08-22 | 05:51:23 | `da4jhmu1vhnc73fl382g` | ibm_fez | sampler | 32 | 1 | Completed |  | 2 | qa22h,optiuni-extra |
| 2026-08-22 | 05:52:57 | `da4jieeaa69c739jsm80` | ibm_fez | sampler |  | 0 | Completed |  | 2 | qa22h,privat-corect |
| 2026-08-22 | 05:52:58 | `da4jiek3jnrc73agaft0` | ibm_fez | sampler | 32 | 1 | Completed |  | 2 | qa22h,public-de-comparat |
| 2026-08-22 | 05:53:58 | `da4jitjotlns739auchg` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | qa22h,expirare |
| 2026-08-22 | 05:54:05 | `da4jive1vhnc73fl39gg` | ibm_kingston | noise-learner | 1x10 | 1 | Cancelled |  | 2 | qa22h,avertisment-registru |
| 2026-08-22 | 06:01:08 | `da4jm943jnrc73agalh0` | ibm_fez | sampler | 100000 | 1 | Completed |  | 28 | qa22greu,o-suta-de-mii |
| 2026-08-22 | 06:03:14 | `da4jn8c3jnrc73agammg` | ibm_fez | sampler | 500000 | 1 | Completed |  | 130 | qa22greu,jumatate-de-milion |
| 2026-08-22 | 06:10:24 | `da4jqk6aa69c739jt190` | ibm_fez | sampler | 30000 | 1 | Completed |  | 10 | qa22adanc,adancime-20 |
| 2026-08-22 | 06:10:26 | `da4jqkk3jnrc73agaqqg` | ibm_fez | sampler | 30000 | 1 | Completed |  | 11 | qa22adanc,adancime-2000 |
| 2026-08-22 | 06:10:30 | `da4jqljotlns739aun70` | ibm_fez | sampler | 30000 | 1 | Completed |  | 24 | qa22adanc,adancime-20000 |
| 2026-08-22 | 08:23:19 | `da4lotm1vhnc73fl5l50` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | qa22log,nivel-debug |
| 2026-08-22 | 08:23:19 | `da4lotu1vhnc73fl5l5g` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | qa22log,nivel-info |
| 2026-08-22 | 08:23:20 | `da4lou61vhnc73fl5l60` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | qa22log,nivel-critical |
| 2026-08-22 | 08:32:34 | `da4lt8e1vhnc73fl5pjg` | ibm_fez | sampler | 256 | 3 | Completed |  | 2 | qa22multi,trei-pub-uri |
| 2026-08-22 | 08:40:12 | `da4m0r43jnrc73agd4t0` | ibm_kingston | noise-learner | 1x10 | 1 | Cancelled |  | 2 | qa22fin2,doua-straturi |
| 2026-08-22 | 08:40:15 | `da4m0rs3jnrc73agd4ug` | ibm_kingston | noise-learner | 1x10 | 1 | Cancelled |  | 2 | qa22fin2,un-strat |
| 2026-08-22 | 14:50:32 | `da4ree61vhnc73flbo6g` | ibm_fez | sampler | 256 | 1 | Completed |  | 2 | qa22sx,sx-de-doua-ori |
| 2026-08-22 | 14:50:32 | `da4ree6aa69c739k5220` | ibm_fez | sampler | 256 | 1 | Completed |  | 2 | qa22sx,sx-o-data |
| 2026-08-22 | 14:55:20 | `da4rgm3otlns739b6rtg` | ibm_fez | sampler | 2048 | 1 | Completed |  | 3 | qa22sx,bell-din-paleta |
| 2026-08-22 | 16:51:49 | `da4t79eaa69c739k6t0g` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | qa22cup,cuplat |
| 2026-08-22 | 16:51:50 | `da4t79k3jnrc73agkmj0` | ibm_fez | sampler | 64 | 1 | Failed | 1517 | 2 | qa22cup,necuplat |
| 2026-08-22 | 16:51:51 | `da4t79s3jnrc73agkmjg` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | qa22cup,un-qubit |
| 2026-08-22 | 16:56:52 | `da4t9l61vhnc73fldm30` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | qa22cup2,departati-cuplati |
| 2026-08-22 | 16:56:54 | `da4t9lk3jnrc73agkp10` | ibm_fez | sampler | 64 | 1 | Failed | 1517 | 2 | qa22cup2,vecini-necuplati |
| 2026-08-22 | 17:03:18 | `da4tclmaa69c739k72hg` | ibm_fez | sampler | 128 | 1 | Completed |  | 2 | qa22par,tablou |
| 2026-08-22 | 17:03:19 | `da4tcluaa69c739k72i0` | ibm_fez | sampler | 128 | 1 | Completed |  | 2 | qa22par,obiect |
| 2026-08-22 | 17:29:52 | `da4tp43otlns739b97qg` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 2 |  |
| 2026-08-22 | 17:30:53 | `da4tpje1vhnc73fle760` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 |  |
| 2026-08-22 | 17:35:10 | `da4trjeaa69c739k7j2g` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 17:35:11 | `da4trjs3jnrc73aglcbg` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 |  |
| 2026-08-22 | 20:03:35 | `da5015rotlns739bbisg` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 2 |  |
| 2026-08-22 | 20:03:36 | `da50163otlns739bbitg` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 0 |  |
| 2026-08-22 | 20:03:38 | `da5016m1vhnc73flgia0` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:39 | `da5016jotlns739bbiu0` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 2 |  |
| 2026-08-22 | 20:03:40 | `da50176aa69c739k9rc0` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:41 | `da5017eaa69c739k9rcg` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 2 |  |
| 2026-08-22 | 20:03:42 | `da5017m1vhnc73flgicg` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:43 | `da5017s3jnrc73agnkrg` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:44 | `da50186aa69c739k9rf0` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:46 | `da5018m1vhnc73flgieg` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 0 |  |
| 2026-08-22 | 20:03:46 | `da5018jotlns739bbj0g` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 2 |  |
| 2026-08-22 | 20:03:47 | `da5018uaa69c739k9rh0` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 0 |  |
| 2026-08-22 | 20:03:48 | `da501943jnrc73agnktg` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:49 | `da5019eaa69c739k9ri0` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:50 | `da5019jotlns739bbj20` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:51 | `da5019u1vhnc73flgig0` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:51 | `da5019uaa69c739k9rj0` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 0 |  |
| 2026-08-22 | 20:03:52 | `da501a6aa69c739k9rjg` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:53 | `da501abotlns739bbj3g` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:03:54 | `da501amaa69c739k9rl0` | ibm_fez | sampler | 64 | 1 | Failed | 1603 | 0 |  |
| 2026-08-22 | 20:08:50 | `da503kk3jnrc73agnnp0` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:08:52 | `da503l61vhnc73flgl9g` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 |  |
| 2026-08-22 | 20:08:53 | `da503lc3jnrc73agnnqg` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:08:54 | `da503lm1vhnc73flglb0` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 |  |
| 2026-08-22 | 20:08:54 | `da503lk3jnrc73agnnr0` | ibm_fez | sampler | 64 | 1 | Failed | 1506 | 2 |  |
| 2026-08-22 | 20:08:55 | `da503lu1vhnc73flglc0` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 |  |
| 2026-08-22 | 20:10:18 | `da504am1vhnc73flgm30` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 |  |
| 2026-08-22 | 20:10:20 | `da504b61vhnc73flgm3g` | ibm_fez | sampler | 64 | 1 | Failed | 1517 | 2 |  |
| 2026-08-22 | 20:10:21 | `da504beaa69c739k9v30` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 |  |
| 2026-08-30 | 17:24:51 | `daa6eopqtnsc73d29rmg` | ibm_fez | sampler | 4096 | 1 | Completed |  | 3 | n8n-node-test |
| 2026-09-07 | 13:35:38 | `dafbram42tqs73avo60g` | ibm_fez | sampler | 1024 | 1 | Failed | 1517 | 2 | n8n-audit-live |
| 2026-09-07 | 13:36:46 | `dafbrrl1ierc738n5nm0` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 | n8n-audit-live |
| 2026-09-07 | 13:38:28 | `dafbsl5nj4cs73ag5r90` | ibm_marrakesh | sampler | 1024 | 1 | Completed |  | 2 | n8n-audit-chain |
| 2026-09-07 | 13:38:55 | `dafbsru42tqs73avo830` | ibm_marrakesh | sampler | 1024 | 1 | Completed |  | 2 | n8n-audit-live,retagged |
| 2026-09-07 | 13:42:18 | `dafbuejdd5gc73d9kmo0` | ibm_fez | estimator | precision 0.02 | 1 | Completed |  | 12 | n8n-audit-estimator |
| 2026-09-07 | 13:42:45 | `dafbulbdd5gc73d9kmug` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-09-07 | 13:43:53 | `dafbv6dnj4cs73ag5u20` | ibm_fez | sampler | 3000000000 | 1 | Failed | 1520 | 2 |  |
| 2026-09-07 | 13:43:55 | `dafbv6t1ierc738n5rjg` | ibm_fez | sampler | 2147483647 | 1 | Failed | 1520 | 2 |  |
| 2026-09-07 | 13:45:06 | `dafbvojdd5gc73d9ko60` | ibm_fez | sampler | 256 | 1 | Completed |  | 2 | n8n-audit-session |
| 2026-09-07 | 13:45:37 | `dafc00bdd5gc73d9kohg` | ibm_fez | noise-learner | 4x16 | 1 | Completed |  | 4 | n8n-audit-learner |
| 2026-09-07 | 13:48:58 | `dafc1ibdd5gc73d9kq9g` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | n8n-trigger-bait |
| 2026-09-07 | 14:34:50 | `dafcn2lnj4cs73ag6qig` | ibm_fez | sampler | 32 | 1 | Failed | 1517 | 2 |  |
| 2026-09-07 | 14:34:53 | `dafcn3dnj4cs73ag6qk0` | ibm_fez | sampler | 32 | 1 | Failed | 1517 | 2 |  |
| 2026-09-07 | 14:34:56 | `dafcn43dd5gc73d9lko0` | ibm_fez | sampler | 32 | 2 | Completed |  | 2 | n8n-audit-batch |
| 2026-09-07 | 14:35:26 | `dafcnbm42tqs73avp7fg` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | n8n-audit-qpy |
| 2026-09-07 | 14:35:30 | `dafcnclnj4cs73ag6qvg` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 |  |
| 2026-09-07 | 14:35:32 | `dafcnd3dd5gc73d9ll40` | ibm_fez | sampler |  | 0 | Completed |  | 2 |  |
| 2026-09-07 | 14:38:10 | `dafcokjdd5gc73d9lmj0` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-audit-timeout |
| 2026-09-07 | 16:38:29 | `dafeh1bdd5gc73d9o2pg` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 | n8n-shots-regression |
| 2026-09-07 | 16:38:32 | `dafeh1tnj4cs73ag98f0` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 | n8n-shots-regression |
| 2026-09-07 | 16:51:57 | `dafenbd1ierc738n9e3g` | ibm_fez | sampler | 512 | 1 | Completed |  | 2 | n8n-round2-branch |
| 2026-09-07 | 16:52:34 | `dafenkm42tqs73avrtf0` | ibm_fez | sampler | 512 | 1 | Completed |  | 2 |  |
| 2026-09-07 | 16:52:37 | `dafenle42tqs73avrtg0` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-09-07 | 16:52:40 | `dafenm642tqs73avrthg` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 |  |
| 2026-09-07 | 16:52:43 | `dafenmu42tqs73avrti0` | ibm_fez | sampler | 1024 | 1 | Completed |  | 2 |  |
| 2026-09-07 | 16:52:45 | `dafenne42tqs73avrtkg` | ibm_fez | sampler | 1 | 1 | Completed |  | 2 |  |
| 2026-09-07 | 16:52:57 | `dafenqdnj4cs73ag9h70` | ibm_fez | sampler | 32 | 1 | Completed |  | 2 | a,b |
| 2026-09-07 | 16:53:01 | `dafenrbdd5gc73d9obf0` | ibm_fez | sampler | 32 | 1 | Failed | 1503 | 2 |  |
| 2026-09-07 | 16:53:05 | `dafensdnj4cs73ag9h90` | ibm_fez | sampler | 32 | 1 | Completed |  | 2 |  |
| 2026-09-07 | 16:55:10 | `dafeorm42tqs73avrutg` | ibm_fez | sampler | 32 | 1 | Completed |  | 2 | n8n-round2-trig |
| 2026-09-07 | 16:55:13 | `dafeosdnj4cs73ag9i9g` | ibm_fez | sampler | 32 | 1 | Failed | 1517 | 2 | n8n-round2-fail |
| 2026-09-07 | 16:59:35 | `dafeqttnj4cs73ag9keg` | ibm_fez | sampler | 32 | 1 | Completed |  | 2 | n8n-round2-deep |
| 2026-09-07 | 16:59:38 | `dafequjdd5gc73d9oep0` | ibm_fez | sampler | 16 | 100 | Completed |  | 3 | n8n-round2-100 |
| 2026-09-07 | 17:28:40 | `daff8i642tqs73avsepg` | ibm_fez | sampler | 20000 | 30 | Completed |  | 157 | n8n-heavy-confirm |
| 2026-09-08 | 17:01:51 | `dag3uvr9k43c73acrfm0` | ibm_marrakesh | sampler | 1 | 1 | Failed | 1517 | 2 |  |
| 2026-09-08 | 17:08:27 | `dag422j9k43c73acrk50` | ibm_marrakesh | sampler | 4096 | 1 | Completed |  | 3 | n8n-relive-bell |
| 2026-09-08 | 17:08:30 | `dag423hhvn6c73cq3800` | ibm_marrakesh | sampler | 2048 | 1 | Completed |  | 3 | n8n-relive-ghz |
| 2026-09-08 | 17:08:32 | `dag4240mhr3c73e4kk2g` | ibm_marrakesh | sampler | 1024 | 1 | Completed |  | 2 | n8n-relive-deep |
| 2026-09-08 | 17:09:02 | `dag42bhhvn6c73cq38g0` | ibm_marrakesh | estimator | precision | 1 | Completed |  | 18 | n8n-relive-est |
| 2026-09-08 | 17:09:04 | `dag42c7i3e6s738lt620` | ibm_marrakesh | noise-learner | 32x64 | 1 | Completed |  | 36 | n8n-relive-nl |
| 2026-09-08 | 17:09:07 | `dag42cphvn6c73cq38k0` | ibm_marrakesh | sampler | 1024 | 1 | Completed |  | 3 | n8n-relive-allopts |
| 2026-09-08 | 17:09:38 | `dag42kgmhr3c73e4kl5g` | ibm_marrakesh | sampler | 10000000 | 1 | Cancelled | 1305 | 2 |  |
| 2026-09-08 | 17:09:53 | `dag42ob9k43c73acrlkg` | ibm_marrakesh | sampler | 16 | 1 | Completed |  | 2 | n8n-clamp |
| 2026-09-08 | 17:12:20 | `dag43t7i3e6s738lt89g` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | n8n-complex-pipeline |
| 2026-09-08 | 17:12:54 | `dag445hhvn6c73cq3bdg` | ibm_marrakesh | sampler | 256 | 1 | Completed |  | 2 | n8n-relive-session |
| 2026-09-08 | 17:14:16 | `dag44q39k43c73acrof0` | ibm_marrakesh | sampler | 16 | 1 | Cancelled |  | 2 | n8n-isa-warn |
| 2026-09-08 | 17:20:56 | `dag47u1hvn6c73cq3fqg` | ibm_marrakesh | sampler | 1 | 1 | Failed | 1517 | 2 |  |
| 2026-09-08 | 17:22:36 | `dag48mphvn6c73cq3gj0` | ibm_marrakesh | sampler | 10000000 | 1 | Cancelled |  | 2 | n8n-bound |
| 2026-09-08 | 17:22:52 | `dag48r39k43c73acrsjg` | ibm_marrakesh | sampler | 16 | 1 | Cancelled |  | 2 | n8n-clamp |
| 2026-09-08 | 17:23:36 | `dag4967i3e6s738lte5g` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | n8n-complex-pipeline |
| 2026-09-08 | 17:39:05 | `dag4geb9k43c73acs7tg` | ibm_marrakesh | sampler | 256 | 1 | Completed |  | 2 | n8n-trigger-bait-2 |
| 2026-09-08 | 17:40:06 | `dag4gtni3e6s738ltp6g` | ibm_marrakesh | sampler | 32 | 1 | Failed | 1517 | 2 | n8n-error-trigger-bait |
| 2026-09-10 | 18:52:39 | `dahfotvi3e6s738nptrg` | ibm_marrakesh | sampler | 1 | 1 | Failed | 1517 | 2 |  |
| 2026-09-10 | 18:53:10 | `dahfp5j9k43c73aeoa5g` | ibm_marrakesh | sampler | 10000000 | 1 | Cancelled | 1305 | 2 | n8n-bound |
| 2026-09-10 | 18:53:26 | `dahfp9ni3e6s738npuag` | ibm_marrakesh | sampler | 16 | 1 | Completed |  | 2 | n8n-clamp |
| 2026-09-10 | 18:54:40 | `dahfps39k43c73aeoasg` | ibm_kingston | sampler | 2048 | 1 | Completed |  | 3 | n8n-r2-ghz |
| 2026-09-10 | 18:54:44 | `dahfpt39k43c73aeoatg` | ibm_kingston | sampler | 1024 | 1 | Completed |  | 2 | n8n-r2-deep |
| 2026-09-10 | 18:54:46 | `dahfpthhvn6c73crvcs0` | ibm_kingston | estimator | precision | 1 | Completed |  | 18 | n8n-r2-est |
| 2026-09-10 | 18:54:49 | `dahfpu8mhr3c73e6gtag` | ibm_kingston | noise-learner | 32x64 | 1 | Completed |  | 35 | n8n-r2-nl |
| 2026-09-10 | 18:54:51 | `dahfpuomhr3c73e6gtbg` | ibm_kingston | sampler | 1024 | 1 | Completed |  | 2 | n8n-r2-allopts |
| 2026-09-10 | 18:54:54 | `dahfpvgmhr3c73e6gtdg` | ibm_kingston | sampler | 512 | 3 | Completed |  | 3 | n8n-r2-list |
| 2026-09-10 | 18:54:56 | `dahfq07i3e6s738npv5g` | ibm_kingston | sampler | 1024 | 1 | Completed |  | 2 | n8n-r2-param |
| 2026-09-10 | 18:55:24 | `dahfq739k43c73aeob8g` | ibm_kingston | sampler | 256 | 1 | Failed | 1217 | 0 | n8n-r2-session |
| 2026-09-10 | 18:55:39 | `dahfqaphvn6c73crvdb0` | ibm_kingston | sampler | 16 | 1 | Failed | 1603 | 2 | n8n-xslow |
| 2026-09-10 | 18:58:15 | `dahfrhomhr3c73e6gv2g` | ibm_kingston | sampler | 512 | 1 | Completed |  | 2 | n8n-r3-pipeline |
| 2026-09-10 | 18:58:33 | `dahfrmfi3e6s738nq0tg` | ibm_marrakesh | sampler | 2048 | 1 | Completed |  | 3 | n8n-r3-marrakesh |
| 2026-09-10 | 18:58:36 | `dahfrn7i3e6s738nq0ug` | ibm_kingston | sampler | 16 | 1 | Failed | 1517 | 2 | n8n-r3-fail |
| 2026-09-10 | 18:58:39 | `dahfrnphvn6c73crveog` | ibm_kingston | sampler | 8192 | 1 | Completed |  | 4 | n8n-r3-heavy |
| 2026-09-10 | 18:58:45 | `dahfrpb9k43c73aeocvg` | ibm_kingston | sampler | 256 | 1 | Completed |  | 2 | n8n-r3-multi-a |
| 2026-09-10 | 18:58:46 | `dahfrpni3e6s738nq110` | ibm_kingston | sampler | 256 | 1 | Completed |  | 2 | n8n-r3-multi-b |
| 2026-09-10 | 18:58:46 | `dahfrpj9k43c73aeod0g` | ibm_kingston | sampler | 256 | 1 | Completed |  | 2 | n8n-r3-multi-c |
| 2026-09-10 | 19:04:18 | `dahfucgmhr3c73e6h2c0` | ibm_marrakesh | sampler | 4096 | 1 | Completed |  | 3 | n8n-r4-bv |
| 2026-09-10 | 19:04:21 | `dahfud9hvn6c73crvhm0` | ibm_marrakesh | sampler | 4096 | 1 | Completed |  | 3 | n8n-r4-dj |
| 2026-09-10 | 19:04:24 | `dahfue7i3e6s738nq43g` | ibm_marrakesh | sampler | 4096 | 1 | Failed | 1517 | 2 | n8n-r4-grover |
| 2026-09-10 | 19:04:27 | `dahfuer9k43c73aeofvg` | ibm_marrakesh | sampler | 4096 | 1 | Failed | 1517 | 2 | n8n-r4-qft |
| 2026-09-10 | 19:04:29 | `dahfuf9hvn6c73crvhog` | ibm_marrakesh | sampler | 4096 | 1 | Completed |  | 3 | n8n-r4-tagged |
| 2026-09-10 | 19:04:32 | `dahfug1hvn6c73crvhpg` | ibm_kingston | sampler | 100000 | 1 | Completed |  | 28 | n8n-r4-deep |
| 2026-09-10 | 19:04:35 | `dahfugphvn6c73crvhr0` | ibm_marrakesh | sampler | 2048 | 20 | Completed |  | 13 | n8n-r4-sweep |
| 2026-09-10 | 19:04:38 | `dahfuhj9k43c73aeog20` | ibm_marrakesh | estimator | precision | 1 | Completed |  | 13 | n8n-r4-sweep-est |
| 2026-09-10 | 19:04:38 | `dahfuhhhvn6c73crvht0` | ibm_marrakesh | estimator | precision | 1 | Completed |  | 13 | n8n-r4-sweep-est |
| 2026-09-10 | 19:04:39 | `dahfuhvi3e6s738nq480` | ibm_marrakesh | estimator | precision | 1 | Completed |  | 13 | n8n-r4-sweep-est |
| 2026-09-10 | 19:04:41 | `dahfuifi3e6s738nq48g` | ibm_marrakesh | estimator | precision | 1 | Completed |  | 13 | n8n-r4-sweep-est |
| 2026-09-10 | 19:04:45 | `dahfuj9hvn6c73crvi00` | ibm_marrakesh | sampler | 4096 | 1 | Completed |  | 3 | n8n-r4-build-bv |
| 2026-09-10 | 19:04:47 | `dahfujr9k43c73aeog70` | ibm_marrakesh | estimator | precision | 1 | Completed |  | 4 | n8n-r4-mitig-0 |
| 2026-09-10 | 19:04:48 | `dahfuk1hvn6c73crvi10` | ibm_marrakesh | estimator | precision | 1 | Completed |  | 13 | n8n-r4-mitig-1 |
| 2026-09-10 | 19:04:49 | `dahfukfi3e6s738nq4d0` | ibm_marrakesh | estimator | precision | 1 | Failed | 1519 | 2 | n8n-r4-mitig-2 |
| 2026-09-10 | 19:09:02 | `dahg0jni3e6s738nq6b0` | ibm_marrakesh | sampler | 8192 | 1 | Failed | 1517 | 2 | n8n-r5-grover4 |
| 2026-09-10 | 19:09:05 | `dahg0k8mhr3c73e6h4og` | ibm_marrakesh | sampler | 4096 | 1 | Completed |  | 3 | n8n-r5-qpy |
| 2026-09-10 | 19:09:08 | `dahg0l0mhr3c73e6h4pg` | ibm_marrakesh | sampler | 2048 | 100 | Completed |  | 56 | n8n-r5-100 |
| 2026-09-10 | 19:09:10 | `dahg0lni3e6s738nq6cg` | ibm_kingston | sampler | 1000000 | 1 | Completed |  | 263 | n8n-r5-million |
| 2026-09-10 | 19:09:12 | `dahg0m39k43c73aeoi6g` | ibm_marrakesh | sampler | 2048 | 1 | Completed |  | 3 | n8n-r5-params |
| 2026-09-10 | 19:09:14 | `dahg0mgmhr3c73e6h4sg` | ibm_marrakesh | sampler | 2048 | 1 | Completed |  | 3 | n8n-r5-params |
| 2026-09-10 | 19:09:16 | `dahg0n7i3e6s738nq6fg` | ibm_marrakesh | sampler | 2048 | 1 | Completed |  | 3 | n8n-r5-regs |
| 2026-09-10 | 19:09:19 | `dahg0nphvn6c73crvk50` | ibm_marrakesh | sampler | 4096 | 1 | Completed |  | 3 | n8n-r5-dynamic |
| 2026-09-10 | 19:09:21 | `dahg0o8mhr3c73e6h4u0` | ibm_marrakesh | estimator | precision | 1 | Failed | 1501 | 2 | n8n-r5-zne |
| 2026-09-10 | 19:09:23 | `dahg0ophvn6c73crvk60` | ibm_marrakesh | noise-learner | 64x128 | 1 | Failed | 1519 | 2 | n8n-r5-nl2 |
| 2026-09-10 | 19:09:27 | `dahg0pphvn6c73crvk7g` | ibm_marrakesh | sampler | 512 | 1 | Completed |  | 2 | n8n-r5-batch |
| 2026-09-10 | 19:09:29 | `dahg0qfi3e6s738nq6k0` | ibm_marrakesh | sampler | 1024 | 1 | Completed |  | 2 | n8n-r5-batch |
| 2026-09-10 | 19:09:31 | `dahg0qr9k43c73aeoicg` | ibm_marrakesh | sampler | 2048 | 1 | Completed |  | 3 | n8n-r5-batch |
| 2026-09-10 | 19:09:35 | `dahg0rvi3e6s738nq6mg` | ibm_marrakesh | sampler | 128 | 1 | Cancelled |  | 0 | n8n-r5-cancel |
| 2026-09-10 | 19:17:28 | `dahg4i0mhr3c73e6h8pg` | ibm_marrakesh | sampler | 8192 | 1 | Completed |  | 4 | n8n-r6-grover3_101 |
| 2026-09-10 | 19:17:31 | `dahg4iomhr3c73e6h8r0` | ibm_marrakesh | sampler | 8192 | 1 | Completed |  | 4 | n8n-r6-grover4_1101 |
| 2026-09-10 | 19:17:45 | `dahg4m9hvn6c73crvo8g` | ibm_marrakesh | noise-learner | 64x128 | 1 | Completed |  | 256 | n8n-r6-nl2 |
| 2026-09-10 | 19:24:32 | `dahg7s7i3e6s738nqdf0` | ibm_kingston | sampler | 16 | 1 | Failed | 1603 | 0 | n8n-verify |
| 2026-09-10 | 19:24:37 | `dahg7tb9k43c73aeop5g` | ibm_marrakesh | sampler | 16 | 1 | Cancelled |  | 2 | n8n-verify |
| 2026-09-10 | 19:24:41 | `dahg7u8mhr3c73e6hc00` | ibm_marrakesh | noise-learner |  | 1 | Cancelled |  | 2 | n8n-verify |
| 2026-09-10 | 19:24:46 | `dahg7vni3e6s738nqdk0` | ibm_marrakesh | estimator | precision | 1 | Cancelled |  | 2 | n8n-verify |
| 2026-09-10 | 19:24:50 | `dahg80j9k43c73aeop9g` | ibm_marrakesh | sampler | 16 | 1 | Cancelled |  | 2 | n8n-verify |
| 2026-09-10 | 19:24:55 | `dahg81phvn6c73crvra0` | ibm_marrakesh | sampler | 16 | 1 | Cancelled |  | 2 | n8n-verify |
| 2026-09-10 | 19:25:00 | `dahg830mhr3c73e6hc5g` | ibm_marrakesh | estimator | precision | 1 | Cancelled |  | 2 | n8n-verify |
| 2026-09-10 | 19:25:06 | `dahg84hhvn6c73crvrd0` | ibm_marrakesh | sampler | 1 | 1 | Failed | 1517 | 2 |  |
| 2026-09-10 | 19:27:32 | `dahg997i3e6s738nqes0` | ibm_marrakesh | sampler | 16 | 1 | Cancelled |  | 2 | n8n-verify |
| 2026-09-10 | 19:27:37 | `dahg9a9hvn6c73crvsig` | ibm_marrakesh | estimator | precision | 1 | Cancelled |  | 2 | n8n-verify |
| 2026-09-10 | 19:27:41 | `dahg9b8mhr3c73e6hdd0` | ibm_marrakesh | noise-learner |  | 1 | Cancelled |  | 2 | n8n-verify |
| 2026-09-10 | 19:59:30 | `dahgo8gmhr3c73e6i0e0` | ibm_marrakesh | estimator | precision | 1 | Failed | 1501 | 2 | n8n-r8-qpy-est |
| 2026-09-10 | 19:59:32 | `dahgo91hvn6c73cs0fkg` | ibm_marrakesh | noise-learner |  | 1 | Failed | 1519 | 2 | n8n-r8-qpy-nl |
| 2026-09-10 | 19:59:35 | `dahgo9phvn6c73cs0fmg` | ibm_kingston | sampler |  | 0 | Completed |  | 2 | n8n-r8-private |
| 2026-09-10 | 19:59:48 | `dahgod1hvn6c73cs0fvg` | ibm_kingston | sampler | 50000 | 1 | Cancelled |  | 2 | n8n-r8-cancel-running |
| 2026-09-10 | 20:00:24 | `dahgom39k43c73aepeig` | ibm_kingston | sampler | 128 | 1 | Completed |  | 2 | n8n-r8-v1 |
| 2026-09-10 | 20:05:28 | `dahgr1phvn6c73cs0k10` | ibm_fez | sampler | 64 | 1 | Completed |  | 2 | n8n-r8-agent |
| 2026-09-10 | 20:07:16 | `dahgrt0mhr3c73e6i620` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-r8c-burst |
| 2026-09-10 | 20:07:19 | `dahgrtr9k43c73aepj30` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-r8c-burst |
| 2026-09-10 | 20:07:21 | `dahgrub9k43c73aepj4g` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-r8c-burst |
| 2026-09-10 | 20:07:24 | `dahgrv0mhr3c73e6i64g` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-r8c-burst |
| 2026-09-10 | 20:07:26 | `dahgrvni3e6s738nr7mg` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-r8c-burst |
| 2026-09-10 | 20:11:13 | `dahgtob9k43c73aepku0` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-r8c-restart |
| 2026-09-10 | 20:21:36 | `dahh2k39k43c73aeppfg` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-r8c2-restart |
| 2026-09-10 | 20:23:02 | `dahh39hhvn6c73cs0s40` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-smoke235 |
| 2026-09-10 | 20:27:13 | `dahh58fi3e6s738nrgsg` | ibm_kingston | sampler | 32 | 1 | Completed |  | 2 | n8n-smoke235-trigger |
