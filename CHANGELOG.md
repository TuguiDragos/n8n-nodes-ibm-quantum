# Changelog

All notable changes to this package are documented in this file.

## 0.6.0 (unreleased)

Three new operations, bringing the node to 36 operations across the same six resources, and the
first release driven by an audit rather than by a hardware run. The audit of 4 September 2026 read
every file in the repository, compared every request the node builds with IBM's OpenAPI spec
0.50.5, ran the node in a live n8n 2.37.10, and found five logic defects, one UI example the schema
refuses, ten points where the documentation and the process had drifted from IBM or from n8n, and
two endpoints the node did not cover although the credential already held everything they need.
Every finding is closed below. The difference from 0.5.0 is stated plainly in each entry: what was
measured on a device, and what was built from the spec and IBM's guides and is still waiting for
its first live run, listed together under Not yet verified on hardware.

### Added

- **Account > Set Cost Limit is back, on the IBM Cloud Resource Controller, and Account > Get Many
  Instances joins it, for 36 operations.** IBM's spec deprecates `PUT /instances/configuration`, the
  endpoint that hung for three minutes and cost the operation its place in 0.5.0, and points at the
  Resource Controller instead. Its guide documents `PATCH /v2/resource_instances/{crn}` with `{
  parameters: { timestamp, instance_limit_seconds } }`, the same IAM bearer token, and one rule that
  is easy to miss: a `parameters` object identical to the previous one is silently ignored, so every
  write the node sends carries the current time. A **Clear Limit** switch removes the cap, and IBM
  then reports the plan's default in `extensions`, 600 seconds on the Open plan, which is what
  `instanceLimitSeconds` reads back after a clear, measured on 2026-09-10; **Cost
  Limit (Seconds)** is a whole number of at least one second, and anything unreadable fails before
  the request, so an expression that resolves to nothing can no longer clear a cap the way the 0.4.x
  "zero clears it" contract allowed. The response is the updated instance with
  `instanceLimitSeconds` read back from `extensions`, which IBM says to trust over `parameters`. An
  **Instance CRN** field targets another instance the key may manage, which is where Get Many
  Instances comes in: `GET /v2/resource_instances` filtered to the IBM Quantum catalog id lists
  every instance the key can see, with the cost limit, the allocation and the allowed backends of
  each, filtered by **Plan** through the four plan ids IBM publishes. With **Return All** off the
  answer is IBM's own page untouched; with it on the node follows `next_url` up to twenty pages of a
  hundred and returns one merged `{ resources, rows_count, next_url, truncated }`. Both calls go
  through the same request helper as everything else, so the 30 second timeout, the empty-body guard
  and IBM's error messages apply; SECURITY.md lists the Resource Controller as the fourth host the
  node talks to, with the two IBM Quantum headers that travel along. A workflow saved on 0.4.1 runs
  the operation again instead of failing, but it reads `instanceLimitSeconds` rather than the old
  `instanceLimit`, and a stored `instanceLimit` of 0 is now refused rather than clearing the cap.
  Both calls have since run against a live Open plan account and behave as documented: the Get
  Many Instances read, and a Set Cost Limit write that was set to a second value, read back and
  restored, which also settles that the Resource Controller tolerates the `Service-CRN` and
  `IBM-API-Version` headers the credential adds. Under Not yet verified on hardware below.
- **Account > Get Account Configuration, the endpoint this changelog said a workflow could never
  reach.** `GET /v1/accounts/{id}` wants an account id, and 0.4.1 recorded that nothing in the API
  returns one. The credential had it all along: an instance CRN reads
  `crn:v1:bluemix:public:quantum-computing:us-east:a/<account id>:<instance id>::`, and the `a/`
  field is exactly the id IBM asks for "without the a/ prefix". The node now reads it from the
  credential, refuses locally before any request when the field is missing or malformed (the message
  names the CRN when the credential carries no `a/` field), and returns IBM's body untouched: one
  entry per plan the account holds, with `usage_limit_seconds`, `usage_allocation_seconds`,
  `unallocated_usage_seconds`, the allowed `backends`, the session caps `max_ttl`, `active_ttl` and
  `interactive_ttl`, the contract window and the functions the plan grants. An optional **Plan ID**
  narrows it to one plan, bounded locally to the 64 characters the spec allows. Get Usage and Get
  Instance stay the per-instance reads; this is the account-wide one, and it is one of three
  operations this release adds. Built from the OpenAPI spec (0.50.5) and pinned by tests, and since
  answered by a live account as documented, under Not yet verified on hardware below.
- **The primitive options are fields.** Sampler and Estimator submits gain **Dynamical Decoupling
  Options**, **Twirling Options** and **Execution Options**, and the Estimator gains **Resilience
  Options**, **Default Precision** and **Seed Estimator**. Between them they cover every key the
  spec lists under `options` for the two programs except `default_shots` (the Sampler's Shots
  field travels with the circuit instead, and the Estimator has no field for it), the simulator
  and experimental blocks, the measurement noise learning subtree, and the two keys
  `zne.extrapolated_noise_factors` and `layer_noise_model` (the second takes a previous noise
  learner result back in): the decoupling sequence, slack distribution, scheduling method and
  reset handling; the twirling randomizations, shots per randomization and strategy, the two
  counts taking a whole number or `auto` exactly as the schema does; qubit initialisation, the
  repetition delay and the Sampler's measurement type; and, for the Estimator, measurement
  mitigation, ZNE with its noise factors, extrapolators and amplifier, PEC with its overhead cap
  and noise gain, and the layer noise learning underneath. Until now all of that lived behind the
  Additional Options JSON. A collection entry is sent only when it is added, so a workflow that
  never opens one submits exactly the body it did before, and the dedicated fields win over the
  JSON one key at a time: a JSON block that sets `zne.extrapolator` keeps it when the Noise
  Factors field sets only `zne.noise_factors`. Every number is checked locally before the request,
  because an option that reaches IBM as text is a rejected job rather than a corrected one: most
  are refused the way the Precision field already refuses, with a message naming the parameter,
  while the three noise learning counts follow the node's clamp convention instead: the value goes
  through `Number` and is floored, and the key is dropped when that leaves no finite number of at
  least 1, so `true` is sent as 1 and `'7'` as 7 rather than refused. The measurement type is hidden
  for the Estimator and dropped from its request even when an expression carries it, since its
  execution block has no such key in the spec. The shapes were checked against the OpenAPI document
  0.50.5; no job was run with them, so the entries say what the schema says and nothing more.
- **`rzz` and `delay` join the palette, and gate angles can be symbolic.** `rzz` was the one Heron
  basis gate the palette left out, and 0.5.0 established why: `stdgates.inc` has no definition for
  it, so a bare call comes back Failed naming `gate 'rzz' is not defined`, while the same call
  carrying the `gate rzz` block that Qiskit's exporter writes completed on `ibm_fez` with 64 of 64
  shots on `00`. The builder now writes that definition, verbatim from Qiskit 2.5.2 and so with the
  operand names `_gate_q_0, _gate_q_1`, once after the include line whenever a circuit uses `rzz`;
  the 0.5.0 run is recorded with the operand names `a, b`, which are local to the block and name the
  same definition. The submit-time warning about a bare `rzz` is unchanged and a palette circuit
  never trips it. `delay` is a native instruction on every IBM device and was already in the node's
  ISA set; it takes a **Duration** such as `100ns` or `160dt` (a number and a unit, `ns`, `us`,
  `ms`, `s` or `dt`, with `dt` a whole number) and is emitted as `delay[160dt] q[i];`, the form
  Qiskit writes. A new **Circuit Parameters** field on Circuit Build declares symbolic angles as
  `input float[64] theta;` lines, the way Qiskit exports a parametrized circuit, and any gate's
  Parameters field then accepts a declared name in place of a number; the output lists them under
  `parameterNames` in declaration order, and the existing Sampler and Estimator **Parameters** field
  binds them at submit time. Names are validated locally: an OpenQASM 3 identifier, not a keyword,
  constant, gate name, register name or one of the `rzz` block's own `p0`, `_gate_q_0` and
  `_gate_q_1`, and not repeated. Nothing changes for a circuit that uses none of the three
  additions: the emitted program is byte-identical.
- **Get Least Busy can rank by IBM's estimated wait and filter by processor family.** Queue length
  was the only ranking, and a queue of 10 on a slow device can outlast 40 on a fast one.
  `GET /v1/backends` accepts `fields=wait_time_seconds` and then returns, per device, IBM's own
  `average`, `p50` and `p95` wait in seconds; the node now always asks for it. A **Rank By** option
  chooses between queue length, still the default so an existing workflow picks the same device it
  did before, and the three wait figures; every candidate carries `waitTimeSeconds`, `family` and
  `revision` beside the fields it already had, and the pick's own figure is returned as
  `waitTimeSeconds` at the top level. A device IBM gives no figure for sorts last, and ties fall
  back to queue length. **Processor Family** keeps only devices whose `processor_type.family`
  matches, case-insensitively, which is how a circuit with fractional `rx` or `rzz` stays on Heron
  and off Nighthawk. The backend dropdowns show the family too:
  `ibm_fez (Heron r2, online, 7 queued)`. The wait figures are taken from IBM's OpenAPI spec. Read
  live on 2026-09-07 from an Open plan instance in `us-east`, `GET /v1/backends` with the field
  asked for answered with no `wait_time_seconds` on any of its three online devices, so all three
  tied last and the documented fallback picked what queue length would have picked.
- **Calibration ID on Backend > Get Properties, Backend > Get Configuration and every Submit, plus
  Updated Before on Get Properties.** Every job already reported the calibration it ran with as
  `calibration_id`, and the node had no way to use it: the two backend reads always returned the
  current calibration, and a submit could not ask for a particular one. Both reads now take an
  optional **Calibration ID**, sent as the `calibration_id` query parameter the spec documents, and
  Get Properties also takes **Updated Before**, sent as `updated_before`, which returns the
  properties last updated before that time. The three submit operations take the same **Calibration
  ID**, sent as the job-level `calibration_id` beside `session_id`, and the node refuses anything
  over the 100 characters IBM's schema allows before the request goes out, as it already does for
  tags. A date that does not parse is refused rather than dropped, because a dropped filter would
  quietly return today's calibration and look like success. Left empty, every request is byte for
  byte what it was. Verified against the OpenAPI spec (0.50.5) only: no live job has yet been
  submitted with the field set, so whether IBM honours a calibration that is no longer current, or
  what it answers for one it does not know, remains to be measured.
- **Return All on Job > Get Many.** The listing stopped at IBM's 200 per call, and reading past that
  meant wiring Offset through a loop by hand. A **Return All** toggle now walks the listing 200 jobs
  at a time, from the Offset filter when one is set, until a page comes back short or the offset
  reaches the server's `count`. The pages are merged into one `jobs` array in the raw body's shape,
  with `offset` reporting where the walk started, so an expression reading `$json.jobs` works the
  same either way. A job submitted while the node is paging shifts every later position by one and
  repeats the job at the page boundary, so a repeated id is dropped, the dedupe the triggers do too.
  The walk stops after 50 pages, 10,000 jobs, and then adds `truncated: true` rather than running
  unbounded on a listing that grows as fast as it is read. Off by default, and with it off nothing
  changes: Limit keeps its default of 50 and its ceiling of 200, and the request is identical to
  0.5.0. Measured live on 2026-09-07 it returned all 198 jobs of the account, one page at 200; on
  2026-09-10, with the history at 313, it walked two pages and returned 313 jobs against a server
  `count` of 313, with every id distinct, so the page boundary is now measured as well.
- **Return All on Workload > Get Many too.** That listing caps at 50 per call and pages by cursor,
  so reading a month of work meant pasting `nextCursor` back into the filter by hand, once per page.
  With **Return All** on, the node asks for 50 at a time and follows the `next` link IBM sends,
  keeping the same filters, until a link arrives without a cursor or the walk reaches 20 pages,
  1,000 workloads. The answer keeps the shape of a single page, built from the last one fetched,
  with every page's workloads merged in order; `truncated: true` is added when the cap stopped the
  walk, and `nextCursor` then still names the page to carry on from. A workload id that has already
  been collected is dropped, the same dedupe Job > Get Many does, and a `next` cursor IBM repeats
  ends the walk instead of fetching the same page for the whole of the cap: without that, one
  repeated cursor cost 19 wasted requests and counted every workload on that page 20 times. A walk
  that ends on a repeated cursor is still truncated, because it never reached the end of the
  collection. Off by default, and with it off the answer stays the single page IBM sent, with the
  two cursors beside it. *Verified live:* the cursor is base64 of a timestamp, Return All returned
  all 224 workloads on the account, and a `nextCursor` pasted back into the filter returned the page
  it names.
- **A warning when a submitted OpenQASM 3 circuit calls `id`.** The palette has dropped identity
  since 0.3.3, because a bare `id q[n];` failed every job it appeared in with
  `the instruction u on qubits (n,) is not supported`, but a circuit imported or pasted straight
  into Submit got no such treatment: the ISA scan passes `id`, since it is in the basis, and
  `stdgates.inc` defines it, so neither existing check could object, and the job failed the
  expensive way. The Sampler, Estimator and Noise Learner submits now warn about `id` in any operand
  form (`id q[0];`, `id $0;`, `id qr[3];`) and say what to do: remove it, identity is a no-op. The
  cause recorded in 0.3.3, that IBM's target refuses the builtin `U`, was stronger than the
  evidence: IBM's OpenQASM 3 feature table marks `U` as supported and its native gate list names
  `id` on Heron, so the likely culprit is the importer expanding the `stdgates.inc` definition
  `U(0, 0, 0)` before the target sees it. Re-measured on 2026-09-07, it still happens: a bare `id`
  failed a job with the same "the instruction u on qubits" message the warning quotes, so the
  warning stands. `id` stays in the ISA basis because IBM still lists it in `basis_gates`, as
  `ibm_marrakesh` did when read on 2026-09-08.
- **Include Circuit Params on Get Status.** The toggle Get Many has had since 0.2.2, defaulting the
  other way: on, so a status read returns the job exactly as before, circuit included. Off sends
  `exclude_params=true` and returns the state alone, the right size for a loop that checks a job
  every few seconds or for an AI Agent asking whether a job finished. A workflow saved without the
  field and an expression that resolves to nothing both keep today's body; every other value is read
  as the switch it spells, the way every switch in the node is read.
- **Workload Get Many hands back the paging tokens.** IBM answers the listing with `next.href` and
  `previous.href`, two URLs, while the Next Cursor and Previous Cursor filters want the token inside
  them, and nothing said which part to paste. Each response now carries `nextCursor` and
  `previousCursor`, the `next` or `previous` query parameter read out of the matching link, or
  `null` when the link is absent or carries no such parameter, so a loop can feed one page's output
  straight into the next request. The raw body is untouched and the links stay in it. The token
  format is IBM's own, and the value is percent-decoded and otherwise passed through as written;
  measured on 2026-09-07 it is base64 of a timestamp, and it round-tripped through the Next Cursor
  filter to the second page.

### Changed

