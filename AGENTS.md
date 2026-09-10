# Working on this repository

Guidance for AI coding agents. For what the node does and how to use it, read `llms-full.txt`,
which documents every operation, parameter and output shape. This file is about changing the code.

## What this is

A verified n8n community node for the IBM Quantum Platform, wrapping the Qiskit Runtime REST API
(renamed IBM Quantum Compute Service by IBM in July 2026; the endpoints are unchanged) and, for the
two instance-settings operations, IBM Cloud's Resource Controller. Three node classes and one
credential. TypeScript, zero runtime dependencies, Node.js 24: n8n 2.36 and later require it,
Node.js 22 is enough only for n8n 2.35 and older, and `engines.node` stays `>=22` so CI tests both.

## Layout

| path | what lives there |
| :-- | :-- |
| `nodes/IbmQuantum/IbmQuantum.node.ts` | action node: description, hints, and the resource dispatcher |
| `nodes/IbmQuantum/descriptions.ts` | every UI parameter, as a flat `INodeProperties[]` |
| `nodes/IbmQuantum/operations.ts` | one handler per resource, plus circuit and submit validation |
| `nodes/IbmQuantum/transport.ts` | request helpers for the two Qiskit Runtime hosts and the Resource Controller, API version guard, IBM error unwrapping |
| `nodes/IbmQuantum/qasm3.ts` | gate palette, validation and OpenQASM 3 rendering |
| `nodes/IbmQuantum/results.ts` | sampler and estimator result parsing |
| `nodes/IbmQuantum/triggerPoll.ts` | shared polling loop for both triggers |
| `credentials/IbmQuantumApi.credentials.ts` | IAM token exchange and the connection test |
| `*.node.json` | codex metadata: picker category, search aliases, docs links |
| `scripts/qa-run.mjs` | the live harness: runs every read operation, the lifecycles and both triggers against a real n8n and a real account; run by hand, not shipped |

## Rules that are not obvious

- **Never weaken a local validation.** Circuit checks run before the request on purpose: IBM queues
  a malformed job, charges QPU time, and only then fails it. Every guard in `requireSupportedCircuit`
  exists because a real job burned quota.
- **A scan over circuit text must not let a whitespace run cross a line start.** `\s` matches the
  line terminator that made the next line start, so `^\s*` under /m gives every line in the text
  another place to scan the rest of it from and a circuit of blank lines costs a square, which
  blocks the one thread the whole n8n process runs on. Use `[^\S\n\r\u2028\u2029]*`, the class
  `OPENQASM3_HEADER` carries, which still matches every other character `\s` does. That shape has
  been shipped twice and found twice.
- **A membership test inside a loop over user input goes through a Set.** The comma-separated
  fields have no length bound, so an `includes` per entry is a scan of everything read so far and
  costs a square on that same thread: 40,000 Circuit Parameters spent a second in
  `parseParameterNames` before its duplicate check moved to a Set. A scan of a bounded list is fine,
  which is why the trigger still filters against its 500 seen job ids.
- **A bound on the size of a value must not copy the value to measure it.** `[...value]` builds one
  array element per code point, so the guard against a runaway expression allocated several times
  what it was about to refuse: 256 MB to reject a 32 MB Job ID, 1 GB to count 64 MB of unpaired
  surrogates. `characterLength` walks code units instead, which allocates nothing and is faster on
  every shape of string. Where a message wants only a prefix of a value with no bound, slice first
  and spread the slice.
- **A private job's results can be read only once.** IBM's spec for the `private` flag: "the results
  can only be read once. After the results are read, they are deleted from the service." That makes
  `GET /jobs/{id}/results` a destructive read, so nothing behind it may discard the body it returned.
  Get Results reports a Register Name the body does not carry as `registerError` beside the pubs,
  whenever the body has names to list, rather than failing the item, for that reason.
- **UI `minValue` and `maxValue` are hints only.** An expression can deliver a string, a float, a
  negative, or something that is not a number at all (null, a boolean, an array, an object) into any
  numeric parameter. Coerce with `clampCount` or `clampSeconds`, or refuse with
  `requireBoundedNumber` or `requireBoundedNumberOrAuto`, before use. Never let `asTrimmedString`
  make that decision: it flattens every unreadable value to `''`, and where `''` means "leave the
  key out" the setting the user asked for vanishes from the request in silence.
