# Changelog

All notable changes to this package are documented in this file.

## 0.4.0 (2026-08-17)

A verification fix, 10 new operations across a 6th resource, and documentation written for machines
as well as people. The node goes from 24 to 34 operations. Everything here was traced end to end:
each change was followed through every caller, and the suite grew from 185 tests to 264 at 100%
statement, branch, function and line coverage.

### Fixed

- **Both triggers drop `usableAsTool`.** `@n8n/eslint-plugin-community-nodes` 0.29.0 (2026-08-11)
  reversed the `node-usable-as-tool` rule for trigger nodes: the property the 0.3.3 verification
  pass was required to add is now an error on triggers, so the published 0.3.3 fails
  `npx @n8n/scan-community-package` with exactly 2 errors. The tool variants n8n generated for
  the triggers could never run anyway (a polling trigger implements `poll()`, not `execute()`);
  removing the property also removes them from the AI Agent tool picker. The local lint now runs
  the same plugin version the scanner pins and passes with zero errors.

- **An unknown resource no longer runs a job operation.** The dispatcher ended in an `else` that
  sent anything unrecognised to `handleJob`, so a resource sharing an operation name with the job
  resource would have quietly returned the wrong collection. Each resource is now named explicitly
  and an unknown one raises `Unsupported resource`, matching the guard 0.2.2 added for operations.
  A new test walks every operation the UI advertises and fails if one is not routed.

### Added

- **Node version 2, renaming the session Mode parameter to `sessionMode`.** n8n's MCP server treats
  a parameter literally named `mode` as a node discriminator and drops it from the type definitions
  it hands to AI workflow builders, so an agent building a workflow through the MCP could not choose
  between a batch and a dedicated session. *Verified against the live MCP:* `get_node_types` for
  session/create returned only `sessionBackend` and `maxTtl`. Version 1 still loads and still reads
  `mode`, gated by `displayOptions` on `@version`, so existing workflows are untouched; both paths
  are covered by tests, including one proving a version 2 node ignores a stale `mode` value.

- **Job cost cap.** Submit takes **Max Cost (Seconds)**, sent as `cost`, after which IBM cancels the
  job. Zero, the default, omits the field. The Open plan's whole allowance is 600 seconds per 28
  days, and a failed job spends it too, so a cap is the cheapest protection available. Clamped to
  the 10800 IBM permits.

- **QPY circuits.** Submit gains **Circuit Format**, choosing between OpenQASM 3 and base64 QPY,
  which preserves circuits OpenQASM 3 cannot express. The local pre-submit guard is preserved rather
  than relaxed: a QPY payload is checked for the `UUlTS0lU` prefix, the base64 encoding of the QPY
  magic bytes, exactly as an OpenQASM 3 circuit is checked for its version header. A workflow saved
  before this parameter existed stores no value for it and still submits OpenQASM 3.

- **Workload resource,** wrapping `GET /v1/workloads`: jobs, sessions and batches in one listing,
  with free-text search over IDs and tags, a mode filter, status multi-select, and cursor paging.
  Capped at the 50 per call the endpoint allows, and sorted newest first so it matches Job List,
  which the API on its own would not.

- **Usage analytics and the instance cost limit.** Account gains Get Usage Analytics, Get Usage
  Analytics Grouped (by backend, instance, plan, user or subscription), Get Usage Analytics Grouped
  by Date, Get Usage Analytics Filters, and Set Cost Limit, which writes the instance-wide ceiling
  and clears it with an explicit null. The read paths consume no QPU time, so a scheduled spend
  report costs nothing.

- **Backend Get Defaults,** wrapping `GET /v1/backends/{id}/defaults`.

- **Submit to Noise Learner.** The third program on `POST /v1/jobs`, characterising the
  Pauli-Lindblad error channels on the entangling layers a circuit uses. It is included where
  Executor, NoiseLearnerV3 and Calibrator are not, for one reason: the version 2 noise learner
  accepts a plain QASM string, while all 3 of the others require circuits encoded as base64
  QPY, which cannot be produced without Qiskit. Its options object is declared
  `additionalProperties: false` upstream, so the Sampler and Estimator toggles are deliberately kept
  out of it and a test pins that they never leak in.