- **The ISA warning is judged against the backend you chose, not a fixed list.** `ISA_INSTRUCTIONS`
  was the Heron union (cz, id, rx, rz, rzz, sx, x), so `rx(0.3) $0;` aimed at a Nighthawk r1 device
  (`ibm_miami`, `ibm_berlin`, whose published basis is `cz, id, rz, sx, x`) passed the scanner and
  failed at IBM after being queued and charged. The backend configuration the coupling check
  already fetched carries `basis_gates` next to `coupling_map`, so the submit now reads it once for
  every OpenQASM 3 circuit, single-qubit ones included, allows that list plus whatever the
  configuration names under `supported_instructions` (IBM lists measure_2, if_else, store and the
  like there, and a Heron device with fractional gates off may list rx and rzz only there) plus
  measure, reset, delay and barrier, and the warning names that backend's own `basis_gates`, the
  list Get Configuration shows. When the configuration cannot be read or lists no usable gates the
  Heron union stands in and the wording is unchanged from 0.5.0, so a workflow matching on
  `which is not in the IBM basis` still matches on that path and needs `basis (` on the other. The
  cost is the same one GET of about a second that two-qubit circuits already paid; QPY still makes
  no extra call. Not verified live against a Nighthawk device: the basis list comes from IBM's
  published fake-backend configurations, and the warning quotes the list it used so it can be
  compared with Backend Get Configuration. The warning for an rzz call without a definition now says
  rzz is in the Heron basis rather than the IBM basis, so on a Nighthawk device, whose list has no
  rzz, it no longer contradicts the ISA warning printed beside it.
- **Get Results polls without the circuit.** The loop read `GET /jobs/{id}` with no query, and on
  that endpoint IBM's `exclude_params` defaults to false, so every check, every five seconds for up
  to a day, carried back every circuit the job was submitted with: for a hundred-circuit job or a
  large QPY, the whole payload downloaded and parsed to learn one word of status. The trigger
  already sent `exclude_params=true` on its scans; Get Results now sends it on every poll, retries
  included, and the result itself still comes from `/results`, which is untouched. One visible
  consequence: the `job` body returned with `timedOut: true`, or with a failed or cancelled status,
  no longer carries `params`. A workflow that read the circuit back from there should use Get
  Status, which keeps returning it.
- **Circuit Build reports `instructionCount` beside `gateCount`.** `gateCount` counts the rows in
  the gate list and always did, so a list with one identity reported seven gates for six emitted
  lines, confirmed in a running n8n. `instructionCount` is the number of instruction lines actually
  written to the program, so a dropped identity is visible as the difference. `gateCount` keeps its
  meaning and its value.
- **Include Simulators is marked deprecated, and the docs stop promising simulators.** IBM retired
  its cloud simulators on 15 May 2024, and its OpenAPI spec now marks the `is_simulator` field the
  toggle reads as deprecated, stating that all devices are real quantum hardware and that the field
  will be removed. The toggle stays, so a saved workflow keeps loading and the output shape is
  unchanged, but its description, the analytics Simulators filter, the README section and
  `llms-full.txt` now say what it does today, which is nothing. When IBM drops the field the filter
  already keeps every device, so no code needed to change; a test pins that.
- **The analytics, Session Close and Max TTL descriptions say what IBM documents.** The three
  usage analytics operations report every usage and queue-time figure in milliseconds, which the
  spec states on each field, while the descriptions said seconds, the unit Get Usage and Get Metrics
  use. Session Close and Max TTL changed with them, and are covered under Fixed, with the session
  facts behind them.
- **The trigger describes itself as a trigger.** Its node description was action-node-style prose,
  "Run quantum circuits ..., and start a workflow when a job finishes", which n8n shows in the node
  panel and the registry preview. It now says the node starts a workflow when a job reaches a
  terminal state, carrying the failure reason and code when there is one.
- **Node.js 24 is the documented runtime.** n8n has declared `engines.node >=24.0.0` since 2.36.0
  (August 2026), so the "Node.js 22 or 24" wording in the README badge, the install requirements,
  AGENTS.md, CONTRIBUTING.md and llms-full.txt now says Node 24, with Node 22 named only for n8n
  2.35 and older. `engines.node` stays `>=22` and CI keeps the 22 and 24 matrix, so nothing changes
  for an installation that still runs on Node 22; the comment on the matrix in `ci.yml` records
  why 22 is still there.
- **Four claims about n8n caught up with n8n.** CONTRIBUTING no longer says every change needs a
  restart: since n8n 2.29.0 (30 June 2026) a symlinked community node is reloaded without one, so
  a rebuild is enough there and a restart is only for older releases. The README now gives both
  ends of the tool-usage flag's short life: `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE` arrived with
  PR #13075 in February 2025 and n8n 1.85.0 (PR #14042, March 2025) removed it. The MCP `mode`
  story is told as what it is, an observation: on 0.4.1 `get_node_types` for session/create came
  back without `mode`, and `@n8n/workflow-sdk` treating `resource`, `operation` and `mode` as
  discriminator fields is the likely cause, not a documented rule that n8n "drops" the parameter.
  The 0.4.1 entry below stated it as a rule; the rename to `sessionMode` stands either way. The
  codex `nodeVersion` test comment now records the conflict it settles: n8n's codex docs say the
  value should match the node's `version`, the n8n review asked for `1.0` twice, and the review
  wins because it gates verification.
- **The documentation is rebuilt around the new surface, and a test keeps it there.** The
  README's operation table, `llms-full.txt` and `llms.txt` describe every operation and every
  parameter this release adds under its internal name, with defaults, bounds and output shapes,
  and the Account operations are listed in the same order in both files. `AGENTS.md` records the
  fourth host, the Resource Controller's timestamp rule, the weekly cadence of the `n8n-workflow`
  pin, the n8n CLI lint that CI now runs and the release steps that live outside this repository.
  A new metadata test reads every operation value and every parameter name out of
  `descriptions.ts` and fails unless `llms-full.txt` names each one and `README.md` names each
  operation, so the next parameter cannot ship undocumented. The panel screenshots still show the
  0.5.0 node, and their captions now say so.
- **Lint and Prettier now cover `tests/` and `scripts/`.** Both were outside every check:
  `eslint.config.mjs` listed `scripts/**` in its ignores and had no entry for `tests/`, so eslint
  reported every test file as ignored, and the `format` scripts named `nodes` and `credentials`
  only. The whole test suite and the QA harness were held to nothing the rest of the repository is
  held to. Tests are now linted under the community-nodes ruleset plus the eslint and
  typescript-eslint recommended rules; scripts under the eslint recommended rules with Node
  globals, and not under the community-nodes ruleset, whose `no-restricted-globals` bans the
  `process` and `setTimeout` the harness needs. The verification scanner reads `package.json` and
  `{nodes,credentials}` on its source leg and the published tarball on the other, so no test was
  ever in either scope; what is new is that `npm run lint`, and the `n8n-node lint` step that runs
  `eslint .`, catch a `node:fs` import in a test here instead of nowhere. Running the wider checks
  found 15 files Prettier rewrites, 14 tests and `scripts/qa-run.mjs`, whose one-line blocks
  expand from 326 to 604 lines, and two `no-empty` errors in the harness's cleanup loop, now written
  as `.catch(() => {})` with the reason stated. No test changed meaning, every test passes as
  before, coverage stays at 100 on all four metrics, and the rules applied to `package.json`,
  `nodes` and `credentials` are identical, checked with `eslint --print-config` before and after. CI
  is unchanged: it already ran `npm run lint` and `npm run format:check`, which now see more files.
  A test pins the four scripts' scope so it cannot quietly shrink back.
- **The lint now reads every file the verification scanner reads, and bans `console`.** The config
  said it mirrored the scanner's and did not, in three places: the scanner adds `no-console` as an
  error with no `files` key, so it covers everything it lints, and the config never enabled it;
  `index.js` sat in the config's `ignores` while the scanner's tarball leg lints it; and the three
  codex `.node.json` files matched no `files` block while the scanner's source glob takes them in.
  All three were clean, so nothing was failing, but a `console.log` in a node source, or a
  hardcoded secret in `index.js` or in a codex file, passed `npm run lint` green and failed the
  gate. The `files` list is now the scanner's own source glob verbatim plus `index.js`, on top of
  the `tests/` the ruleset already covered, so a `nodes/*.js` added later is covered too, and the
  `lint` and `lintfix` scripts name `index.js`. Measured with `eslint.calculateConfigForFile`
  against a real install of the 0.35.0 scanner, the two configs now agree rule for rule and
  severity for severity on all 15 files the source leg reads and on `index.js`: 63 rules on
  `package.json`, 138 on a node source, 58 on the credential, 44 on `index.js` and on each codex
  file. Only the compiled `dist/**/*.js` of the tarball leg stays outside, since CI builds after it
  lints.

### Removed

- **Seven screenshots that nothing referenced.** `.github/images/` held the PNGs the README embedded
  up to 0.2.3. The README rewrite of 2 August 2026, shipped with 0.3.3, retook every screenshot
  under `readme-assets/` and stopped pointing at the old set, which stayed behind: 3.4 MB, 63
  percent of every byte in a checkout, referenced by no file in the repository. They are deleted.
  Nothing else moves: `readme-assets/` is the only image directory the documentation uses, the
  npm tarball never carried `.github/`, and lint, the build and the tests never read it. The
  blobs stay in git history, so a checkout of any tag up to v0.2.3 still renders its README. Only
  a README from those versions rendered against the current default branch, which is how npm
  shows the pages of 0.1.0 to 0.2.3, loses the seven images.

### Fixed

- **The coupling map check and the noise learner warning now read physical qubits and any register
  name.** `multiQubitOperands` matched only the literal `q[n]`, so the two checks built on it were
  blind to exactly the circuit the README recommends: Qiskit's exporter writes `cz $0, $1;` for a
  transpiled circuit, and `qubit[4] qr; cz qr[0], qr[3];` was invisible as well. For those programs
  the coupling map was never read and a second entangling layer was never counted, so the job went
  out unwarned and failed at IBM the expensive way, after queueing. The scanner now reads `$n` as
  physical qubit n, reads an indexed register of any name, lays a second quantum register out after
  the ones declared before it (the order IBM's importer uses, so `b[0]` after `qubit[2] a;` is qubit
  2), and never reads a classical bit as a qubit. Spacing inside a declaration is free on one line
  and the legacy `qreg a[2];` declares as much as `qubit[2] a;` does, so `qubit [2] a;` offsets what
  follows it and `bit [2] q;` makes `q` classical. A size that is not a plain number is not read at
  all, so `qubit[N] a;` offsets nothing and `bit[N] c;` still looks like a quantum register. `q` is
  no exception to either rule: `cz q[0], q[1];` after `qubit[2] a; qubit[2] q;` now reads the pair 2
  and 3 where the literal match read 0 and 1, so a circuit that declares another quantum register
  before `q` can gain or lose an uncoupled-pair warning, and `bit[2] q;` makes the name classical
  and unread. What Circuit Build writes, one `qubit[n] q;` with no other quantum register ahead of
  it, scans as it did. Operands are still deduplicated per statement, so `cz $3, $3;` counts as
  nothing; the configuration GET now also runs for a transpiled circuit carrying a two-qubit gate.
  Two details of the line scan moved with it: statements sharing a line are read one at a time, each
  through the declaration readers and the barrier exclusion, so
  `cz q[0], q[5]; c[0] = measure q[0];` keeps its pair, `cz q[0], q[1]; barrier q[0], q[5];` is one
  coupled pair and not a barrier flagged as an uncoupled one, and two `cz` on one line count as two
  layers; and a trailing `//` comment is no longer read, so an indexed name in it cannot widen a
  pair into a group the check ignores. The README's Bell circuit for `ibm_fez` is pinned as a test
  in both spellings, the `$n` form of the transpiler section and the `q[n]` form the palette table
  builds.
  *Found by the 2026-09-04 audit, running the compiled scanner on the README's own transpiled
  circuit.*
- **The coupling warning stops after twenty pairs instead of writing one for every pair in the
  circuit.** Repeats of a pair written the same way round were collapsed, the number of distinct
  pairs was not, and that number grows with the square of the qubits an untranspiled circuit touches,
  which is the circuit this check exists to catch. An all-to-all cost layer on 100 virtual qubits,
  checked against the coupling map `ibm_fez` publishes, put 4839 near-identical sentences on the
  output item, 0.72 MB that n8n then keeps in the execution record, and wrote 4839 lines to the n8n
  log for one submit; the same shape on 156 qubits was 11,914 of each. Every line carried the same
  advice, so the node now names the first twenty distinct pairs, in the order the circuit writes
  them, and closes with one sentence counting what it did not name: `Circuit puts two-qubit gates on
  4819 further pairs ibm_fez does not couple, not listed here. Transpile the circuit for ibm_fez
  before submitting.` The log is written from the same list, so this check's share of the log stops
  at twenty-one lines as well. A pair now counts once whichever way round the circuit writes it, so
  `cz q[0], q[5]` and `cz q[5], q[0]` are one sentence where 0.5.0 wrote two; apart from that and
  from the scanner change above, a circuit offending on twenty distinct pairs or fewer reads exactly
  as it did, and this change altered nothing about which pairs are wrong: the check still reads
  every pair, it just stops writing them out.
- **A tag list an expression could not resolve no longer wipes every tag on the job.** Update Tags
  PUTs the whole list, so anything the reader drops is a tag deleted from the job. 0.5.0 closed that
  for a value that is not a list at all, refusing `null`, an object and a boolean; one level down it
  stayed open. `parseCsvList` reduces every entry it cannot read to nothing, so `{{ $json.tags }}`
  resolving to a list of objects, of nulls, of booleans, of lists or of blank strings reached the
  request as `[]`: the node PUT that, deleted every tag on the job, and reported success with
  `{"jobId": "job-1", "tags": []}`. One unreadable entry among good ones was quieter still: the node
  PUT only the entries it could read, so the tag that entry stood for never reached the job and the
  tags the job already carried were replaced by the narrowed list. Update Tags and every Submit now
  refuse a list carrying an entry that is blank or is neither text nor a number, naming the entry:
  "Tag 2 in the list is blank or is not text. Leave Tags empty to remove every tag from the job."
  Nothing is sent. Clearing on purpose is unchanged, an empty value or an empty list, and so is a
  list whose entries are non-blank text or numbers, where each entry is one tag and a comma inside
  an entry belongs to that tag. The reader itself stays permissive, because the tag filters on Job
  Get Many, Workload Get Many and both triggers are built on it: a filter it cannot read at all is
  simply no filter, and an entry it cannot read drops that tag from the filter, which widens the
  match rather than destroying anything.
- **A twirling count or a PEC noise gain an expression could not resolve is refused instead of
  dropped.** All three fields arrive with this release, in the primitive options work above, so no
  published version ever dropped a value and no job ever ran under one; the defect was caught here.
  `requireBoundedNumberOrAuto` reads Number of Randomizations, Shots per Randomization and PEC
  Noise Gain, and as first written it began by coercing the value to trimmed text, which flattens an
  array, a boolean and an object to the empty string. The empty string is how a user clears one of
  these fields, so those values read as "send nothing": the key would have disappeared from
  `options.twirling` or `options.resilience.pec` and the job would have run on hardware under IBM's
  default for the mitigation that was asked for, with nothing to say so. The submit result carries
  `jobId`, `backend`, `primitive`, `sessionId`, any warnings and IBM's POST body, which is the job
  id, backend, session id, private flag and calibration id, never the options, so nothing
  downstream could have told those numbers apart from a run of the setting that was asked for. An
  expression resolving to a one-element array, `[32]`, was the easiest way in; `null`, `true`,
  `false`, `[]` and `{}` did the same. PEC Max Overhead, the numeric field beside PEC Noise Gain in
  the same collection, already refused such a value, and so did Repetition Delay in Execution
  Options, both with a message naming the parameter, and so did these three for text that is not a
  number. They now refuse it too, each with the message it already gave that text:
  `Number of Randomizations must be "auto" or an integer between 1 and 2147483647.` Nothing is sent.
  Only two inputs still leave the key out, an entry that is not there, whether never added or added
  with an expression that resolved to nothing, and one whose text is empty or blank.