- **A `boolean` property is a hint too.** n8n type-checks a parameter only while the user is typing
  it; `validateParameter` in `n8n-workflow` skips any value that starts with `=`, so a switch driven
  by an expression arrives as whatever the expression produced. Read every one of them through
  `requireBoolean`, or `optionalBoolean` where an entry never added must leave the key out. Never
  read a switch for truth (`'false'` is a non-empty string and turns it on), never compare it with
  the boolean (`=== true` leaves `'true'` off), and never pass one to IBM untouched.
- **Array query parameters must be repeated keys** (`tags=a&tags=b`). The transport sets
  `arrayFormat: 'repeat'` for this; bracket encodings are silently ignored by IBM, so a filter would
  return everything instead of erroring.
- **Nothing a response or a parameter carries is trusted to be a list.** `?? []` stands in for
  `null` and `undefined` only, so a reshaped body reaches `.filter` or `.map` and ends the item with
  a bare JavaScript message that names neither the operation nor the cause. Every collection read
  out of a body goes through `Array.isArray` first, and so does the gate list inside the `gates`
  collection, which an expression can set whole; no entry is read for a field before it is proved to
  be an object: `parseResults`, the trigger poll, `listAllJobs`, `workloadsOf`, `instancesOf`,
  `getLeastBusy`, `handleCircuitBuild` and the backend dropdown. That shape has been found and
  closed in three releases now, 0.3.3, 0.5.0 and 0.6.0.
- **A key of a shape this node builds holds `null`, never `undefined`.** A key set to `undefined` is
  gone once n8n has serialised the item, so a workflow testing for the `null` the documentation
  promises finds no key at all, and an IF node comparing against null takes the wrong branch. Read a
  body field through a type check that ends in `null`, the way `queueLengthOf`, `deviceName`,
  `qubitsOf`, `processorTypeOf` and `waitTimeOf` do, rather than copying it into the returned
  object. An operation that hands IBM's body back untouched is exempt: that shape is IBM's, and the
  docs say so. `getLeastBusy` copied `name` and `qubits` that way until 0.6.0. A parameter counts as
  much as a body field: Session > Create still copies its Session Mode straight into `mode`, so a
  Session Mode an expression leaves empty drops that documented key from the item. Correcting it is
  a change of its own, because the same value also goes into the request body, where `undefined`
  omits the field and `null` sends an explicit null.
- **Re-wrapping an n8n error adds only `failure`.** `new NodeApiError(node, err, options)` hands
  back `err` itself when `err` is already a `NodeApiError`, applying that one option to it and
  discarding the rest, so the item index n8n points at cannot be attached that way. `asNodeError`
  writes it onto the instance instead, which is where it belongs: the transport wraps an IBM error
  where the request is made and the index has not reached it there, and `asNodeError` is the single
  exit from the per-item loop.
- **No refusal repeats what a credential field holds.** n8n encrypts the API key and masks it, and
  `preAuthentication` hides the token exchange's own error and response body so the request body
  cannot surface it; a refusal that quotes what the credential holds undoes all of that, and the two
  boxes next to API Key take strings just as opaque, so those are the two a key is mis-pasted into.
  `checkApiVersion`, `requireCrn` and the account id check name the field and the shape it wants and
  stop there. Name a credential value only where the check in front of it has already proved the
  value cannot be a secret: the deprecation warning names a version proved to be a date, and the
  shared identifier guard names a value of nothing but dots. The rule covers what the node composes,
  not what IBM sends back: `enrichApiError` relays IBM's message unchanged, and its `code 1279`
  names the `Service-CRN` header it was given, measured with a CRN of the wrong region. A value IBM
  cannot parse as a CRN may draw `1241` or `1348` instead, whose text names nothing, so whether a
  mis-pasted key returns inside IBM's own sentence is IBM's choice, not something this package can
  promise either way. SECURITY.md states the rule for readers, with the `grep` that finds the three,
  and tells them to rotate such a key regardless, on the ground that Instance CRN is not a password
  field.
- **The Resource Controller is a second API on a fourth host.** `resourceControllerRequest` in
  `transport.ts` is the sibling of `ibmQuantumApiRequest`: same IAM bearer token, same 30 second
  timeout, same error unwrapping, but `https://resource-controller.cloud.ibm.com` with no `/v1`
  prefix, and the two Qiskit Runtime headers travel along because the credential signs every request
  the same way. Every `https://` literal in `transport.ts` is read by `tests/metadata.test.ts` as a
  host the node talks to and must have a row in the SECURITY.md hosts table.
- **Every Resource Controller write carries a fresh `timestamp` in `parameters`.** IBM silently
  ignores a request whose `parameters` object is identical to the previous one. Set Cost Limit sets
  it to the current time; a second write operation must do the same. Read `extensions` in the
  response, never `parameters`, which only echoes the last request.
