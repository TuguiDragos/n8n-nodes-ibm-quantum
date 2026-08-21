# Changelog

All notable changes to this package are documented in this file.

## 0.5.0 (2026-08-21)

### Fixed

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

### Added

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
  Quantum". The other 31 actions were left alone: they read well to a human in the panel and carry
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
  its tooltip is gone because the same guideline asks for none. n8n builds the Triggers list from a
  property named Event, Events or Trigger On; ours were called Status and On, so the panel fell back
  to a single unnamed placeholder instead of listing the options. Only the label changed, the stored
  parameter names are untouched.
- **The three listing operations are named "Get Many"**, which is what n8n's UX guidelines call the
  standard listing operation, and Job "List Tags" is now "Get Many Tags". The stored values are
  unchanged (`list`, `listTags`), so existing workflows keep working.
- **Every operation now carries a description**, rendered under its name in the operation dropdown,
  and example placeholders use the `e.g.` prefix the guidelines ask for.
- **Both `/instances/configuration` calls are marked deprecated in the code.** IBM's live OpenAPI
  spec flags GET and PUT on that path, in favour of the Resource Controller API. Both still answer.
  Account Get Instance already reads the same fields from `/instance`, which is not deprecated.

### Testing

The suite goes from 276 to 616 tests, still at 100% statement, branch, function and line coverage.
The new files cover ground that was unreachable before: `tests/input-guards.test.ts` for every
parameter an expression can corrupt, `tests/node-execute.test.ts` for the node wrapper itself,
`tests/isa-warning.test.ts` for the transpilation warning, and `tests/load-options.test.ts` for the
backend dropdown, including the label fallbacks and the case where the listing is unusable.
`tests/fakeContext.ts` now models `continueOnFail`, per-item parameters and the credential name,
all three of which were hardcoded or discarded, which is why multi-item processing, `pairedItem`,
the continue-on-fail path and the `@version` gate had no coverage despite the 100% figure. All four
turned out to be correct; they are now pinned.

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