- **A circuit made mostly of blank lines no longer freezes the whole n8n process.** 0.5.0 narrowed
  the OpenQASM header check off a leading `\s*` run for this reason, and the `id` scan followed it,
  but the two `rzz` tests, the `gate rzz` line the first of them strips, and the noise learner's
  classical-register test kept that shape. `\s` matches a line terminator, so under /m every line
  start in the text is another place to scan the rest of it from, and a run of blank lines costs a
  square. Measured before this change, on the scans as 0.5.0 shipped them, on one instruction
  followed by N blank lines: a 39 KB circuit took 1744 ms in `undefinedGateWarnings` and 832 ms in
  `noiseLearnerWarnings`, a 78 KB one took 6786 ms and 3464 ms, and every doubling cost four times
  as much. The scans are synchronous and run once per circuit for up to the 100 circuits a submit
  accepts, so ten 39 KB circuits held a Sampler submit for 17.9 seconds before the request went out,
  and held with it the one thread that runs every other workflow on the instance: a scheduled
  trigger misses its slot, a webhook times out, and nothing in the UI names this node. The circuit
  is normally an expression from an upstream node, and the node is usable as a tool, so that text is
  rarely the user's own by the time it arrives. All four patterns now use the header check's leading
  class, which excludes the four line terminators and matches every other character `\s` does: the
  same ten circuits take 26 ms, and ten of 156 KB 93 ms. The register test moves its verdict for
  three line endings, towards what the docs already described: it now reads `bit[n]` on a line
  opened by a bare carriage return, by U+2028 or by U+2029, which the header check and the `rzz`
  and `id` scans already read. The warning still needs two entangling statements beside it, and the
  reader that counts them splits on `\n` alone, so a file written with one of those three stays
  silent while a `//` comment sits ahead of its entangling gates, or a `gate` block anywhere in it.
  The `rzz` and `id` scans change no verdict at all, because `^` under /m already opened a line at
  those three.
- **A Register Name the result does not carry no longer throws the result away.** Get Results
  fetches `GET /jobs/{id}/results` and then handed the body to the parser, which raised for a
  `registerName` no pub carried; the handler turned that into a node error and the downloaded body
  went nowhere, not even into the `{ error }` item that Continue on Fail produces. IBM's spec for
  the `private` flag says "the results can only be read once. After the results are read, they are
  deleted from the service", so for a job submitted with the node's own **Private** toggle that
  discarded read was the only read there will ever be: the shots were gone, the QPU time was spent
  twice, and the second Get Results reported `resultsAvailable: false` with nothing to say where the
  data went. Reaching it takes one typo in a free-text field, and the two circuit sources disagree
  on the name: Circuit > Build always writes `c`, while a Qiskit circuit exported after
  `measure_all()` names the register `meas`. The counts now come back with `registerError` carrying
  the sentence the error used to carry, naming the register asked for and listing the ones the
  result has. Another register's counts never come back under the name that was asked for: a pub
  reading another register is marked `registerFallback: true` with `requestedRegister`, which is
  what a pub already did when some other pub carried the name. Two shapes stop failing, both of them
  after the request: a plain sampler body whose registers are all named something else, and the
  serialised Qiskit encoding, where the names compared are the PUB field names, so a Register Name
  that is none of them failed even on an estimator result, on `evs, stds`. A workflow that relied on
  the failure to stop should branch on `registerError`, which a plain-encoding result carrying no
  classical register at all never carries. The parser also stops throwing on a `results` entry that is not an
  object: reading `pub.data` off a null one took the whole downloaded body with it, the readable
  pubs included, and such an entry now reads as an empty pub, the way a string one already did.
- **Get Results reads the encoding IBM uses for jobs submitted from Qiskit.** IBM picks the result
  encoding from the submitted parameters, not from the endpoint. Without `support_qiskit` the body
  is plain JSON under `results`, which is what this node submits and what the parser read. With it,
  which is what `qiskit-ibm-runtime` sets by default, the body is a serialized Qiskit object graph
  with no `results` key at all, and the parser found nothing: `pubCount: 0`, an empty `pubs`, and
  `resultsAvailable: false`, which llms-full.txt read as no result body. Measured on one account
  on 2026-09-07, that was 25 of 160 completed jobs, one of them 457 KB of expectation values with
  zero-noise extrapolation reported as nothing, and another 15 PUBs reported as none. The same
  mistake the noise learner shape caused once already, in the same function, for the same reason.
  Both primitives are now read: a sampler entry carries `register`, `numBits` and `samplesEncoded`,
  an estimator entry carries `fieldNames` and `fieldsEncoded`, and both are marked
  `encoding: "qiskit-serialized"` so a workflow can branch on it. The arrays stay compressed and
  encoded, as the noise learner rates already do, because `zlib` is not on the community node import
  allowlist. One body in that sample is not valid JSON at all, since IBM writes a bare `Infinity`
  for an unbounded value; rather than rewrite a server response before reading it, that case now
  says so in `resultsUnreadable` and leaves the text in `raw`. Output for the plain encoding is
  unchanged, verified against all 160 bodies.
- **Get Results reads IBM's older array encoding, and stops calling every job that uses it a noise
  learner.** A result body carrying a top-level `data` array and no `results` was read as a noise
  learner on that shape alone, and the reader then looked for the keys a version 2 learner writes.
  Two programs use the same container and write different keys, so both came back empty. IBM's
  Executor writes `{ results, metadata }` per entry, and the noise learner has an older flat layer
  shape, `{ generators_sparse, num_qubits, rates, rates_std, metadata }`, whose arrays arrive as
  `{ data, shape, dtype }` rather than as the serialised object graph. The discriminator now
  requires every entry to look like a learned layer before the learner reader runs, an Executor
  body is read as `type: "executor"`, and the flat layer shape is read as a learner layer with its
  arrays passed through under `encoding: "ibm-array"` with the `shape` and `dtype` IBM sent, the
  same way the serialised rates already travel. Measured on the same 160 bodies: 14 use the array
  container, 4 of them Executor jobs and 6 of them flat learner jobs. Those 10 jobs, 21 entries
  between them, each came back as `{ type: "noiseLearner", qubits: null, generators: null,
  ratesEncoded: null, circuitEncoded: null }`, so the entry count was right and every value in it
  was gone; they now carry their generator lists, their rates and, for the Executor, its registers.
  The other 4 are the serialised spelling and are untouched. Replaying all 160 bodies through the
  reader gives output identical to what the live 0.6.0 node produced for 125 of them, 25 more that
  the serialised-encoding fix above turns from no pubs into pubs, and these 10.
- **A warning for a fractional gate submitted where gate twirling is on.** IBM refuses a circuit
  carrying `rx` or `rzz` wherever gate twirling runs, with code 1519, "Gate twirling does not
  support fractional gates", and twirling runs in more places than the Gate Twirling toggle: an
  Estimator at Resilience Level 2 or with PEC Mitigation twirls, and the noise learner always does,
  since twirling is how it learns. Measured on `ibm_marrakesh` on 2026-09-10: an Estimator job at
  resilience 2 on an ansatz with `rx`, and a noise learner job on a layer carrying `rzz`, were
  accepted, queued, and failed with 1519, while the node had warned about nothing; the README had
  described the toggle case since 0.5.0 and said nothing about the learner. Submit now reads the
  final request, decides whether twirling is on and through what, scans the circuit for `rx` and
  `rzz` calls, gate bodies included, and warns naming the gates and the source: `Gate Twirling`,
  `Resilience Level 2, which IBM twirls`, `PEC Mitigation, which IBM twirls`, or `the noise
  learner, which always twirls`. The same noise learner circuit transpiled without fractional
  gates completed, and the documentation now says to transpile that way for those runs. Together
  with the two warnings above this makes six submit checks, listed in llms-full.txt in order.
- **A warning for `rzz` called outside `[0, pi/2]`, the only range IBM's fractional `rzz` runs.**
  Qiskit transpiling against a bare `basis_gates` list with the coupling map, the shape a script
  reaches for when no backend object is at hand, folds `rzz` angles freely, because the list
  carries no angle range where a backend target does. Measured on `ibm_marrakesh` on 2026-09-10: a
  Grover search and a QFT round trip transpiled that way carried `rzz(-1.5707963267948966)` and
  `rzz(-0.7853981633974483)`, were accepted, queued, and failed with code 1517, "The instruction
  rzz on qubits (0, 1) is supported only for angles in the range [0, pi/2]", with no warning from
  the node, whose gate table had stated that range since 0.5.0. Every `rzz` call whose angle is a
  number, or `pi` scaled by a number, is now read at submit time, and one warning names each
  distinct angle outside the range; a parameter name or any other expression is left alone, since
  it cannot be judged before IBM binds it. The same two circuits transpiled against the backend
  without `rzz` in the list, so that Qiskit writes the interaction with `cz` and `rz`, carry no
  such call, and the README's transpile recipe now says why the backend object is the thing to
  pass.
- **The undefined-gate warning now covers every basis gate `stdgates.inc` does not define, not `rzz`
  alone.** On 2026-09-10 all three Heron devices this project reaches, `ibm_fez`, `ibm_kingston` and
  `ibm_marrakesh`, list a new gate, `xslow`, in `basis_gates` and in `supported_instructions`; two
  days earlier none did. Being in the basis kept it out of the ISA warning, and the definition
  warning was written for `rzz` by name, so a circuit calling `xslow` bare passed both checks
  silently, was accepted and queued, and failed at IBM with code 1603 naming `gate 'xslow' is not
  defined`, measured on `ibm_kingston`: the same failure a bare `rzz` has always drawn, with no
  warning at all. The check now takes the backend's own `basis_gates`, keeps every entry
  `stdgates.inc` does not define, `rzz` and `xslow` today and whatever IBM adds next, and warns once
  per such gate the circuit calls without a `gate` block of its own, naming the gate and the
  backend. The `rzz` wording is unchanged; the other gates get the same sentence with a generic
  remedy. One behaviour moves with it: on a device whose basis has no `rzz`, the Nighthawk devices,
  a bare `rzz` no longer draws advice to define a gate the device cannot run, and the ISA warning
  alone reports it, naming that device's basis. The set `stdgates.inc` defines is now named once, in
  `qasm3.ts`, and the reserved parameter names are built on it. The ISA warning already named the
  new gate on its own, `not in the ibm_kingston basis (cz, id, rx, rz, rzz, sx, x, xslow)`, measured
  the same day.
- **Session Mode and Circuit Format are bounded locally, like every other options field.** Both went
  into the work they drive without a check. A Session Mode naming neither `batch` nor `dedicated`,
  which is what an expression reading a column of free text produces, was sent as IBM's `mode` and
  came back as a bare `Internal server error` naming no field at all, measured live on 2026-09-08. A
  Circuit Format naming neither `qasm3` nor `qpy` fell through to the OpenQASM field, which n8n does
  not display for it, so the run failed on n8n's own `Could not get parameter "qasm3"` and pointed
  at a field the user never touched. Each is now refused before the request with the field named and
  its two values listed, the same shape Rank By and Plan already used. A value an expression leaves
  empty still keeps the default, `batch` and `qasm3`, so nothing saved before this changes. IBM's
  own refusal of a Dedicated session on the Open plan is untouched and still arrives as code 1352,
  re-measured on the same day: "You are not authorized to run a session when using the open plan."
- **Get Logs asks IBM for text, so `logs` is always a string.** IBM declares the endpoint
  `text/plain` and the docs said `logs` is that text, but the request went through the same helper
  as every JSON call, so n8n parsed whatever came back: a log body that is itself valid JSON
  arrived as an object, and one that parses to a value with no fields, a bare number among them,
  arrived as an empty string. A workflow calling `.split('\n')` on it threw, and the type it threw
  on depended on what the job happened to log. The request now sets `encoding: 'text'`, which the
  transport takes as an argument so no other call changes, and the operation returns the body
  verbatim. `{ jobId, logs }` is unchanged in shape, `logs` is a string in every case, and the
  `typeof logs` check the documentation used to ask for is gone from it.
- **Shots is bounded before the job goes out.** Every other user-supplied bound in the node is
  refused locally with the limit named, tags at 86 characters, calibration id at 100, session id at
  36, circuits at 100 per job, but shots had no ceiling at all and any number reached IBM. The spec
  bounds it only by int32, so the spec was no help: measured on `ibm_fez`, both 2147483647 and
  3000000000 were accepted at submission and then failed the job with "The number of circuit shots N
  exceeds the system limit 10000000". A value above ten million now fails the item with
  "Shots is N; IBM accepts at most 10000000 per circuit." before the request, so the answer arrives
  with the submit instead of one poll later, and no failed job is left in the history. The floor is
  unchanged and now documented: a fraction is floored, and a value below 1 or unreadable falls back
  to the default 1024, which is what every count field in the node does.
- **Additional Options no longer suggests a key IBM refuses, and checks the keys before the job goes
  out.** The field, the README and `llms-full.txt` all gave
  `{"environment": {"log_level": "DEBUG"}}` as the example. `environment` is not a key the REST API
  has: it is the Python client's bundle for `log_level`, `job_tags` and `private`, which the client
  unpacks into job fields this node already exposes as Log Level, Tags and Private. IBM's OpenAPI
  spec (0.50.5) declares `params.options` as `additionalProperties: false` for all three programs,
  so anyone who copied the example wrote a job the schema rejects, with a message that names no
  field. The node now refuses an unknown top-level key locally, before any request, naming the key,
  the program and the keys the schema allows: six for Sampler, nine for Estimator, eight for the
  noise learner. The example is `{"execution": {"rep_delay": 0.00025}}`. The lists live in one
  exported constant, a test pins them to the spec, and another ties the documented example to them,
  so the field cannot recommend a key the node itself would refuse. Nested keys are still left to
  IBM. The rejection was read from the schema, not reproduced live.
- **A session ID longer than 36 characters is refused before the request.** `POST /jobs` declares
  `session_id` as 1 to 36 characters, the length of the UUIDs Session Create returns, and every
  other bound in that schema was already applied locally; this one was sent as typed. The error
  names the length and the limit.
- **The Program filter on Job Get Many offers Noise Learner.** The node submits `noise-learner`
  jobs, and the filter offered only Sampler and Estimator, so those jobs could be listed but never
  filtered by program.
- **An empty-string body is treated like an empty one.** The transport turned `null` and
  `undefined` into `{}` since 0.4.1 but let an empty string through, the third shape n8n's request
  helper can return for a body with no content. Harmless so far, since the only empty answers come
  from write endpoints whose bodies are ignored and from the results endpoint, which already
  reported them as missing, but every reader now sees one shape.
- **Get Least Busy survives a backends listing that is not shaped like one.** It read
  `response.devices` with `?? []`, which stands in for `null` and `undefined` only, so a `devices`
  key that came back as a string or an object reached `.filter`, and a `null` entry inside the array
  reached the ranking. Both ended the item with a bare JavaScript message, `devices.filter is not a
  function` and `Cannot read properties of null (reading 'is_simulator')`, naming neither the
  operation nor the cause. The listing is now checked for shape and an entry that is not an object
  is skipped, the guard the backend dropdown already applies to the same endpoint, so a body the
  node cannot rank answers `leastBusy: null` with an empty `candidates`, which is what it already
  answers when no device qualifies. A well-formed listing ranks exactly as before, and Backend > Get
  Many still hands the body back untouched. This is the defect 0.3.3 closed in the results reader
  and 0.5.0 in the trigger's job list, in the last body it was left in; AGENTS.md carries the rule.