- **Do not name a parameter `mode`.** Observed live on 0.4.1: n8n's MCP server left a parameter
  named `mode` out of the type definition it hands AI workflow builders. `@n8n/workflow-sdk` treats
  `resource`, `operation` and `mode` as discriminator fields, which is the likely cause, though its
  community node path was not traced end to end. Node version 2 renamed the session parameter to
  `sessionMode` for this reason; `mode` survives only for version 1 workflows.
- **Renaming a parameter needs a new node version.** Add it to the `version` array, bump
  `defaultVersion`, and gate both parameters with `displayOptions.show['@version']`.
- **Operation options must be sorted alphabetically by name,** and a numeric parameter named `limit`
  must default to 50. Both are enforced by the n8n lint rules, not by convention.
- **Triggers must not set `usableAsTool`.** A polling trigger cannot run as a tool, and the current
  verification ruleset rejects it.
- **Only ten imports are allowed at runtime.** `no-restricted-imports` permits `n8n-workflow`,
  `ai-node-sdk`, `lodash`, `moment`, `p-limit`, `luxon`, `zod`, `crypto`, `node:crypto` and
  `@n8n/ai-node-sdk`, plus relative paths and devDependencies. Notably `zlib` is not on it, which is
  why the noise learner's rates and QPY circuits are passed through encoded rather than decoded. A
  global such as `DecompressionStream` would slip past the rule, but the ruleset changes on its own
  schedule and a workaround is the first thing to break.
- **The `n8n-workflow` pin follows the version n8n stable ships.** It is exact, not a caret, so it
  has to be bumped by hand: check `npm view n8n dependencies.n8n-workflow` weekly, since n8n
  publishes on Tuesdays, and run the whole suite on the new version in the same change.
- **One lockfile has to satisfy both npm versions CI uses.** CI runs `npm ci` under npm 10 on Node
  22 and npm 11 on Node 24, and the two disagree about optional peers: npm 11 leaves out the
  `ignore` 7.0.9 that `@langchain/community`, deep in the `@n8n/node-cli` tree, declares as one,
  and npm 10 then refuses to install with "Missing: ignore@7.0.9 from lock file". After any
  `npm install` on Node 24, run `npm ci` under Node 22 as well, and if that entry is gone, put
  `node_modules/@n8n/ai-utilities/node_modules/ignore` back where npm 10 places it. The same split
  surfaced the other way round before 0.3.3 was tagged, when a lockfile npm 10 wrote lacked the
  platform binaries npm 11 expects.
- **Lint fails on warnings.** `npm run lint` passes `--max-warnings 0`, because seven rules in the
  ruleset are `warn` rather than `error` and the scanner's verdict counts only errors. Without the
  flag, a deletion that orphaned a file would pass CI green.
- **The verification scanner exits 0 on a failed scan.** It prints its verdict and falls through, a
  missing provenance attestation and a 404 for the package name alike, so `npm run scan` pipes it
  through `scripts/scan-verdict.mjs`, which fails unless the scanner printed its own pass line, and
  `scan.yml` runs that script rather than the scanner. Calling the scanner directly gives back a
  scheduled job that is green whatever it finds.
- **Tests and scripts are linted and formatted too.** `tests/` runs under the community-nodes
  ruleset plus the eslint and typescript-eslint recommended sets, `scripts/` under the eslint
  recommended set with Node globals, and `npm run format` covers both directories. The
  `eslint-plugin-n8n-nodes-base` rulesets stay on `package.json` and the TypeScript under `nodes`
  and `credentials`, and the community-nodes ruleset stays off `scripts/`, because it bans
  `process` and `setTimeout`, which the QA harness needs.
- **`no-console` is an error on every file the community-nodes ruleset covers,** which is
  `package.json`, `index.js`, the `.js`, `.ts` and `.json` under `nodes` and `credentials`, and
  `tests/**/*.ts`. `scripts/` may print, and so may any other extension the lint script reaches
  under those paths, a `.js` under `tests/` or a `.mjs` under `nodes/`, because each resolves to no
  rules at all. That covered list is the verification scanner's own source glob, which takes in the
  codex `.node.json` files as well as the TypeScript, plus the `index.js` its tarball leg lints and
  `tests/`, which the gate never reads. Narrow one of the paths the scanner reads and the narrowed
  path passes CI and fails the gate.

## Before you finish

```bash
npm run lint && npm run format:check && npm run build && npm run test:coverage
```