- **Account Get API Versions,** wrapping `GET /v1/versions`, so the versions IBM currently serves
  can be read from a workflow instead of from the docs. *Verified live:* the endpoint answers
  unauthenticated and reports `2026-04-15` as the only version with status `live`.

- **Job List Tags,** wrapping `GET /v1/tags`. The API requires both `type` and `search`, so the node
  sends `type=job` and an empty search when none is given, rather than failing on a missing
  parameter.

- **Log Level on every submit,** sent as `log_level` and readable afterwards with Get Logs.

- **A guard on the credential's API Version.** A value that is not a real YYYY-MM-DD date, including
  an impossible one such as 2026-02-31, now fails locally with a message naming the field, instead
  of reaching IBM as an unparseable header whose error names neither. A well-formed but deprecated
  date is accepted and logged as a warning, because those versions still answer and refusing them
  would break a working credential years before IBM stops accepting it. *Verified live:*
  `GET /v1/versions` lists `2026-04-15` as the only version not deprecated, with 2027 sunsets on
  every earlier one. The warning is raised on the action node only; a trigger polls on a schedule
  and would repeat it indefinitely.

- **A tool description written for the model.** The action node ships
  `usableAsTool.replacements.description`, telling an agent which calls are safe unprompted and why
  it cannot invent a circuit for real hardware. Two node hints now appear in the editor as well: one
  warning that Get Results holds the execution open, one that a non-native circuit fails with reason
  code 1517 and still spends quota.

- **Codex metadata.** Each node ships a `.node.json` giving it a category in the picker, search
  aliases such as Qiskit and QPU, and documentation links. The build copies them into `dist`
  alongside the icons, which is why `copy-icons.mjs` is now `copy-assets.mjs`.