- **Get Least Busy always answers with `leastBusy`, and every candidate with a `name` and a
  `qubits`, holding `null` where IBM reported nothing.** Three fields were copied straight off the
  device, `best.name` behind `leastBusy` and `name` and `qubits` on each candidate, while
  `queue_length`, `processor_type` and `wait_time_seconds` beside them went through a reader that
  ends in `null`. A device carrying no `name` and a device carrying no qubit count therefore put
  `undefined` in those keys, and a key holding `undefined` is gone once n8n has serialised the item:
  `leastBusy` was missing from the output rather than `null`, and so were `name` and `qubits` on
  that candidate. llms-full.txt types the field `leastBusy: string|null` and tells the reader to
  handle the null, so a check written the way the documentation asks for it,
  `$json.leastBusy === null`, and an IF node comparing against null both read a key that was not
  there and took the wrong branch. The candidate case is a body IBM's own spec allows: it declares
  `qubits` nullable and leaves it out of the required device fields, which are `name`, `status` and
  `queue_length`. All three are now read the way `queue_length`, `processor_type` and
  `wait_time_seconds` already were, so every key of the documented shape is present on every body
  IBM can send, and a name that is not text, or a qubit count that is not a number, reads `null`
  instead of reaching the item as IBM sent it; AGENTS.md carries the rule. Ranking, filtering and
  the order of the candidates are untouched.
- **Circuit > Build survives a gate list that is not a list.** The same read one level down, and the
  one an AI Agent tool fills most freely: the `gates` collection was checked for shape, its `gate`
  key was not. Set by an expression to a string or an object it reached `.map`, and a `null` entry
  inside it reached the field reads, ending the item with `rawGates.map is not a function` or
  `Cannot read properties of null (reading 'gate')`, while `gates` itself set to a string was
  already tolerated as no gates. A `gate` key that is not an array now means no gates too, and an
  entry that is not an object reads as an empty one, so it is refused as `Gate #N: Unsupported gate:
  undefined` by its own number, the message a text entry already got, rather than being dropped and
  shortening the circuit in silence. Every well-formed gate list builds exactly as before.
- **Circuit Parameters no longer costs a square to read.** The duplicate check was
  `names.includes(name)` inside the loop over the declared names, a fresh scan of everything read so
  far for every name, so the field's cost grew with the square of its length: 1,000 names took 1 ms,
  10,000 took 80 ms, 40,000 took a second, and a duplicate at the end of a 60,000-name list took 2.6
  seconds to be reported, all of it on the one thread the whole n8n process runs on. The names now
  go into a Set, which answers the same question in one step, and the returned list is that Set's
  insertion order, so it is still the declaration order the `input float[64]` lines and the output's
  `parameterNames` follow. Nothing a workflow can see changes: the same lists parse to the same
  names, the same three refusals fire with the same messages, and a name that also sits on
  `Object.prototype`, such as `__proto__` or `toString`, is a name like any other, which a test now
  pins. No circuit anyone would write reaches the length where this was felt; it is closed because
  the field has no length bound and an expression can fill it from an upstream row, and because a
  cost that grows with the square of its input has now been found in three other places in this
  node, two of them in this release.
- **A length bound no longer copies the value it is refusing.** Ten values have their length
  counted by `characterLength`: Job ID, Backend, Backend Name, Session ID, Instance CRN, Account
  ID, Plan ID, a job tag, the tag search and Calibration ID. It counted with `[...value]`, which
  builds one array element per code point before the bound can say no, so refusing a runaway value
  cost several times that value in heap: a 32 MB Job ID took 256 MB and 148 ms to reject, a tag of
  the same size took 256 MB and 441 ms because the message then spread the tag twice more, a 64 MB
  tag of emoji took 1.6 seconds, and counting 64 MB of unpaired surrogates, which a tag may also be,
  took 1 GB and 980 ms. The count now walks the string one code unit at a time and allocates
  nothing: the same Job ID is refused in 69 ms, the same tag in 137 ms and the emoji tag in 101 ms.
  The excerpt in the too-long-tag message is taken from the first 40 code units rather than from the
  whole tag, since 20 characters can never span more. Nothing a workflow can see changes: every
  count is the number spreading gave, unpaired surrogates included, and every message reads to the
  character as it did, which two new tests pin. Nobody types a megabyte into Job ID; the value
  arrives from an upstream row, which is the case the bound was added for in 0.5.0.
- **An error from IBM now names the input item it came from.** With Continue on Fail off a failure
  ends the run, and the item n8n points at is the one on the error. Every error the node's own code
  raises carried it; no error from IBM did, on all 34 operations that make a request. The node's
  catch passes the index to `asNodeError`, but n8n's `NodeApiError` constructor hands back an error
  it already wrapped and ignores an item index given with it, and the transport wraps IBM's error
  where the request is made, so the index had nowhere to land. It is now written onto the error
  itself, and an index set closer to the failure is left as it is. *Before:* a three-item run
  failing on the second item threw `Instance not found` pointing at no item. *After:* the same run
  throws it with `itemIndex: 1`.
- **Every switch an expression fills is now read as the switch it spells.** n8n type-checks a
  parameter only while the user is typing it, so a toggle driven by `={{ ... }}` reaches the node as
  whatever the expression produced, and the node read its eighteen switches four different ways,
  coercing none of them. Read for truth, the string `'false'` turned Dynamical Decoupling and both
  Twirling switches ON and wrote `dynamical_decoupling.enable`, `twirling.enable_gates` and
  `twirling.enable_measure` into the request; compared with the boolean, `'true'` left Private,
  Clear Limit and all three Return All switches OFF; passed through untouched, Accepting Jobs sent
  IBM the string `"false"`, or an array, in place of a flag; dropped for not being a boolean, a
  `'false'` on Measurement Mitigation or Initialize Qubits left IBM's own default in force.
  Accepting Jobs was the only one whose raw value an output item echoed back; the rest showed only
  in what IBM did with them, such as the `private` flag on a submit response and the submitted
  `params` a Get Status hands back. One reader, `requireBoolean`, now serves all eighteen, with
  `optionalBoolean` behind it where an entry never added has to leave the key out. It accepts the
  boolean, the text `true` and `false` in any case and with surrounding spaces, and 1 and 0 as text
  or number; null, undefined and a blank string keep the field's own default; anything else,
  `'yes'`, `'off'`, 2, an array or an object, is refused before the request with the field named.
  *Before:* a Dynamical Decoupling of `'false'` submitted `dynamical_decoupling.enable: true` and
  spent the QPU seconds. *After:* it sends no `dynamical_decoupling.enable`, and a Private of
  `'true'` marks the job private instead of publishing it.
- **No refusal quotes the credential value it read.** A malformed API Version and an Instance CRN
  without its `crn:v1:` prefix both failed with the value inside the message, and those are the two
  boxes an API key is mis-pasted into: Instance CRN sits under API Key and holds a string just as
  opaque, and API Version is free text. n8n encrypts the key and masks it everywhere, and the
  credential hides the token exchange's own error and response body for exactly this reason, but
  these messages took it back out in plaintext, into the output item under Continue on Fail, into
  the error n8n saves with the execution, and into the context of an AI Agent calling the node as a
  tool, with nothing to tell the user that the key now needs rotating. A sweep of all 36 operations
  under a secret in each credential field in turn found a third, Get Account Configuration quoting
  the account segment it reads out of the same Instance CRN. All three now name the field and the
  shape it wants and stop there, which is the half a reader can act on, and it is what the shared
  identifier guard in front of them already did with a value over 1000 characters. Two messages
  still name a credential value, both proved harmless before they are built: the deprecation warning
  names a version the date check proved is a date, and the identifier guard names a value of nothing
  but dots. SECURITY.md and AGENTS.md carry the rule, with the `grep` that checks it. IBM's own
  reply is a separate path this does not close: `code 1279` names the `Service-CRN` header it was
  sent, measured with a CRN of the wrong region, while a value IBM cannot parse as a CRN may draw
  `1241` or `1348` instead, whose text names nothing. SECURITY.md now says to rotate a key that has
  been in that box either way, because the field is not a password field. *Before:* a key pasted
  into Instance CRN came back as `Instance CRN "AbCdEf01-GhIjKl23_MnOpQr45..." does not start with
  crn:v1:`. *After:* `Instance CRN does not start with crn:v1:. Copy the full CRN from the IBM
  Quantum Platform instances page.`
- **The Tags placeholder on both triggers reads as an example.** It showed `experiment-7, vqe`
  where the same field on the action node shows `e.g. experiment-7, vqe`, the form n8n's UX
  guidelines ask for and the form the other 22 example placeholders across the three node files
  already had. The 0.5.0 pass that added the prefix reached the action node only, and so did the
  test that guards it: it walked the action node's top two levels, which left both triggers and
  the fields inside a fixedCollection unread. It now walks all three nodes to any depth, so the
  24 example placeholders the editor can show are all checked.
- **The two docs no longer disagree about n8n's environment variables.** llms-full.txt still told an
  assistant that using the node as an agent tool on self-hosted n8n required
  `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true`, while the README said the variable was gone. The
  README was right but vague about when: n8n 1.85.0 (March 2025) removed the flag and turned tool
  usage on for every community node. Both files now say that, list the variables n8n 2.37 actually
  reads (`N8N_COMMUNITY_PACKAGES_ENABLED`, `N8N_VERIFIED_PACKAGES_ENABLED`,
  `N8N_UNVERIFIED_PACKAGES_ENABLED`, `N8N_COMMUNITY_PACKAGES_PREVENT_LOADING`,
  `N8N_COMMUNITY_PACKAGES_REGISTRY`, `N8N_COMMUNITY_PACKAGES_AUTH_TOKEN`,
  `N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV`), and note that n8n 3.0 flipping
  `N8N_UNVERIFIED_PACKAGES_ENABLED` to false by default does not touch a verified package, which
  this one is. A test now fails if either file spells out
  `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` again.
- **llms-full.txt no longer points an assistant at a transpiler service that is gone.** Its third
  way to obtain an ISA circuit was "IBM's cloud Qiskit Transpiler Service, on Premium, Flex and
  On-Prem plans only", while the README, two sections away, said the service was gone and its guide
  answered 410. The README was right: IBM's guide is now "AI-powered transpiler passes", the
  `qiskit-ibm-transpiler` package runs them locally with models from Hugging Face, and the package's
  0.14.0 notes record the service's migration to Qiskit Functions. llms-full.txt now says that, and
  no longer lists a Transpiler Service among the things this package does not do, since there is no
  such endpoint to leave out.
- **The fleet in llms-full.txt is the one IBM lists.** It named `ibm_torino` among the Heron QPUs
  Open users see; IBM retired it on 1 April 2026, after `ibm_brisbane` (3 November 2025) and before
  `ibm_strasbourg` and `ibm_brussels` (27 April 2026). The file now lists the current devices by
  family (Heron r2 `ibm_kingston`, `ibm_fez`, `ibm_marrakesh`; Heron r3 `ibm_boston`,
  `ibm_pittsburgh`, `ibm_aachen`; Nighthawk r1 `ibm_miami`, `ibm_berlin`; Nighthawk r2
  `ibm_phoenix`, whose basis IBM has not published), the retired names with their dates, and Backend
  Get Many as the authority for what an instance can reach. A test fails if the retired name comes
  back.
- **Two limits IBM never published are gone, and the ones it publishes are in.** README and
  llms-full.txt said a job payload may not exceed 50 MB. No IBM page states a byte figure; the job
  limits guide gives 10 million Sampler executions per job, 26.8 million control-system instructions
  per qubit and 30 million `rz`, 20 million `sx` and five million two-qubit gates per circuit, and
  the registry's code 5302 says only "maximum payload exceeded" with fewer shots as the remedy. Both
  files now say exactly that. llms-full.txt also claimed the 2026 promotion of 180 minutes for Open
  users applied "once 20 minutes have been used within a year"; the plans page says active Open Plan
  users can opt in as of 16 March 2026 and states no such condition, so the condition is gone.
- **`resultsAvailable: false` now marks the empty body and nothing else.** It promised to appear
  "only when IBM answered with no result body at all", the 204 IBM documents as "Job's final result
  not found", and instead it fired whenever the body held none of the shapes the reader knew: a
  plain string, which is the `LegacyJobResults` branch of IBM's own results schema, came back
  flagged with the whole result sitting in `raw`, and so did any object the reader did not
  recognise. A workflow branching on the flag as proof of a 204 routed those jobs down the
  no-result path. The flag is now raised on an empty body alone, which is what the transport turns
  a 204 into, so it means again what it was added to mean. Everything else keeps `pubCount: 0` and
  the untouched body in `raw`, which is where a shape the reader does not know has always been
  readable. Measured over the 160 result bodies of one account: 3 are the true empty body and stay
  flagged, and no body that carries content is flagged any more. The 0.5.0 Noise Learner bullet is
  edited to match: it said `resultsAvailable: false` "is documented as" meaning IBM sent no result
  body at all, which is once again exactly what it means.
- **Sessions: what Close does, and how long a batch lives on Open.** The docs said Close "stops
  holding the backend" and presented Max TTL's 28800 as an 8-hour default. IBM's description of
  `DELETE /sessions/{id}/close` is that the session stops accepting new jobs, queued jobs will not
  run and running jobs finish, which is a cancel, not a drain; Set Accepting Jobs false is the way
  to let queued work run first. IBM caps the maximum TTL per plan, 10 minutes on Open and 8 hours on
  the paid plans, ends the workload when it is reached with any queued job failing, refuses a
  Dedicated session on Open with code 1352, and closes a Dedicated session that is opened and
  receives no job for 30 minutes. Both modes also carry an interactive TTL that cannot be
  configured, documented as 1 minute for a batch and 60 seconds for a session on the Premium plan,
  and passing it with nothing queued only deactivates the workload: any later job revives it until
  the maximum TTL. README and llms-full.txt now say all of that next to the operations, and the
  Session Close and Max TTL descriptions say it in the panel.
- **The docs say which OpenQASM qubit form IBM promises.** The palette writes `qubit[n] q;` and
  `q[i]`; Qiskit's exporter writes `$i`. IBM's feature table promises hardware execution only for
  the `$n` form and calls custom `gate` definitions not valid verbatim, while every measurement in
  the README used the virtual form and IBM placed `q[i]` on physical qubit `i` (the failed
  `cz q[0], q[5]` came back naming qubits `(0, 5)`). Both files now state the rule, the observed
  behaviour, and that switching to `$n` is the first thing to try if an in-basis, coupled palette
  circuit is ever refused with 1517.