Coverage is a gate, not a report: 100 for statements, branches, functions and lines. Adding code
without tests fails the build. `descriptions.ts` and the `*.node.ts` wrappers are excluded, but the
node dispatcher is covered by `tests/node-routing.test.ts`, which walks every operation the UI
advertises and fails if one is not routed.

CI also runs `npx --no -- n8n-node lint`, the official CLI over the same config; it refuses to run
if `n8n.strict: true` reappears in `package.json`, so leave that key out. Keep the `--no` wherever
the command is written: an unscoped `n8n-node` on the registry is a placeholder published against
dependency confusion rather than this CLI, so without the flag a checkout where `npm install` has
not run fetches that and lints nothing instead of failing.

When you add or change an operation or a parameter, update `llms-full.txt` in the same change. It
states parameter names and defaults, and a stale entry sends every future agent down the wrong path.
`tests/metadata.test.ts` enforces the minimum: every operation value and parameter name in
`descriptions.ts` must appear in `llms-full.txt`, every operation name in `README.md`, and the
operation count in `README.md`, `llms.txt` and `CHANGELOG.md` must equal what the UI advertises.
Adding an operation therefore touches all four files in the same change. If the operation reads
without spending quota, or the parameter changes a request, add it to `scripts/qa-run.mjs` as well:
the harness is the only check that runs against IBM, and `tests/metadata.test.ts` fails when the
harness names an operation the UI no longer has.

## Releasing

- Date the section for this version in `CHANGELOG.md` before you tag: `## X.Y.Z (YYYY-MM-DD)`, the
  shape 0.2.2 through 0.5.0 carry; the guard also takes a bare year, which is all 0.1.1 has, and
  takes a prerelease version. `prepublishOnly` runs `scripts/release-guard.mjs` first, which reads
  the heading for the version `package.json` declares and stops the publish while it holds anything
  but a date, so a section still marked `(unreleased)` fails the release instead of shipping inside
  it. The date itself is yours; nothing writes it for you.
- Tag `vX.Y.Z`, equal to the version in `package.json`, and publish through the release workflow. It
  refuses to run from anything but a tag, and refuses a tag that is not the version in
  `package.json`, on a manual dispatch as much as on a release. A version carrying a prerelease
  suffix goes out under the `next` dist tag, and so does a release marked as a pre-release: a
  release run reads that flag from the event, a manual run reads it from the tag's own release. A
  tag with no release to read leaves the suffix as the only test, so give a pre-release published
  from a bare tag a version like `0.7.0-rc.1` and `latest` keeps pointing at the current release.
- A draft release is safe. The workflow listens for the `published` activity type, which GitHub
  fires when a release is published, whether it was created outright or published from a draft.
  Nothing runs while the draft is only saved.
- Run `npm run scan` on the published package; it checks it against the live n8n verification
  ruleset, which changes on its own schedule.
- Resubmit the package for n8n verification, and treat the release as unfinished until the listing
  moves. `api.n8n.io/api/community-nodes` holds a row per node type, each pinning one `npmVersion`
  beside that tarball's npm `dist.integrity` as its checksum, and n8n refuses to install a community
  package with no checksum once `N8N_UNVERIFIED_PACKAGES_ENABLED` is off, which n8n 3.0 makes the
  default and which n8n Cloud already is. A checksum fits one tarball, so until n8n relists the
  package the verified path installs the version those rows name and not the one on npm. `0.2.2`,
  `0.2.3` and `0.4.1` never reached the registry at all; `0.5.0` reached it 57 hours after its npm
  publish. n8n documents no update path for a node it has already verified, so neither figure is a
  schedule to plan around. CONTRIBUTING.md says the same under Releasing.
- Ask the n8n team to drop the retired "IBM Quantum Error Trigger (Unofficial)" preview entry from
  api.n8n.io, which ignores the node's `hidden` flag, and to correct the `displayName` on both
  trigger rows, which still read "IBM Quantum Trigger (Unofficial)" and "IBM Quantum Error Trigger
  (Unofficial)", the names 0.1.1 shipped, while the `nodeDescription` inside the same rows carries
  the names 0.3.3 renamed them to. Two relistings since that rename left the field as it was, so it
  is n8n's to change rather than the package's.
- Retake the `readme-assets` screenshots whenever the node details panel has changed; they still
  show the 0.5.0 panel, and the caption under them says so.

## House style

Tabs, single quotes, and the formatting `npm run format` produces. Comments explain why a line
exists, not what it does, and are worth writing only where the reason is not visible in the code:
an IBM quirk, a rule that bit us, a value that looks arbitrary. Do not use em dashes in prose.