- **AI-readable documentation, following the [llms.txt](https://llmstxt.org) convention.**
  `llms.txt` is the index; `llms-full.txt` is a complete machine-oriented reference generated from
  the source: node type strings, every operation's internal parameter names and defaults, output
  shapes, the gate emission table, ISA and transpilation guidance, error codes, limits, and a
  runnable example workflow JSON (parse-checked in CI terms by a test). `AGENTS.md` covers the same
  ground for agents changing the code rather than using it. All three ship in the npm tarball.

- **A monthly verification scan.** `scan.yml` runs the official scanner on a schedule and on demand.
  The ruleset moves independently of this repository and has now broken a compliant release once;
  this turns the next occurrence into a notification instead of a discovery at publish time.

### Changed

- **Documentation catches up with IBM.** The service is now called IBM Quantum Compute Service (a
  rename only; endpoints are unchanged). The Open plan's allowance is documented as 600 seconds per
  rolling 28 days, the plan lineup as Open, Pay-As-You-Go, Flex, Premium and On-Prem. The native
  gate recipe is now scoped to Heron: **Nighthawk** processors (`ibm_miami`, `ibm_berlin`) run
  `cz, id, rz, sx, x` with no fractional `rx`, so the transpiler-free Bell state does not run there.
  IBM's own limits are documented: 5 job submissions per minute, 50 MB per payload, three hours
  per job, ten million executions per Sampler job.

- **`parseTagList` is now `parseCsvList`,** since it also splits backends, plans, instances and user
  IDs for the analytics filters. Internal only.

- **Toolchain:** `n8n-workflow` 2.34.3, the current `stable` tag;
  `@n8n/eslint-plugin-community-nodes` 0.29.0, the version the scanner pins; `@types/node` 26.2.0;
  `typescript-eslint` 8.67.0. `package.json` declares `n8n.strict`. `eslint` stays pinned at 9.29.0
  and `eslint-plugin-n8n-nodes-base` stays on 1.x: a 2.0.0 exists, but the scanner still depends on
  `^1.16.7`, and linting against a ruleset the scanner does not run would prove nothing.

### Notes

- **Executor, NoiseLearnerV3 and Calibrator stay out,** and so does `GET /v1/accounts/{id}`. The
  3 programs each require circuits encoded as base64 QPY, which cannot be produced without
  Qiskit and so cannot be reached by a package whose whole premise is that you do not need it. The
  account endpoint is unreachable for a simpler reason: nothing else in this API returns an account
  id, so a workflow has no way to obtain one. Both gaps are documented in `llms-full.txt`.

- **Coverage is now a flat 100.** Getting there removed code rather than adding assertions: a `?? []`
  in `results.ts` that a preceding guard had already made unreachable is gone, and the two
  copy-pasted narrowing expressions (`error instanceof Error ? ... : String(error)` in 3 places,
  and the NodeApiError wrap in two) are now single tested helpers, `errorMessage` and `asNodeError`
  in `transport.ts`. `parseSamplerPub` is exported so its no-register guard is a tested path instead
  of a theoretical one. The thresholds are raised from 100/99/100/97 to 100 across the board, so an
  untested line now fails the build.

- **Three `npm audit` findings remain, and cannot be fixed here.** All three are the same
  transitive `nanoid` advisory, reached through `n8n-workflow` and `@n8n/utils`, which pins
  `nanoid` at exactly 3.3.8 (the fix is 3.3.18). An `overrides` entry would resolve it and was
  tried, but community node packages are forbidden from declaring one, and the lint rule says so
  explicitly. The published package has no runtime dependencies at all, so nothing reaches a user;
  the finding is confined to the development tree and waits on n8n.

## 0.3.3 (2026-08-02)

A verification and correctness release. The package had stopped passing the official n8n scan, and
3 defects only a real quantum processor could expose were sitting in the shipped code. Every
fix below was confirmed against live IBM hardware, not against a mock: roughly 34 jobs across
`ibm_kingston`, `ibm_marrakesh` and `ibm_fez`, consuming 118 of the Open plan's 600 monthly seconds.
Where a claim is physical, the expected value is stated next to the measured one.

### Fixed

- **Circuit Build wrote past the classical register.** A `measure` carrying no Classical Bit value
  passed validation, which range-checked bit 0, and was then rendered against the qubit index
  instead. A 3-qubit, 1-classical-bit circuit emitted `c[2] = measure q[2];`, which IBM's parser
  rejects. Reachable from an AI Agent tool call, an imported workflow or the public API, where the
  field can simply be absent. Both sides now agree on bit 0.
  *Expected after the fix:* `c[0] = measure q[2];`. *Measured on ibm_kingston:* exactly that.

- **The Identity gate failed every job it appeared in.** The OpenQASM 3 standard library defines
  `id` as `U(0, 0, 0)`, and IBM's target refuses the builtin `U`, so any circuit containing an
  identity died with `the instruction u on qubits (n,) is not supported` even though the backend
  lists `id` among its basis gates. Identity is the no-op, so it is now validated as before and
  emitted as nothing, which leaves a mathematically identical circuit.
  *Isolated with three control jobs:* `reset+x+rz+cz+barrier` completed, `rx(pi)` alone completed,
  `id + x` failed. *After the fix, the same `id + x` circuit:* completed, `{"01": 249, "00": 7}`,
  reproduced on both `ibm_kingston` and `ibm_marrakesh`.

- **Submit accepted a circuit that was not OpenQASM 3.** Import checked the version header; Submit
  did not, so plain text or an OpenQASM 2 program produced a job that IBM queued, charged QPU time
  for, and only then failed with a parse error. Both paths now share one check.
  *Measured before the fix:* the string `this is not qasm` submitted cleanly and burned
  `qpu_charge_time_seconds: 2`. *After:* rejected locally, no request sent.

- **Array query parameters were encoded in a form IBM ignores.** n8n serialises an array as
  `tags[]=a&tags[]=b`; the API recognises only repeated keys, `tags=a&tags=b`, and silently returns
  everything rather than erroring. Requests now set `arrayFormat: 'repeat'`, matching the official
  client. Caught by checking a filter against the live API instead of trusting the request shape.
  *Before:* filtering on `qa-audit` returned 20 unrelated jobs, and filtering on a tag no job
  carries also returned 20. *After:* 1 job and 0 jobs respectively.

- **Get Results crashed on a malformed body.** The guard was `?? []`, which catches only null and
  undefined, so a `results` field that was not an array reached `.map` and threw a bare
  `TypeError`. It now checks the shape and degrades to zero pubs, still returning the untouched
  body as `raw`.

- **Shots, Limit and the register sizes trusted the UI.** `minValue` is only a hint, so an
  expression could deliver a string, a float or a negative straight into a request. These are now
  coerced the way Poll Interval and Max Wait already were, and Limit is capped at IBM's documented
  maximum of 200. Max TTL keeps its "zero means let IBM decide" behaviour.

- **Account errors carried no `itemIndex`,** so a failure inside a multi-item run did not point at
  the item that caused it. Every other resource already did this.

- **The package failed `npx @n8n/scan-community-package`.** Scanner 0.30.0 verifies npm provenance,
  then fetches the source the attestation points at and lints it with `eslint-plugin-n8n-nodes-base`
  as well as the community-nodes plugin. 10 errors were reported that `npm run lint` never ran:
  both trigger display names, the triggers' `limit` parameter, and four operation actions that were
  not sentence case. *Before:* `passed=false, errors=10`. *After:* `passed=true, errors=0`, on both
  the source leg and the published-artifact leg.

### Added

- **Job List gains a Program filter,** narrowing a listing to Sampler or Estimator jobs.
  *Verified live:* `sampler` returned 20 jobs all of program `sampler`, `estimator` returned 12 all
  of program `estimator`, and the empty value returned both.

- **Tags filters accept several tags.** Job List and both triggers now take a comma-separated list,
  up to the eight the API allows, matching the tags Submit already writes. A job must carry all of
  them. *Verified live:* two tags a job carries returned it; adding one tag it does not carry
  returned nothing, which is what proves the filter is really applied.

- **Get Results reports `unparsedSamples`** when the hex parser cannot read part of a sampler
  register. Unreadable samples were dropped rather than folded into a wrong bitstring, which was
  right, but the counts then summed to less than shots with nothing to explain the gap. The field
  appears only when there is a shortfall; on healthy data the output shape is unchanged.

- **README documents building an ISA circuit without a transpiler.** `H = rz(pi/2) rx(pi/2) rz(pi/2)`
  and `CNOT(c, t) = H(t) cz(c, t) H(t)` are enough to build a runnable entangling circuit from the
  palette alone. *Measured on ibm_marrakesh, 2048 shots:* 51.1% `00`, 46.2% `11`, 2.7% leaking into
  `01` and `10`. The README also now lists the Job List filters and warns that Gate Twirling cannot
  be combined with fractional gates.

### Changed

- **Both triggers are renamed** to **IBM Quantum (Unofficial) Trigger** and **IBM Quantum Error
  (Unofficial) Trigger**. A trigger's display name must end in `Trigger`, and only a trailing
  `(Beta)` is tolerated after it. The node type names are untouched, so existing workflows are
  unaffected.

- **The triggers' Jobs to Scan default moves from 20 to 50** and takes the wording n8n requires of
  any numeric parameter named `limit`. Existing workflows keep the value they already stored. Job
  List and both triggers now cap it at 200, above which IBM silently substitutes its own default.

- **`engines.node` is now `>=22`** and CI runs on Node 22 and 24. Node 20 reached end of life on
  30 April 2026, and n8n has required Node 22 or newer since 2.9.0 (February 2026), currently 22.22.
  The 1.x line still permits Node 20.19, so this is a deliberate choice not to support an unpatched
  runtime rather than a technical impossibility.

- **The ESLint config mirrors the verification scanner.** It adds `eslint-plugin-n8n-nodes-base` and
  lints `package.json`, which needs the TypeScript parser because those rules walk a TSESTree
  `ObjectExpression`. Roughly a dozen `package.json` rules had never run locally. Verified by
  reintroducing each class of error and confirming the lint fails.

- **Publishing moves to npm trusted publishing over OIDC.** There is no longer an `NPM_TOKEN` to
  store or rotate: the workflow mints a short-lived, workflow-scoped credential instead, and
  provenance is generated automatically on that path, so the explicit `--provenance` flag is gone.
  The publish job moves from Node 22 to Node 24 because trusted publishing requires npm 11.5.1 or
  newer and Node 22 still ships npm 10.9.x, while Node 24 ships 11.16. This affects only the
  runtime that publishes; the package still supports Node 22 and 24 alike.
- **Toolchain:** `@n8n/eslint-plugin-community-nodes` 0.27.0, the version the scanner itself pins;
  `n8n-workflow` 2.32.1, the exact version shipped inside n8n 2.32.7; `vitest` and
  `@vitest/coverage-v8` 4; `@types/node` 26.1.2; `prettier` 3.9.6; `typescript-eslint` 8.65;
  `actions/setup-node` v7. All four `npm audit` findings are cleared. `eslint` is pinned to exactly
  9.29.0, the version the n8n plugin peer-depends on, and Dependabot is configured to skip it so it
  stops proposing bumps that cannot install. TypeScript 7 stays out: it removes
  `moduleResolution=node10`, which `tsconfig.json` uses, and the current `typescript-eslint` cannot
  load against it.

### Notes

- **`rzz` and `sx` stay out of the gate palette.** Both appear in a Heron backend's `basis_gates`,
  but `rzz` is refused by IBM's OpenQASM 3 parser with a parse error rather than a target error, and
  `sx` has no spelling the palette can emit without the builtin `U`. `rzz` was fully implemented,
  submitted, and reverted after the evidence came back. *Control:* the identical circuit with `rzz`
  removed completed with 93.8% `00`, exactly what `H·H = I` predicts, which isolates `rzz` as the
  sole cause. Adding either gate would have recreated the trap the Identity fix removes.

- **Gate Twirling cannot be combined with fractional gates.** A circuit Qiskit transpiles for a
  Heron processor uses parametrised `rx`, which IBM counts as fractional, and the job fails with
  `gate twirling does not support fractional gates`. Found by submitting a transpiled 40-qubit GHZ
  with the option on. Dynamical Decoupling and Measurement Twirling are unaffected. The parameter
  description now says so.

- **Source maps are still shipped.** They make a stack trace from an installed copy readable, which
  is worth more than the 60 kB they cost.

### Tests

Unit suite: **185 tests**, up from 140. Coverage moved from 98.55 / 89.81 / 100 / 99.28 to **99.79%
statements, 97.9% branches, 100% functions, 100% lines**, and the thresholds were raised from
85/85/80 to lines 100, statements 99, functions 100, branches 97 so a regression trips the gate.
The remaining branches are unreachable by construction: `parseSamplerPub` runs only behind a guard
that already proves what its own checks re-test, the gate-parse catch can only ever see an `Error`,
and the poll catch can only ever see a `NodeApiError` because the transport wraps everything. Each
is commented at the point it occurs.

Hardware campaign, run against a local n8n 2.32.7 with the node installed the way n8n installs a
community package. All 24 operations were exercised on live infrastructure.

| what was run | expected | measured |
| :-- | :-- | :-- |
| Sampler, `x` on q0, 2 qubits measured | `01` dominant, since `c[0]` is the rightmost bit | `{"01": 250, "00": 6}` |
| 64-bit register, `x` on q0 and q63 | `1` then 62 zeros then `1`; a double would lose the low bit | top outcome exactly that, `numBits` 64 |
| `num_bits` present in the sampler response | needed, or the width would be inferred as 1 | present, `num_bits: 2` and `64` |
| Estimator `⟨Z⟩` on `\|1⟩` | -1 | -1.0024 |
| Estimator, Pauli array `["ZI","IZ","ZZ"]` | +1, -1, -1 | +1.003, -1.014, -1.025 |
| Estimator, coefficient map `{"ZI":1.0,"IZ":0.5}` | +0.5 | +0.472 |
| Parameter sweep, one job, five bindings | `⟨Z⟩ = cos(θ)` | max deviation 0.019 across five points |
| Bell state from native gates only | correlated pair | 51.1% `00`, 46.2% `11`, 2.7% noise |
| Qiskit-transpiled GHZ-12 | both extremes on top | 37.7% and 34.3% |
| Qiskit-transpiled GHZ-80, depth 241, 45k shots | extremes rank 1 and 2 out of 2^80 | ranks 1 and 2, 41172 distinct outcomes, 1041 kB parsed inside the 30 s timeout |
| Session carrying two jobs | both tagged with the session, filter finds them | 2 found, results returned, session closed |
| Both polling triggers | fire once on new terminal jobs, never on history | fired with the failure reason attached |
| Seven error paths | IBM's own message surfaces, local checks fire first | all seven reported precisely |
| Paused backend | excluded from Get Least Busy | `ibm_marrakesh` in maintenance, correctly dropped |
| Three input items through one node | per-item `pairedItem` | 0, 1, 2 |
| Private job | IBM redacts the params | `params: {}`, tags still visible |

## 0.2.3 (2026-07-09)

### Changed

- Toolchain updates: `n8n-workflow` 2.30.1 and `@types/node` 26.1.1. Dev tooling only, no changes to the published node behavior.

## 0.2.2 (2026-07-07)

### Fixed

- Circuit Build now emits the OpenQASM 3 builtin `U` for the U gate. The previous lowercase `u(...)` is not defined in `stdgates.inc`, so IBM's parser rejected any circuit built with it.
- Unknown operations now fail with a clear error instead of falling through to a destructive request. Previously an unrecognized job operation ran DELETE on the job and an unrecognized session operation closed the session.
- The Trigger's Failed filter also matches the defensive `error` status alias, mirroring the Error Trigger.
- Get Results survives transient failures while polling: 429 rate limits, 5xx gateway errors and dropped connections are retried until Max Wait, instead of killing a poll that may have waited many minutes. Real errors (bad job ID, revoked key) still fail immediately.
- Circuit Build validates register sizes, so an expression can no longer inject a zero, negative or non-integer qubit or classical bit count and produce an invalid program.

### Added

- Job operations: Get Logs, Get Metrics and Update Tags.
- Submit options: Tags (comma separated, stored on the job) and Private (hides inputs and results from other collaborators, on plans that support private jobs).
- Job List filters: backend, session ID, tag, status (pending or finished), created after/before, sort order and offset. Listings now omit each job's circuit payload by default (`exclude_params`), with an Include Circuit Params toggle to bring it back.
- Both triggers accept an optional Tag filter, so a workflow can react only to its own jobs.
- Trigger polls now scan only finished jobs (`pending=false`) and skip circuit payloads (`exclude_params=true`), which keeps polls light and prevents a burst of new submissions from pushing a finished job out of the scan window.
- Account operation: Get Configuration (`GET /v1/instances/configuration`).

### Changed

- UI placeholders and examples use `ibm_kingston` (available on the Open plan) instead of `ibm_brisbane`, which IBM retired on 3 November 2025.
- `n8n-workflow` dev dependency pinned to 2.29.2, the exact version shipped inside n8n 2.29.7. This also clears all previously reported `npm audit` findings from the older 2.16.0 dependency chain.
- Toolchain updates: `@n8n/eslint-plugin-community-nodes` 0.24.0, `@types/node` 22, `prettier` 3.9.4, `typescript-eslint` 8.63, `vitest` 3.2.7.
- The npm publish workflow runs on Node 22, since Node 20 reached end of life in April 2026.
- README documents the new operations, the tag-based trigger pattern, and the NumPy 2.0 requirement of current Qiskit (2.5+) for the local transpilation recipe.

### Tests

- 20 new unit tests covering every fix and feature above; 140 total.

## 0.1.1 (2025)

- Initial published release: Backend, Circuit, Job, Session and Account resources, plus the IBM Quantum Trigger and IBM Quantum Error Trigger polling nodes.