- **The error table names the codes IBM's registry gives this node's failures.** The "Common
  failures" table knew 1279 and 1517. It now carries, with IBM's own message text and a link to the
  383-entry registry, 1506 and 1603 (QASM the loaders reject, which alternate on the same program),
  1519 (fractional gates with gate twirling, PEC or PEA, the code behind the "gate twirling does not
  support fractional gates" reason), 1520 (system limits), 1521 (incompatible options), 1522
  (dynamic circuit on the Estimator), 5302 (payload) and 1352 (Dedicated session on Open). The
  README troubleshooting table gains one row pointing at the same registry.
- **The monthly verification scan can fail.** `@n8n/scan-community-package` prints its verdict and
  then exits 0 whether the package passed or failed, a missing provenance attestation and a 404 for
  the package name alike, so neither `scan.yml` nor `npm run scan` could ever go red: the scheduled
  job that exists to turn a broken release into a notification reported success on a failed scan.
  Both now run the scanner through `scripts/scan-verdict.mjs`, which passes its output through
  untouched and exits 1 unless the scanner printed its own pass line, and the workflow step is
  `npm run scan`, so the two invocations share one gate. Measured both ways against the live
  registry: `lodash@4.17.21`, published without provenance, now fails the step, and
  `n8n-nodes-ibm-quantum` still passes it.
- **The publish workflow no longer trusts a cache, a branch, or the npm default dist tag.** It
  published 0.5.0 with a valid provenance attestation and had not been touched since 0.3.3, and
  four things in it could bite. `actions/setup-node` ran with `cache: npm` on the one job that
  holds the OIDC token, against that action's own trusted publishing guidance, which is that a
  poisoned cache can expose credentials, that token among them; the job now passes
  `package-manager-cache: false` and installs cold. The tag check was guarded by
  `github.event_name == 'release'`, so a manual dispatch skipped it and published whatever the
  branch it ran from declared; the check now runs on both triggers and refuses a ref that is not a
  tag, so a dispatch has to be pointed at `vX.Y.Z` and is held to the rule a release is held to.
  `npm publish` passed no `--tag`, and npm writes `latest` whenever it is absent, so a release
  marked as a pre-release would have taken the tag `npm install` and the n8n registry read; the
  step now chooses `next` for any version carrying a prerelease suffix and for a release marked as
  a pre-release, reading that flag from the release event or, on a manual dispatch where there is
  no release object to read, from the tag's own release when that lookup answers, leaving the
  suffix as the only test when it does not, and `latest` otherwise. And
  `prepublishOnly` ran the build, the lint and a plain test run, so the official CLI lint, the
  format check and the coverage thresholds never stood between a release and npm; it now runs the
  same five commands CI runs. Nothing the node executes changes, and the only difference inside the
  tarball is that `prepublishOnly` line, which npm ships verbatim in `package.json`. The trigger
  moved with them: it listened for the `created` activity type, which GitHub does not run for a
  draft release, and publishing that draft later fires `published` rather than `created`, so a
  release saved as a draft never reached the workflow at all. It now listens for `published`, which
  covers a release made outright and one published from a draft, and fires once either way.
- **A release cannot go out while its changelog section still says unreleased.** Every earlier
  section carries a date and the newest carries `(unreleased)` until the day it ships, and nothing
  read that word: the one test that looked at the heading asked only that the version have a
  section, which the undated heading answers as well as a dated one. `scripts/release-guard.mjs`
  now runs first in `prepublishOnly`, ahead of the five gates CI runs, and stops the publish unless
  the heading for the version `package.json` declares holds a date, the year alone included, as
  0.1.1 has. The rule is positive rather than a search for the word, so `(in progress)` or an empty
  parenthesis stops it too, and both the release workflow and a publish by hand pass through that
  script. CI never runs it, so the section sits undated for as long as the release is unmade, and
  the date stays the maintainer's to write: AGENTS.md now opens the Releasing list with it. The
  suite reads the real file with the guard's own expression, so a `##` heading the guard could not
  parse fails the build instead of waiting to fail the publish, and a prerelease version heads a
  section as readily as `X.Y.Z` does.
- **llms-full.txt no longer dates itself.** Its header said the file was generated from the source
  of version 0.6.0 "(September 2026)", a month that is right only if the release goes out inside it
  and wrong from the next one on, and that file ships in the npm tarball. The claim is now the
  version alone, which a test holds to `package.json`, so it is true whenever the release happens.
- **The release documentation names the step that actually puts a version in front of users.** It
  ended at npm, and the one sentence past it said only that a new version is not verified until it
  is submitted again. n8n's community node registry holds a row per node type, each pinning a single
  `npmVersion` beside that tarball's own npm `dist.integrity` as its checksum, and n8n refuses to
  install a community package with no checksum once `N8N_UNVERIFIED_PACKAGES_ENABLED` is off, the
  default from n8n 3.0 and what n8n Cloud already is. A checksum fits one tarball, so until those
  rows move the verified path installs the version they name and not the one on npm: `0.2.2`,
  `0.2.3` and `0.4.1` went to npm and never reached the registry, and `0.5.0` reached it 57 hours
  after its publish. CONTRIBUTING.md gains a Releasing section saying so, AGENTS.md's Releasing list
  says it on the resubmission step, and a test holds both to it. That list now also asks the n8n
  team for the `displayName` on the two trigger rows, which still carry the names 0.1.1 shipped
  while the node description inside the same rows carries the ones 0.3.3 renamed them to.
- **The node panel finds the instance, usage and cost limit operations by their own words.** The
  three codex `.node.json` files came into 0.6.0 exactly as 0.5.0 wrote them, and the action node's
  aliases named the circuit side alone: Quantum, Qiskit, QPU, OpenQASM, IBM, Circuit, Sampler,
  Estimator. n8n's panel search reads two things, the display name and those aliases, and scores
  each alias entry on its own, matching the typed term as a subsequence of that one string. So with
  the Account resource now at eleven operations, Get Many Instances and Set Cost Limit among them, a
  search for `instance`, `cost`, `limit`, `quota` or `usage` returned no node of this package at
  all: measured by loading this package with n8n 2.37.10's own `PackageDirectoryLoader` and running
  its own panel search over the result, popularity factor and all, beside the built-in nodes the
  panel hands that search, one entry per node type with the hidden ones dropped. The action codex
  gains four entries, `Instances`, `Usage`, `Cost Limit` and `Quota`. They put the node first for
  `instance`, `instances`, `cost`, `cost limit`, `quota` and `usage`, and last for `limit`, behind
  n8n's own Limit node and Loop Over Items. The plural and the two word entry are deliberate:
  `Instance` alone would miss the plural a user types after reading Get Many Instances, and `Cost`
  and `Limit` as two entries would miss `cost limit`, because no search term is ever matched across
  two of them. Three of the eleven stay unfindable by their own words, Get Account Configuration,
  Get Configuration and Get API Versions: `account`, `configuration`, `api` and `versions` are too
  generic to spend an alias on here. Both trigger codex files are unchanged, because 0.6.0 added no
  capability to either node. One reader this cannot reach is the panel preview of a package that is
  not installed: the registry row carries an empty codex, so until the package is relisted that
  preview keeps searching the display name alone.
- **The Docs button on both triggers opens the section that documents them.** Every node carries two
  documentation links, one on the node class and one in its codex file, and n8n reads the second
  only when the first is missing: `useNodeDocsUrl`, read out of the editor bundle of n8n 2.37.10,
  returns `documentationUrl` whenever it starts with `http`, and falls back to the codex
  `primaryDocumentation[0]` otherwise, appending its utm parameters past the anchor, where they
  become part of the fragment. The two triggers disagreed: the class sent the button to the top of
  the README, the codex to `#long-running-jobs`, the section that explains the polling pattern, the
  cadence, the tags filter and the Failed or Canceled option, and sets the retired Error Trigger
  beside it. Both anchors resolve, so nothing was broken, but the one n8n uses was the less useful
  of the two. Both class links now name that section, which is what the codex already said, and the
  codex files are unchanged. The action node keeps `#readme`: it spans 36 operations across six
  resources, and no one section of the README covers it. A test holds each of the three nodes to a
  single page.

### Testing

- **CI now runs the lint that n8n's verification process runs.** n8n's guidelines say every
  verified package should be created and checked with the `n8n-node` tool, and this package had
  never run it. `ci.yml` now runs `npx --no -- n8n-node lint` right after `npm run lint`, on both
  Node versions. Read from the CLI's source, that command is `eslint .` with this repository's own
  `eslint.config.mjs`, so it adds no rule of its own; what it adds is the process check, and the one
  file the lint script never reads, `.prettierrc.js`, where a parse error, a directive naming a rule
  that does not exist, or a rule the file turns on at `error` in a comment of its own and then
  breaks, fails this command while `npm run lint` stays green. It refuses to run while `package.json` carries `n8n.strict: true`
  beside a custom config, one more reason that flag is gone. It does not fail on warnings, so
  `npm run lint`, which does, stays in front of it. The `--no` is deliberate: a package named
  `n8n-node` exists on the registry as a placeholder against dependency confusion, and in CI `npx`
  assumes `--yes`, so without the flag a missing devDependency would have been papered over by a
  silent install rather than a red build. The pull request template now lists `format:check` and the
  new lint, the two checks CI enforced without asking for them, and every document that names the
  command names the flag with it, so a contributor copying it out of `README.md`, `CONTRIBUTING.md`,
  `AGENTS.md` or the template runs what CI runs. The generated coverage report is excluded from
  ESLint, because `eslint .` walks it after a local `test:coverage` run while the lint script, which
  names its paths, never did.

The suite goes from 669 to 1099 tests, still at 100% statement, branch, function and line coverage.
One new metadata test reads every operation value and every parameter name, nested collection
fields included, out of `descriptions.ts` and fails unless `llms-full.txt` names each one and
`README.md` names each operation, so the file an assistant reads can no longer fall behind the UI
without the build going red. Another pins the fourteen files under `readme-assets/` against the four
documents that embed them, and it refuses any of the four that points back into `.github/images/`.
The list of fourteen is by hand, so a file added under `readme-assets/` still needs its own row.
A third pins the scope of the `lint`, `lintfix`, `format` and `format:check` scripts, so the wider
coverage this release adds cannot be trimmed back to `nodes credentials` without the suite going
red. A fourth reads `scripts/qa-run.mjs` and fails unless every resource and operation value the
live harness names is one the UI advertises, so an operation renamed or removed in `descriptions.ts`
cannot survive in the only check that runs against IBM. A fifth reads the operations each row of
the README resource table names and fails unless they are exactly the names in the dropdown behind
that resource, and unless the rows are exactly the resources the node has, so the table can neither
fall one short nor carry an operation the node does not have while the sentence above it still
reads right.

### Not yet verified on hardware

Every job this project has ever run through the node, with its date, backend, program, shots,
outcome and QPU seconds, is listed in TESTING.md, together with each test round and what it
measured; the section below is the summary.

0.5.0 could say that nothing in it was claimed from reading the code. This release was written the
same way, from IBM's OpenAPI spec (0.50.5), its guides and its SDKs, pinned by unit tests, with no
credential available to the audit. It has since been run against a live Open plan account in
`us-east` on 2026-09-07, all 36 operations and 14 jobs on `ibm_fez`, `ibm_marrakesh` and
`ibm_kingston` for 34 QPU seconds in total, and almost every entry below moved from claimed to
measured.

Measured, and behaving as documented: `GET /v1/accounts/{id}` behind Get Account Configuration; both
Resource Controller calls, the Get Many Instances read and the Set Cost Limit write, which was set
to a second value, read back, and restored, and which settles that the API tolerates the
`Service-CRN` and `IBM-API-Version` headers the credential adds; `wait_time_seconds`, which Get
Least Busy asked for and IBM answered with none, so the documented fallback ranked by queue length;
the option collections on Sampler and Estimator, an Estimator job carrying all four of them
returning 0.95 and 0.999 for `ZZ` and `XX` on a Bell state; `rzz`, `delay` and the `input`
declarations, which completed on hardware in one circuit; Return All on Job Get Many, which returned
all 198 jobs of a history that pages at 200; the cursor inside the Workload Get Many links, which is
base64 of a timestamp and round-tripped through the Next Cursor filter to the second page; and a
bare `id`, which still fails a job, with the same "the instruction u on qubits" message the warning
quotes, so the warning stands.

Measured later the same day, in an eighth round: the trigger's seen set survives an n8n restart, so
the first poll after a restart fires the jobs that finished while n8n was down, once, and never
the history it had seeded; Jobs to Scan is a window, five jobs finishing inside one poll interval
with the parameter at 2 fired the two newest; Clear Limit reads back the plan default, 600 seconds
on the Open plan; a QPY circuit passes the submit checks unread, so a fractional gate under the
Noise Learner and a 2 qubit observable against a 156 qubit layout failed at IBM with 1519 and 1501
and no warning; n8n's AI Agent drove the Tool node through `$fromAI` parameters, two tools in one
question, a submit to results chain it chose itself, and a tool error it reported without
inventing; workflows saved by 0.5.0 with `typeVersion: 1` ran unchanged; three executions at once
shared nothing; and the same tarball behaved the same on n8n 2.35.7 with Node 22.23.2.

Not settled, and why: the basis text for a Nighthawk device and the ISA warning against one, because
the account sees only Heron devices; `calibration_id`, which reached IBM on both backend reads and
was refused with "You are not authorized to use custom calibrations with your current service plan",
so the wiring is confirmed and the behaviour is not; the order a positional array binds parameters
in, measured against Qiskit locally, where the importer sorts them by name, and not through a
submitted job; and session `dedicated` mode, which the Open plan refuses, as the field says. The
writes and submits above were one-shot jobs of about two QPU seconds each; both are on the release
checklist, and the entries above will be amended with what is measured.

### Dependencies

- `n8n-workflow` 2.35.3 to 2.38.1, pinned exactly. n8n 2.38.6, the current `stable`, ships 2.38.1,
  so the node compiles against the types it runs on. The package's own `stable` dist-tag still sits
  on 2.37.4, behind the n8n release that ships 2.38.1, so the pin follows n8n rather than that tag;
  `latest` still points at 2.16.0 and `beta` runs ahead on 2.39.x, which is why the pin is exact
  rather than a caret. The node was audited and run live on n8n 2.37.10 against 2.37.4, and moving
  the pin to 2.38.1 leaves every test and the built `dist` byte for byte as they were.
- **`@n8n/node-cli` 0.47.2 joins the devDependencies, and `n8n.strict` leaves `package.json`.** The
  n8n submission guide requires the CLI at 0.23.0 or later as a devDependency, and the verification
  guidelines say every verified author should use it to check their package. The `strict: true`
  flag declared since 0.4.1 is gone: n8n never reads it, its loader knows `n8nNodesApiVersion`,
  `nodes` and `credentials` and nothing else, and the one tool that does read it, `n8n-node lint`,
  treats it as a promise that `eslint.config.mjs` is the CLI's own template, which this repository's
  is not. Without the flag the CLI lints against the configuration in the repository, which mirrors
  the scanner's rule for rule. The CLI's own tree asks for `n8n-workflow` 2.38.1, the version
  pinned here, so a single copy is installed; with the pin left on 2.37.4 the lockfile held five
  more, nested inside the CLI's `@n8n` packages. The ruleset 0.47.2 bundles is 0.31.0, one behind
  the one below, and that copy lints nothing here: the CLI runs the repository's own
  configuration, which resolves 0.32.0. A cast the 0.32.0 rule refuses, put on a trigger's
  `outputs` for the test, failed `n8n-node lint` with that rule's message.
- `@n8n/eslint-plugin-community-nodes` 0.29.0 to 0.32.0, the version the 0.35.0 scanner bundles.
  Three changes in that span, and none finds anything here. `no-overrides-field` now also refuses a
  `resolutions` field. `no-unsafe-connection-type-cast` is new, an error on a type-erasing cast
  (`as never`, `as any`, `as unknown`) over a node's `inputs` or `outputs`, and all three nodes
  declare theirs as a plain `NodeConnectionTypes` array. And `no-credential-reuse`,
  `no-emoji-in-options` and `valid-credential-references` now also find a description assigned in
  a constructor, where they read only the class property before; all three nodes declare theirs
  as the class property, which both versions read.
- `vitest` and `@vitest/coverage-v8` 4.1.11 to 5.0.0. The suite reports the same tests and the same
  flat 100 on all four coverage figures as on 4.1.11, and no test needed a change.
- `@types/node` 26.5.1 and `typescript-eslint` 8.70.0. `npm outdated` lists `@types/node` as
  behind a `latest` of 22.20.2; that dist-tag serves older TypeScript, and the `ts5.9` tag this
  compiler matches points at 26.5.1. `typescript-eslint` 8.70.0 still supports TypeScript
  `>=4.8.4 <6.1.0`, so TypeScript 7, now the `latest` tag, stays out of reach.
- `@eslint/js` 9.29.0 and `globals` 17.12.0, both devDependencies, for the recommended ruleset and
  the Node globals the tests and scripts are now linted with. `@eslint/js` is pinned to the exact
  version `eslint` 9.29.0 already depends on, so its recommended set can never name a rule this
  eslint lacks, and Dependabot ignores it for the same reason it ignores `eslint`. The published
  package still declares no dependencies.
- `eslint` stays at 9.29.0 and `typescript` at 5.9.x, for the reasons given under 0.5.0. The two
  `nanoid` advisories recorded under 0.5.0 (GHSA-28wg-ghj8-5hjv and GHSA-2v37-7h3g-55p8) closed
  when `n8n-workflow` 2.36 brought `@n8n/utils` 1.44.0, which pins `nanoid` 3.3.18. `npm audit` on
  the regenerated lockfile reports ten moderate findings instead, every one of them through
  `@n8n/node-cli`: its `@n8n/ai-node-sdk` tree pins `qs` 6.15.2 (GHSA-x5fp-wj9c-mxmx and
  GHSA-4mjr-xmp4-gh2g), `stream-json` 1.9.1 (GHSA-528h-pc64-c93x) and `@langchain/classic` 1.0.27,
  which wants `uuid` 10 (GHSA-w5hq-g745-h8pq). The `qs` and `stream-json` links are exact pins, on
  the `beta` tag as well, and `@langchain/classic` wants `uuid` as `^10.0.0`, whose only release is
  10.0.0 while the fix is 11.1.1, so no in-range update exists; an `overrides` entry is refused by
  the ruleset, and the only CLI without the tree is 0.20.0, below what the submission guide
  requires. Nothing reaches a user: the published tarball declares no `dependencies`, and
  `npm ls --omit=dev --all` prints `(empty)`. On its own, this dependency move leaves the built
  `dist` byte identical to the one 0.5.0 published. One more finding arrived after the lockfile
  was first regenerated, and it was closable: GHSA-2883-xcg3-v3hh, high, published on 8 September,
  in `js-yaml` below 4.3.2, reached through `eslint`'s own `@eslint/eslintrc`, which asks for
  `^4.1.1`. That range already allows the fix, so the lockfile now resolves `js-yaml` 4.3.2 with
  `eslint` untouched at 9.29.0, and `npm audit` is back to the ten moderate findings above. The
  four upgrades in this list leave `dist` byte identical as well, measured by hashing every built
  file before and after.

## 0.5.0 (2026-08-21)


### Added

- **A warning when a circuit calls `rzz` without defining it.** `rzz` is in the Heron basis, so the
  ISA scan passes it and the node said nothing either way. Two jobs on `ibm_fez` settled what
  actually happens. The bare call, which is what the palette would emit, comes back Failed with
  a rejection naming `gate 'rzz' is not defined`: `stdgates.inc` has no definition for it, so IBM
  refuses the program before the target is ever consulted. The same gate carrying the
  `gate rzz(p0) a, b { cx a, b; rz(p0) b; cx a, b; }` block that Qiskit's exporter writes completed
  and returned 64 of 64 shots on `00`, the correct reading for a diagonal phase gate on the ground
  state. The node now warns about the undefined call and stays silent about the transpiled one, both
  confirmed live through n8n. This replaces an earlier belief, recorded in this changelog and in the
  README, that IBM rejected `rzz` outright with reason code 1506. Acting on that belief by dropping
  `rzz` from the basis would have warned about a circuit that demonstrably runs.

- **A warning when a two-qubit gate lands on a pair the chip does not connect.** Picking gates from
  the basis is only half of building an ISA circuit; the qubits have to be adjacent as well. Until
  now that was the last way a circuit built entirely from the palette's runs-as-is gates could still
  fail, and it failed the expensive way: IBM accepts the job, queues it, and only then reports
  `code 1517, the instruction cz on qubits (0, 5) is not supported by the target system`, charging
  the fixed per-job overhead for the privilege. The node now reads `coupling_map` from the backend
  configuration on submit and names the offending pair up front, along with the neighbours the first
  qubit does have, so the fix is visible rather than guessed. Verified on `ibm_fez`: `cz q[0], q[1]`
  completes with no warning, `cz q[0], q[5]` warns and then fails at IBM with exactly the predicted
  qubits, and a single-qubit circuit issues no extra call at all. The map is read as undirected,
  which matches what IBM publishes: all 352 pairs on that device carry their own reverse. The check
  costs one GET of about a second, so it is skipped when the circuit has no two-qubit statement, and
  read once per submit however many circuits it carries. It is skipped for QPY, which cannot be
  inspected, and a map that cannot be read never blocks the submit: the job goes out unwarned,
  exactly as before.

- **The `sx` gate joins the palette, and the reason it was left out was wrong.** A Heron backend
  lists `sx` among its basis gates, and the palette excluded it on the belief that it had no
  OpenQASM 3 spelling avoiding the builtin `U`. It does: `stdgates.inc` defines it, and Qiskit's own
  exporter writes the bare `sx q[i];` for a transpiled circuit, with no definition block. Verified on
  `ibm_fez`: two in a row read 249 of 256 shots as 1, which is `X`, and one alone reads a 47/53
  split, which is the superposition. This matters more than one gate normally would, because `sx` is
  the only single-qubit basis gate besides `x`, so without it a hand-written ISA circuit had to spell
  its Hadamard with a parametrised `rx`. That works on Heron but is a *fractional* gate, which
  Nighthawk processors do not offer at all and which is incompatible with gate twirling and with the
  ZNE and PEC mitigation behind Estimator resilience level 2. `rzz` stays out of the palette, but not for
  the reason first recorded here: see the entry above, the gate is fine and the missing definition
  is not.

- **Every gate in the palette says whether IBM runs it untouched.** Qiskit Runtime does not
  transpile, so a circuit built from the wrong gates is accepted, queued, and failed minutes later.
  Sixteen of the twenty-five entries are in that category, which is most of the palette, and nothing
  in the dropdown said so. Each option now carries a description: "Runs as-is" for five of the seven
  basis gates plus measure and reset, "Transpile first" with the reason for the rest, and the two
  special cases, `barrier` being a directive and `id` being accepted while emitting nothing. That is
  seven entries rather than nine, because `id` is counted among the special cases and `rzz` is not in
  the palette at all, for the reason given above. A test holds those descriptions against the node's
  own ISA scanner, so a gate added later with the wrong blurb, or a basis that changes, fails the
  build rather than shipping a tooltip that lies. Verified by
  mutation: claiming Hadamard runs as-is, adding a gate with no description, and blanking one all
  fail it.

- **Several circuits in one job.** The circuit field now accepts a list as well as a string: an
  expression resolving to an array submits every circuit in a single job, one PUB each, sharing the
  same shots, bindings, observables and precision. This matters because a job carries about two QPU
  seconds of fixed overhead before it runs a gate, measured repeatedly on `ibm_fez`, so a batch of
  five circuits costs that once rather than five times. A single string behaves exactly as before.
  Every entry is validated, an empty list is refused, and the node caps a job at 100 circuits, which
  is its own bound rather than IBM's, so a runaway expression cannot build one enormous request.
  Warnings are reported once each across the whole list rather than repeated per circuit.

- **A warning when a Noise Learner circuit carries a classical register.** Measured on `ibm_fez`: a
  three-qubit circuit with `cz(0,1)` and `cz(1,2)` fails with "ClassicalRegister with name 'c'
  appears in multiple layers with different sizes (3 != 2)" when the circuit builder's default two
  classical bits are left in place, and completes with two learned layers when Number of Classical
  Bits is set to zero. The learner never measures the circuit, so the register is only ever a
  liability, and a single-layer circuit survives, which is what hides the problem until the circuit
  grows. Since the default is what puts the register there, the submit now says so. The warning stays
  silent below two entangling gates, because a second layer cannot exist without them and warning on
  every single-layer circuit would be noise. QPY is skipped, for the same reason the ISA check skips it.

- **The Backend fields are dropdowns loaded from your account.** Five fields (Backend Name on the
  backend operations, Backend on submit, Backend on session create, and the backend filters on the
  job and workload listings) now populate from `GET /v1/backends` through a `loadOptions` method.
  Labels carry the status and the queue depth, for example `ibm_kingston (online, 7 queued)`,
  because that listing already returns both, so the dropdown costs one call and no extra endpoint.
  The list is read when the node opens and again on **Refresh List** in the field menu, never on a
  timer, so the status and queue in a label are a snapshot rather than a live reading; the tooltip
  on all five fields says so. The stored value is still the bare name, so workflows saved before
  this keep resolving, and the expression toggle still accepts a typed name when the list cannot
  be loaded. n8n exempts any
  value starting with `=` from option validation, and these fields declare no `validateType`, so a
  name absent from the list is never rejected.


- **A transpilation warning on every submit.** Qiskit Runtime does not transpile, so a circuit using
  anything outside the IBM basis (cz, id, rx, rz, rzz, sx, x, plus measure, reset, delay and barrier)
  is accepted, queued, and only then fails, minutes later, with an opaque message. The submit
  operations now read the OpenQASM 3 program and, when they find an instruction outside that set,
  attach a `warnings` array to the output and write the same line to the node logger. It never
  blocks: the job is still submitted. Gate definition blocks are skipped, because Qiskit's exporter
  emits `gate rzz(p0) a, b { cx ...; }` for a perfectly valid ISA circuit and reading the body would
  accuse a correct program. QPY is compressed, so it is not inspected.

- **The failure reason on Get Results.** A job that failed or was cancelled now returns `reason`,
  `reasonCode` and `reasonSolution` beside `status`, lifted out of `job.state`, which is where they
  were buried. The same three fields the Error Trigger already emitted.

- **`resultsAvailable: false` on Get Results.** IBM documents a 204 on the results endpoint as
  "Job's final result not found". The empty-body guard turned that into a completed job with zero
  pubs, indistinguishable from a real empty result set.

- **`registerFallback` and `requestedRegister` on a sampler pub.** A job can hold several pubs whose
  circuits name their classical registers differently. A pub that does not carry the requested
  register reads its own and marks that it did, so a fallback can never pass for what was asked for.

- **Context on IBM's terse 404s.** A missing job or session comes back naming the identifier and
  carrying a solution, but a missing device or log answers with a bare "device not found" that names
  nothing. Those two now carry the value the user supplied and where to check it, with IBM's own
  wording kept inside the message. Only a 404 is treated this way: telling someone to check the
  backend name when their token expired would send them after the wrong thing.

### Changed

- **The README's ISA recipe is built on `sx` instead of a parametrised `rx`.** Both give a valid
  Hadamard on Heron, and the old recipe was verified there, but the `rx` form is fractional: it does
  not exist on Nighthawk, and it rules out gate twirling and Estimator resilience level 2. The `sx`
  form runs on both fleets and keeps every mitigation option open. The table is rewritten row by row
  so it can be copied straight into the Gates field, and the measured outcome is from a run of the
  exact circuit in it: 2048 shots on `ibm_fez`, 48.7% `00` and 46.2% `11`, the remaining 5.0%
  readout error. `llms-full.txt` and its example workflow carry the same recipe.

- **Lint refuses warnings, not just errors.** Seven of the rules in the official community-nodes
  ruleset ship as `warn` rather than `error`, among them `no-dead-files`,
  `resource-operation-pattern` and `node-registration-complete`, and the scanner's verdict is the
  error count alone. eslint exits 0 when only warnings are present, so any of those could have
  passed CI green and reached a human reviewer instead. The `lint` script now passes
  `--max-warnings 0`. Nothing in the package currently warns, so this changes no output today; it
  closes the hole for the next deletion or the next ruleset update.

- **The Error Trigger migration is no longer presented as a drop-in swap.** The README said the
  main trigger's Failed or Canceled option "replaces it", and llms-full.txt sent readers straight
  at it. Measured on one job with both nodes polling in parallel: the reason fields do match, but
  the job ID moves from `jobId` to `id`, the status moves from a lowercased `cancelled` to IBM's
  own `Cancelled` and disappears entirely when IBM omits it, and the raw job moves from under `job`
  to the top level. Both files now carry the difference as a table, and a test pins it so the two
  cannot drift apart. The payloads themselves are untouched.

- **Session > Set Accepting Jobs no longer claims it keeps the session open.** The description read
  "Turn job acceptance on or off without closing the session", while the field directly below it
  said the opposite. Measured on a fresh empty batch session on `ibm_fez`: turning acceptance off
  moves the session from `open` / `session_created` to `closed` / `session_closed_early` on the
  spot, with `closed_at` stamped. Setting it back to true flips `accepting_jobs` but leaves the
  state closed, so the change is one way; the field description now says that too.

- **Backend > Get Defaults says plainly that it returns nothing.** The description read "many
  devices answer with an empty body". Measured on all three devices this account can reach, IBM
  answers HTTP 200 with the literal `null`, content-length 4, every time, against 607 KB from Get
  Properties on the same backend. Confirmed outside the node with a direct HTTP call, so it is not
  the node discarding the body. The operation is kept rather than removed: unlike a write that
  errors, it succeeds and returns an empty object, and removing it would break saved workflows for
  no gain if IBM ever starts serving the data.

- **The three submit actions say the circuit must already be transpiled.** With n8n's default
  `descriptionType: 'auto'`, `getToolDescriptionForNode` builds an attached tool's description from
  the operation's `action`, so `action` is the only text a model reads. It previously said "Submit a
  circuit to the sampler primitive", which told an agent nothing about the one rule that sinks the
  job. Confirmed the long `usableAsTool` blurb never reaches a model on either path: the agent
  resolves the auto description, and n8n's own MCP server reports the base description, checked live
  against the published 0.4.1. The `$fromAI` override n8n writes for a circuit field carries an
  empty description, and `from-ai-parse-utils.js` attaches nothing when it is empty, so the
  parameter reaches the model unannotated. The action now carries the constraint instead, so an
  attached agent reads "Submit an already transpiled ISA circuit to the sampler primitive in IBM
  Quantum". The other 30 actions were left alone: they read well to a human in the panel and carry
  nothing a model needs to be warned about.

- **The two triggers are now one.** The panel listed seven trigger entries built from two nodes, and
  two of them were duplicates: "On failed" and "On failed only" matched identically on all fifteen
  job statuses, as did "On canceled" and "On canceled only". The only thing separating each pair was
  the output shape, which the panel does not show, so the choice was invisible. The main trigger
  gains a **Failed or Canceled** option, the one filter it could not express, and its output now
  carries `reason`, `reasonCode` and `reasonSolution` beside the untouched job. The fields are added,
  not wrapped, and the job carries them only under `state`, so existing expressions are unaffected.
  `IbmQuantumErrorTrigger` is marked `hidden`, not removed: it stays registered and saved workflows
  keep polling, the way n8n retired Cron in favour of Schedule Trigger.
- **The README no longer claims tooling picks up the `llms-full.txt` URL on its own.** It said the
  codex file lists that URL "so tooling that reads node metadata finds it without being told", which
  is false in both directions: n8n's `useNodeDocsUrl.ts` reads only `primaryDocumentation[0]`, the
  README, and its MCP server passes on no documentation URL at all. The section now says to hand an
  assistant the raw URL. Also dropped the release-pipeline paragraph, which described a maintainer
  workflow rather than anything a user of the node needs, and moved the video and the articles from
  the top of the page down to the end.

- **The credential dialog's "Read our docs" link points at documentation about the credential.**
  The credential class sent it to IBM's general guides index, which documents none of the four
  fields on that screen, while the codex already sent the node panel to this package's Credentials
  section. The two agree now, and a test keeps them agreeing.

- **The trigger subtitle no longer shows a camelCase value on the canvas.** The subtitle renders
  the stored value, so the new `failedOrCanceled` option read as "Polling for failedOrCanceled
  jobs" on the node. It is spelled out now, and a test refuses any option value that is not plain
  lowercase unless the subtitle handles it, so the next option added cannot reintroduce this.
- **The catch-all trigger option has a readable panel label.** n8n renders each entry as
  `action ?? 'On ' + noCase(name)`, and `noCase` flattened "Any Terminal (Completed, Failed or
  Canceled)" into a run-on phrase. The option now sets `action: 'On any terminal state'`, which
  keeps the panel short while the dropdown inside the node keeps the explanatory wording.
- **One implementation of the failure fields instead of three.** The trigger, Get Results and the
  retired error trigger each lifted `reason`, `reasonCode` and `reasonSolution` out of the job's
  `state` with their own copy of the same three lines. They now share `stateError` in
  `operations.ts`, so a job that failed cannot be reported differently depending on which path
  read it. Verified by mutation: emptying the shared helper fails 10 tests across both consumers.

- **The Parameters field no longer opens with an error marker.** It is a `json` field and its
  default was the empty string, which does not parse, so n8n's code editor flagged an optional
  field before the user had touched anything. The default is now `{}`. `submitJob` already treated
  the empty string and `{}` identically, so no request changes.
- **The AI tool blurb is 121 characters instead of 557.** It used to carry an operation list and a
  raw documentation URL because it was assumed to be what a model reads. Two consumers were checked
  and neither shows it: the AI Agent resolves n8n's default `descriptionType: 'auto'` through
  `getToolDescriptionForNode`, which returns `<action> in IBM Quantum`, and n8n's own MCP server
  reports the base description for every operation, confirmed live against the published 0.4.1.
  What a model does receive is each parameter's own description, so the ISA constraint stays pinned
  there and is now covered by a test.

- **The trigger event parameter is labelled "Trigger On"**, the name n8n's UI guidelines specify, and
  its tooltip now says which jobs start the workflow rather than restating the label. n8n builds the
  Triggers list from a property named Event, Events or Trigger On; ours were called Status and On, so
  the panel fell back to a single unnamed placeholder instead of listing the options. 0.4.1 shipped a
  tooltip that only echoed the field name. The main trigger now explains that only terminal states
  count, so a queued or running job never fires and the next poll checks it again, and the error
  trigger says a completed job never fires it. Both add that each job fires once, tracked by ID
  across polls. The stored parameter names are untouched.
- **The three listing operations are named "Get Many"**, which is what n8n's UX guidelines call the
  standard listing operation, and Job "List Tags" is now "Get Many Tags". The stored values are
  unchanged (`list`, `listTags`), so existing workflows keep working.
- **Every operation now carries a description**, rendered under its name in the operation dropdown,
  and example placeholders use the `e.g.` prefix the guidelines ask for.
- **Six field descriptions now say what IBM measurably does.** Backend on submit claimed the Qiskit
  Runtime API rejects a circuit that is not native to the device. It does not reject it: it accepts
  the job, queues it, and fails it minutes later, charging about two seconds of QPU time, which is
  the whole reason the warnings above exist. Max Cost said zero lets the program decide; zero omits
  the field, and IBM then stamps the job with the plan maximum, verified live as the Open plan's
  entire 600 second allowance. Max Wait never said that reaching the limit is not an error: the node
  returns the item with `timedOut` set to true while the job keeps running on IBM, to be read later
  with Get Results. Additional Options offered `{"default_shots": 4096}` as its example, which
  changes nothing, because Shots travels with the circuit and overrides it. And the two trigger
  filters, Trigger On and its error-trigger counterpart, had no description at all, the only two
  mechanical gaps in the node's 152 user-visible strings. Parameters now documents both accepted
  shapes, the named object and the bare positional array, after both were run on hardware and
  returned the same counts.
- **Both `/instances/configuration` calls are marked deprecated in the code.** IBM's live OpenAPI
  spec flags GET and PUT on that path, in favour of the Resource Controller API. Both still answer.
  Account Get Instance already reads the same fields from `/instance`, which is not deprecated.

### Removed

- **Account > Set Cost Limit is gone, leaving 33 operations.** IBM deprecated
  `PUT /v1/instances/configuration` in its own OpenAPI spec and the endpoint no longer answers: it
  hangs for about 180 seconds and then aborts the connection. Reproduced on 18 and again on 21
  August, and once more outside the node entirely, by sending the identical method, URL and body
  through n8n's own HTTP Request node, while `GET` on the same path answered 200 in 832 ms. There is
  no replacement write endpoint, so a shipped operation that can only hang and fail was worse than
  no operation at all. Set the ceiling on the IBM Cloud console instead; **Get Configuration** and
  **Get Instance** still read it. A saved workflow that used it now fails immediately with
  `Unsupported account operation: setCostLimit` rather than hanging for three minutes.

### Fixed

- **Get Results no longer reports a Noise Learner result as missing.** The parser read only
  `response.results`, but this one primitive answers under `data`, so a completed learning job came
  back as `pubCount: 0`, `pubs: []` and `resultsAvailable: false`, the last of which was read as
  meaning IBM sent no result body at all. IBM had in fact sent a full `LayerError` with fifteen Pauli
  generators and their rates. Get Results now emits one `noiseLearner` pub per learned layer, with
  `qubits`, `generators`, `ratesEncoded` and `circuitEncoded`. The rates stay base64 zlib NumPy and
  the circuit stays QPY, because inflating either needs `zlib`, which the community-node import
  allowlist does not permit; both were always available in `raw` and still are. Sampler and Estimator
  output is byte-for-byte unchanged, held by a regression test.
  *Found on live hardware by running a learning job to completion for two QPU seconds, after an
  earlier pass had only submitted one and cancelled it.*

- **A multi-qubit gate can no longer use the same qubit twice.** `validateGateInput` checked arity,
  range, parameters and the measure target, but never that a gate's indices were distinct. Typing
  `0,0` into Qubits emitted `cx q[0], q[0];`, the node reported success with a job ID, IBM queued the
  job and failed it about fifteen seconds later with reason code 1603, "duplicate bit arguments",
  which is the error Qiskit's own parser raises. No QPU time was charged, so nothing was billed, but
  the run reported success and the failure only surfaced through the Error Trigger. All seven
  controlled gates were affected. `barrier` stays exempt, where a repeat is harmless.
  *Found on live hardware, confirmed by submitting one job that cost zero seconds.*

- **An empty required identifier is refused before the request.** With `jobId` empty the request was
  `GET /api/v1/jobs/`, which IBM's edge answers with its web application: HTTP 200, 285 KB of
  `text/html`, returned as a successful job status. An expression like `{{ $json.jobId }}` on an item
  missing the field produces exactly that. `jobId`, `sessionId`, `backendName` and both backend
  fields on submit and session create now fail with a message naming the parameter.
  *Found on live hardware.*

- **Every identifier is URL-encoded before it becomes a path segment.** There was no
  `encodeURIComponent` anywhere in the package, and fifteen endpoints interpolated user input into
  the path. Confirmed live: a Job ID of `../backends` returned the device list, a Session ID of
  `../jobs` returned the job list, and `../../instances` escaped the `/v1` prefix entirely. The
  blast radius included `DELETE /jobs/{id}` and `PUT /jobs/{id}/tags`, and the node is exposed as an
  AI Agent tool, where these identifiers come from a model. *Found on live hardware.*

- **The polling loop got 0.4.1's empty-body guard.** That release fixed `json: null` crashing a run,
  but only in `transport.ts`. Both triggers build their own request, so an empty body still reached
  `response.jobs` as null and threw a bare `TypeError` outside the error wrapper, on every poll. The
  same guard now applies there, and the job list is checked for shape rather than for null, so a
  `jobs` key that is not an array no longer crashes either.

- **Resilience Level and Precision are validated instead of forwarded.** Both were read with a bare
  `as number`, which has no runtime effect, while every other submit numeric went through a clamp.
  An expression producing `'2'` sent a string, and `3` exceeded the 0 to 2 bound the OpenAPI spec
  defines. Both now fail locally with a message naming the parameter and its range.

- **A Register Name that does not match now fails.** `parseSamplerPub` fell back to the first
  register carrying samples, so asking for `syndrome` and getting `meas` produced a plausible
  distribution belonging to the wrong bits. It now raises an error listing the registers the result
  does carry. Leaving the field empty still auto-detects.

- **Minimum Qubits fails loudly rather than dropping the filter.** The guard was `minQubits > 0`, so
  any non-numeric value made the whole condition false and Get Least Busy returned a device of any
  size. The comment two lines above claimed the opposite behaviour. *Found on live hardware.*

- **Trigger "Jobs to Scan" is clamped, and the dedupe cursor can no longer re-fire.** Both triggers
  passed the value straight into the query. The scan window is now bounded to what was requested,
  which is what keeps it below the 500-entry cursor and makes a second emission of an already
  emitted job impossible, regardless of what the server returns.

- **String parameters survive a non-string expression.** `tagSearch` and the noise learner's layer
  pair depths called `.trim()` on whatever arrived, so a numeric expression produced
  `value.trim is not a function` instead of a message naming the field.

- **An operation named after an inherited Object member is rejected.** The backend and analytics
  endpoint lookups used a truthiness check, so an operation called `toString` resolved to
  `Object.prototype.toString` and was sent as the endpoint. The circuit resource gained the explicit
  unsupported-operation guard the other resources already had, instead of falling through to Build.

- **Job tags are bounded locally.** IBM's schema allows at most 8 tags of at most 86 characters, and
  exceeding either failed the whole submit with a message naming neither.

- **Register sizes have an upper bound.** `numQubits` of `1e7` emitted `qubit[10000000] q;`. The cap
  is 4096, far above any announced device.

- **The Error Trigger reports the status it matched on.** A job carrying only a top-level `status`
  matched but was emitted with `status: ''`, because the matcher and the mapper read different
  fields.

- **The action node's codex `nodeVersion` goes back to `1.0`.** 0.4.0 set it to `2.0` to match the
  node's `defaultVersion`, which is what the n8n review rejected, twice: `nodeVersion` belongs to the
  codex schema and is always `1.0`. It never tracked the runtime version. n8n's own Code node ships
  `version: [1, 2]` with `defaultVersion: 2` and codex `1.0`, and 399 of the 400 built-in codex files
  use `1.0`. The value has no runtime effect, verified by reloading the node: categories, aliases and
  documentation links all still resolve. A test now pins both codex versions on all three nodes.

- **An expression that yields an array no longer clears every tag on a job.** The Tags field is
  comma-separated text, but `{{ $json.tags }}` hands over the array itself, and `parseCsvList`
  returned nothing for it. Update Tags PUTs the full list, so that silently deleted every tag on the
  job, and both tag filters matched everything. Arrays and numbers are now read the same as text.

- **Set Cost Limit can no longer remove the spend cap by accident.** The write sends null to clear
  the limit, and `'abc'`, `''`, `null` and a negative all reached that null. Only a deliberate zero
  clears it now; anything unreadable fails and names the parameter.

- **The OpenQASM header check is linear again.** `^\s*` under the /m flag made every newline another
  place to start from, so a run of them backtracked quadratically: 160k newlines blocked the Node
  event loop, and with it the whole n8n process, for 28 seconds. Excluding only the four line
  terminators from the leading run brings that to under a millisecond while still matching every
  other character `\s` does. Narrowing it to `[ \t]` instead, which was the first attempt, would
  have rejected 19 code points the original accepted, U+FEFF among them, so a circuit saved as UTF-8
  with a byte order mark would have stopped importing.

- **An empty numeric parameter is no longer a deliberate zero.** `Number('')`, `Number(null)`,
  `Number([])` and `Number(false)` are all 0, so once these parameters started being coerced, an
  expression that resolved to nothing would have shipped `resilience_level: 0`, which is no error
  mitigation, on a paid submit. (Before the coercion the raw value went to IBM verbatim instead.)
  Zero still works when it is actually chosen.

- **The circuit builder takes the expressions people write.** `{{ [0, 1] }}` and `{{ 0 }}` in Qubits
  or Parameters produced `value.trim is not a function`, the exact message the coercion helper exists
  to remove, and a lone number parsed as an empty list and then failed on arity.

- **Identifiers are bounded and validated as text.** A value of nothing but dots is refused, because
  URL resolution removes such a segment and encoding does not help: Node decodes %2E before removing
  dot segments. An unpaired surrogate is refused rather than throwing a bare URIError that read
  "URI malformed". Length is capped at 1000 characters, so a runaway expression can no longer build a
  multi-megabyte URL. The spec is not uniform here (1000 for the job endpoints, 500 for the backend
  ones, none declared for a session), so the node takes the loosest value and lets IBM enforce the
  rest, rather than refusing something IBM would have accepted.

- **Lengths are counted in characters, not UTF-16 units.** The tag bounds added in this same pass
  first measured `String.length`, which counts one emoji as two, so an 86-emoji tag would have been
  refused as 172 characters and a 2-emoji search would have slipped past the 3-character guard into
  the bare 400 the guard exists to prevent. JSON Schema counts characters, and so does this now.

- **The Workload Status filter accepts a string.** The control is multiOptions, so it hands over an
  array, but an expression or an AI tool sends text and the filter was dropped silently, returning
  every workload instead of the ones asked for.

- **Polling can no longer become a busy loop.** setTimeout takes a 32 bit delay, so a wait above
  2^31-1 ms fires after 1 ms instead. An unbounded poll interval therefore hammered the API until the
  deadline. Both the interval and the total wait now have upper bounds well inside that limit.

- **Collections resolved to null no longer crash.** `getNodeParameter`'s fallback only applies when a
  parameter is absent, so an expression returning null went straight through and the first field read
  threw a raw TypeError. All five collections are coerced.

- **A register width the response cannot justify is measured instead.** A `num_bits` of 1e9 made
  padStart throw "Invalid string length"; the samples are measured in that case.

- **A polling trigger survives a null entry in the jobs array**, and `layer_pair_depths` must be
  whole numbers, since Infinity reached IBM as JSON null.

- **Get Results tells a missing result from an empty one.** IBM documents a 204 as "Job's final
  result not found", which the empty-body guard turned into a completed job with zero pubs.
  `resultsAvailable: false` now marks that case.

- **Documentation corrections.** The 0.4.1 changelog claimed `AGENTS.md` ships in the npm tarball; the
  files allowlist excludes it. The README's Qiskit Transpiler Service link returned HTTP 410. The
  monthly scan's comment claimed it lints against the current ruleset, while `npm ci` installs the
  one the lockfile pins.

  A second pass, driven by an adversarial review of this release's own changes, caught four more,
  all introduced by the fixes above and all in the README: a paragraph still instructing the reader
  to "use Account > Set Cost Limit", an operation the same release deleted; a screenshot caption
  reading "Actions (34)"; alt text reading "the nine Account actions"; and the session-closing
  finding corrected in the node's own field description but never carried into the README or
  `llms-full.txt`. None of these were caught by the test suite, by lint or by coverage. The
  screenshot at `readme-assets/02-actions-top.png` was retaken: it now reads `Actions (33)` and its
  Account list ends at "Get usage analytics grouped by date".

### Testing

The suite goes from 276 to 669 tests, still at 100% statement, branch, function and line coverage.
The new files cover ground that was unreachable before: `tests/input-guards.test.ts` for every
parameter an expression can corrupt, `tests/node-execute.test.ts` for the node wrapper itself,
`tests/isa-warning.test.ts` for the transpilation warning, and `tests/load-options.test.ts` for the
backend dropdown, including the label fallbacks and the case where the listing is unusable.
`tests/fakeContext.ts` now models `continueOnFail`, per-item parameters and the credential name,
all three of which were hardcoded or discarded, which is why multi-item processing, `pairedItem`,
the continue-on-fail path and the `@version` gate had no coverage despite the 100% figure. All four
turned out to be correct; they are now pinned.

The later passes added the cases that had been missing rather than wrong: `tests/results.test.ts`
gained the noise learner envelope, including seven malformed shapes that must yield nulls instead of
throwing, and `tests/operations-getresults.test.ts` gained the case that proves `resultsAvailable`
no longer lies about a body IBM did send. `tests/error-trigger.test.ts` pins the payload difference
between the two triggers, so the comparison table in the README cannot drift away from the code.
`tests/operations-submit.test.ts` covers the circuit list: one PUB per entry, the empty list, the
cap, validation of every entry rather than the first, deduplicated warnings, and QPY wrapping each
entry separately. `tests/isa-warning.test.ts` covers the classical-register warning and the
entangling-statement counter behind it, plus both halves of the `rzz` pair: the bare call that IBM
refuses and the Qiskit form that completes, each naming the job id it was measured against, so a
later attempt to drop `rzz` from the basis fails the build rather than shipping a warning about a
working circuit. `tests/operations-submit.test.ts` covers the coupling map: an uncoupled pair, a
coupled pair in either order, the neighbour hint, a map that cannot be read, and QPY, which is
skipped.

Behavioural equivalence with the pre-change code was proved rather than argued. The tree at the
release baseline was built separately and the same inputs run through both, comparing the request
body sent to IBM, the item the node returns, and any thrown error, across eight configurations:
Sampler minimal and with every option set, Estimator minimal and with precision, several observables
and resilience 2, QPY, the noise learner minimal and fully configured, and a non-ISA circuit for the
warning path. All eight are byte identical. Behaviour differs only where this release intends it to:
a circuit list, which used to be refused, now submits several PUBs, and a multi-layer noise learner
circuit gains one `warnings` entry while its request body stays unchanged.

### Verified on hardware

Nothing in this release is claimed from reading the code. Fifty-eight jobs ran on IBM Quantum across
21 and 22 August 2026, on `ibm_fez`, `ibm_kingston` and `ibm_marrakesh`, for about 360 QPU seconds of
the Open plan's 600 per 28 days. The node was reinstalled from a real `npm pack` tarball before each
phase, and `diff -rq` confirmed the installed `dist` matched the repository byte for byte every time.

What ran, beyond every operation answering:

- All 24 circuit gates individually, with the emitted OpenQASM 3 handed to Qiskit 2.5.2, which parsed
  it and reported back the identical gate set. All 20 input guards, each blocking before a request.
- All five Trigger On modes and all three Error Trigger modes, activated at once against jobs
  produced in all three terminal states. Every one fired on exactly what it should, with no
  duplicates across two poll cycles, and the tag filter was separately proved to be an AND.
- The full session lifecycle on typeVersion 2 and on typeVersion 1, and then two jobs actually run
  inside a batch session, which moved through `open`, `active` and
  `inactive` / `session_inactivated_by_interactive_ttl` before closing.
- The AI tool variant driven by a real agent that chose among three tools unaided, with `$fromAI`
  resolving a numeric parameter end to end.
- Physics that can be checked against theory rather than against an HTTP status: a Bell state at
  4096 shots reading 92.9% correlated; three observables on that state returning +0.871, +0.920 and
  -0.008 where theory says +1, +1 and 0; a parameterised `rx(pi)` returning all ones; and the
  estimator's three resilience levels landing at 3.9%, 2.0% and 0.1% error against an exact -1.
- A decoherence curve. The same identity circuit at three depths, with `T1 = 48.12 us` read from
  `getProperties`: at 0.5 us the fidelity is 96.06%, at exactly T1 it is 50.39%, which is chance, and
  at ten times T1 it is 50.67%, because nothing is more random than random.
- The `sx` gate, which this release adds to the palette, in both directions: two in a row read 249
  of 256 shots as 1, which is `X`, and one alone reads a 47/53 split, which is the superposition.
  Then a Bell state built entirely from the palette using it, 2048 shots on `ibm_fez`, reading 95.0%
  correlated against 92.9% for the older `rx` form, because `sx` is the native gate.
- The cost model, confirmed to three significant figures at three depths:
  `255 us of fixed overhead + gates x 24 ns` per shot, the 24 ns being the `x` gate length read from
  the backend rather than assumed.
- The heaviest job: 500,000 shots on 20 qubits with no cap, charged 130 seconds, returning 5.25 MB
  that the node decoded in 2.9 seconds into 626 distinct bitstrings summing to exactly 500,000.

Nine claims this changelog makes were confirmed live for the first time: that the hardcoded basis gate
set matches all three devices; that IBM accepts at most 8 tags; that tag lengths count characters
rather than UTF-16 units; that a cancelled job's results endpoint answers 204; that a
bare `rzz` fails as a load error rather than a target error; that gate twirling rejects fractional gates while the other
two toggles do not; that Max Cost really does make IBM cut a job; that the trigger tag filter is an
AND; and that the Executor program cannot be driven without Qiskit.

Three faults were confirmed to sit on IBM's side, not this node's: `PUT /instances/configuration`
hangs for about 180 seconds and dies, reproduced through a plain HTTP request with the node removed
from the picture; `/backends/{name}/defaults` answers 200 with the literal `null`, four bytes, on
every device; and the execution-timeout message is a broken Go template that reads
`Job %!v(MISSING) ran longer than %!v(MISSING)`.

The `eu-de` region was probed as far as this account allows, by sending the same credential's
headers at the eu-de host rather than by changing the credential. The host is live and the
authentication carries across it: `GET /versions` answers 200 with seven versions. Every
instance-scoped endpoint answers 404 with code 1279, naming this account's us-east CRN and
explaining that the instance is not there, which is correct: the region belongs to the instance, not
to the credential. So the URL the node builds for `eu-de` is real and reachable, and a mismatched
instance fails with a diagnosable message rather than a timeout. What remains unverified is an
actual instance provisioned in eu-de, which is an account matter rather than a node one.

Not reachable from this account at all: session `dedicated` mode, which the Open plan refuses,
although the refusal itself was verified, and the Get Results timeout path, for which no queue was
ever deep enough. Both remain covered by unit tests only.

### Dependencies

- `n8n-workflow` 2.34.3 to 2.35.3, pinned exactly. The version on the `stable` tag; `latest` is
  2.16.0 and a caret range would have allowed the 2.36.3 beta.
- **A known advisory is left in place, deliberately.** `@n8n/utils` pins `nanoid` to an exact
  `3.3.8`, which carries two denial-of-service advisories (GHSA-28wg-ghj8-5hjv and
  GHSA-2v37-7h3g-55p8), so `npm audit` reports three high findings through `n8n-workflow`. Nothing
  reaches a user: the published tarball declares no `dependencies` at all, only a peer on
  `n8n-workflow`, which n8n strips at install, and the installed tree contains no copy of either
  package. The two available fixes are both refused: `npm audit fix --force` moves `n8n-workflow`
  to 2.36.3, which sits on the `beta` tag rather than `stable`, and an `overrides` entry is
  rejected outright by the official ruleset (`@n8n/community-nodes/no-overrides-field`). It
  resolves when `@n8n/utils` relaxes its pin.
- `eslint-plugin-n8n-nodes-base` 1.16.7 to 2.0.0. The major is an ESLint API migration only; both
  versions expose the same 132 rules with the same severities.
- `vitest` and `@vitest/coverage-v8` 4.1.10 to 4.1.11.
- `eslint` stays at 9.29.0 and `typescript` at 5.9.x, both deliberately. The verification scanner
  pins eslint 9.29.0 exactly, and TypeScript 7 removes `moduleResolution: node10` and is rejected
  outright by typescript-eslint, which fails the whole lint step.

## 0.4.1 (2026-08-18)

A verification fix, 10 new operations across a 6th resource, and documentation written for machines
as well as people. The node goes from 24 to 34 operations. The release was verified on IBM Quantum
itself, through a real n8n 2.34.6 running the packed tarball against a live Open-plan instance,
and every one of the 34 operations has run against the live service: every backend and account
read, the workload listing, tag search, circuit build and import, the five local guards, the full
session lifecycle on typeVersion 2, real Sampler, Estimator and QPY submissions to `ibm_kingston`,
cancel, tag replacement and deletion on a real job, and both polling triggers seeding their cursor
and then firing on real terminal jobs. Three of the fixes below were found by those runs, not by a
test: IBM answered Backend Get Defaults on `ibm_marrakesh` with an empty body that failed the whole
execution, List Tags came back as a bare 400 for every term under 3 characters, and a QPY circuit
submitted as bare base64 failed with reason code 1603, reported by the Error Trigger on its own.
Each fix was then re-run against the same service: the empty body now comes back as `{}`, the
bound is checked before a request goes out, and the zlib-wrapped form was accepted and queued.
The two operations that spend quota or write account state were verified without spending either.
A Noise Learner job was accepted by the live endpoint, carried its `cost` cap of 60 on the job
body, and was cancelled while still queued, its metrics showing `running: null` and zero seconds
consumed. Set Cost Limit read the limit back correctly, while its write leg hit a server-side hang
that IBM's edge answered with a 520 after about 50 seconds, reproduced with a raw HTTP request
through the same credential, which places the fault on the service rather than the node, whose 30
second timeout cut the hang exactly as designed. The run-by-run results are in the Tests section
below. Each change was traced end to end through every caller, and the suite grew from 185 tests
to 276 at 100% statement, branch, function and line coverage.

### Fixed

- **Both triggers drop `usableAsTool`.** `@n8n/eslint-plugin-community-nodes` 0.29.0 (2026-08-11)
  reversed the `node-usable-as-tool` rule for trigger nodes: the property the 0.3.3 verification
  pass was required to add is now an error on triggers, so the published 0.3.3 fails
  `npx @n8n/scan-community-package` with exactly 2 errors. The tool variants n8n generated for
  the triggers could never run anyway (a polling trigger implements `poll()`, not `execute()`);
  removing the property also removes them from the AI Agent tool picker. The local lint now runs
  the same plugin version the scanner pins and passes with zero errors.

- **An empty response body no longer fails the whole execution.** IBM answers
  `GET /backends/{id}/defaults` with no content for many devices. The node passed that through as
  `json: null`, and n8n's execution engine reads `json.$error` off every result behind an
  `!== undefined` check that a null slips past, so one empty body ended the run with
  `Cannot read properties of null`. The transport now returns `{}` for an empty body, which also
  protects the handlers that read a field off the response, such as Get Least Busy and Submit.
  *Found on live hardware against ibm_marrakesh, not by any unit test.*

- **List Tags now works at all.** The endpoint requires a search term of at least 3 characters, a
  constraint the first implementation missed, so every call came back as a bare `400` naming
  neither the field nor the limit. The term is now required in the UI and its bounds are checked
  locally. A sweep of every parameter constraint on the endpoints this node calls confirmed the
  others are already respected. *Found on live hardware.*

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

- **QPY circuits.** Submit gains **Circuit Format**, choosing between OpenQASM 3 and QPY, which
  preserves circuits OpenQASM 3 cannot express. The wire format is not the obvious one, and the
  first implementation got it wrong: IBM does not accept a bare base64 string. The official client
  wraps every circuit as `{ "__type__": "QuantumCircuit", "__value__": base64(zlib(qpy)) }`, and the
  server decompresses without asking, so uncompressed bytes cannot work. *Measured:* a live
  submission of base64 QPY came back as reason code 1603, IBM having tried to read the base64 text
  as QASM and tripped over its capital letters. The node now sends the wrapper, and the local guard
  checks for a real zlib header (first byte 0x78, header divisible by 31) rather than a magic
  string. Pasting uncompressed QPY, the natural mistake, is recognised and answered with the exact
  missing step. A workflow saved before this parameter existed stores no value for it and still
  submits OpenQASM 3.

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

- **Job List Tags,** wrapping `GET /v1/tags`. The API requires a search term of 3 to 100 characters
  and offers no way to list every tag, so the term is required and its bounds are checked locally.
  `type=job` is always sent, being the only value the endpoint accepts.

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
  ground for agents changing the code rather than using it. The two llms files ship in the npm
  tarball; `AGENTS.md` is repository-only, since it is about changing the code rather than using it.

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

### Tests

Unit suite: **276 tests**, up from 185, at 100% statement, branch, function and line coverage, with
the thresholds raised to match so an untested line fails the build.

Live verification ran against a throwaway n8n 2.34.6 with the package installed from its own
`npm pack` tarball, the way n8n installs a community package, talking to a real IBM Quantum
instance on the Open plan. Zero QPU seconds were spent: every operation below is a read, a local
computation or a session that ran no jobs.

| what was exercised | expected | observed |
| :-- | :-- | :-- |
| n8n loads the package | 3 node types under the real package prefix | plus 1 tool variant, and **no trigger tool variants**, which the 0.3.3 ruleset had forced |
| Action node version | `[1, 2]`, default 2 | exactly that, loaded by n8n itself |
| Codex metadata | categories and search aliases reach the picker | Development and Analytics, aliases Quantum, Qiskit, QPU, OpenQASM |
| Backend chain, 6 operations | each answers, backend name flows by expression | least busy `ibm_marrakesh`, queue 41, `basis_gates` returned |
| Get Defaults | some devices have none | empty body, reported as `{}` instead of crashing the run |
| Account, 8 read operations | usage, instance, config, API versions and all 4 analytics | all answered; **Get API Versions confirms `2026-04-15` is the only live version** |
| Workload List | jobs, sessions and batches in one listing | 87 total, 68 jobs, 0 sessions, filters applied |
| List Tags | tags matching a term | `qa-audit`, `qa-bell-native`, `qa-bigpayload` and more |
| Circuit Build, native Bell | 13 gate entries, valid OpenQASM 3 | 13 gates, 17 lines, accepted by Import unchanged |
| The 5 local guards | every one refuses before a request goes out | all 5 refused, 0 requests sent |
| Session lifecycle on **typeVersion 2** | create with `sessionMode`, get, stop accepting, close | full cycle green against a real session |
| Dedicated session on the Open plan | IBM's own message, not a generic failure | "You are not authorized to run a session when using the open plan" |
| QPY guard against real Qiskit output | the magic the guard checks matches a real payload | Qiskit 2.5.2 produced 249 bytes whose base64 starts with `UUlTS0lU`, exactly the constant |

A second pass submitted real jobs to `ibm_kingston`, using the trigger pattern rather than a
blocking wait, because the queue was 40 deep at the time.

| what was exercised | expected | observed |
| :-- | :-- | :-- |
| Submit with **Max Cost** and **Log Level** | job accepted, `cost` stored on it | accepted; the job body carries `cost: 60` and an estimated runtime of 4.01 seconds |
| Submit then Cancel | job reaches Cancelled without running | Cancelled, no QPU time charged |
| **QPY as a bare base64 string** | unknown, never tried before | rejected, **reason code 1603**: IBM tried to load the text as QASM. This is what proved the wire format wrong. |
| QPY as `{__type__, __value__}` with zlib | accepted like any other job | queued alongside the valid submissions rather than refused on arrival |
| **IBM Quantum Error Trigger** | detects the failure on its own and reports the reason | fired unprompted, carrying `reasonCode: 1603` and IBM's message, which is how the QPY defect was found |
| Both polling triggers | seed a cursor, never fire on history | 0 firings on activation, then 2 each once jobs reached a terminal state |
| Submit to **Noise Learner**, cancelled while queued | wire format accepted, no QPU time spent | accepted in 845 ms with `cost: 60` stored on the job body; metrics show `running: null`, zero seconds consumed |
| **Update Tags**, then **Delete**, on that cancelled job | tags replaced, then the job gone | `["audit-nl", "cancelled-zero-cost"]` came back, then the delete answered and the job was removed |
| **Set Cost Limit** round trip, writing the same 600 back | configuration unchanged, 204 on the write | the read leg answers in 0.8 s throughout; the write leg hung about 50 s on four attempts over 15 minutes and IBM's edge answered 520, reproduced with a raw HTTP request through the same credential, so the fault sits on the service side and the node's 30 second timeout cut the hang as designed |

The verification scan was pre-flighted by rebuilding the scanner's own ESLint config from its
source and validating the replica against the v0.3.3 tree, where it reproduced the 2 known
`node-usable-as-tool` errors exactly. On this release it reports none.

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
