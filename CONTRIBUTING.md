<img src="./readme-assets/banner-contributing.svg" alt="Contributing" width="100%" />

Thanks for your interest in improving this node. This guide covers the local setup and the checks that run in continuous integration. Taking part here, in issues, pull requests or discussions, means following the [Code of Conduct](CODE_OF_CONDUCT.md). If you are pointing an AI coding agent at this repository, [AGENTS.md](AGENTS.md) carries the conventions it should follow.

## What to work on

Bug reports and pull requests are both welcome. For anything larger than a fix, open an issue first with the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml) and describe the operation or option you need, so the shape can be agreed on before you write it. Wider IBM Qiskit Runtime coverage, clearer error messages and stronger tests are the easiest changes to accept. A new runtime dependency is the hardest: the package ships with none today, only a peer dependency on `n8n-workflow`.

## Prerequisites

Node.js 24 and npm. n8n 2.36 and later require Node 24, so develop and link against that. Node.js 22 (22.22 or newer) still lints, builds and tests the package and CI runs both, because n8n 2.35 and older run on it and `engines.node` stays `>=22`.

## Setup

```bash
npm install
```

`isolated-vm`, a native transitive development dependency pulled in by `n8n-workflow`, is not needed to lint, build or test this package. It ships prebuilt binaries for Node 22 and 24, but skipping its install scripts saves the download and keeps the install working on any Node release it has no prebuild for, which is what CI does on both versions:

```bash
npm install --ignore-scripts
```

## Running it in n8n

Lint and tests say nothing about how the node looks or behaves in the editor, so link a build into a local n8n. From this repository:

```bash
npm run build
npm link
```

The link is picked up from the custom extensions directory of your n8n installation, `~/.n8n/custom` unless `N8N_CUSTOM_EXTENSIONS` points elsewhere. Create that directory and run `npm init` in it if it does not exist yet, then from inside it:

```bash
npm link n8n-nodes-ibm-quantum
```

Restart n8n, then search the nodes panel for "IBM Quantum". Every change needs a rebuild; whether it also needs a restart depends on the n8n you run: since n8n 2.29.0 (30 June 2026) a symlinked community node is reloaded without one, so on 2.29 or newer the rebuild is enough, and older releases need a restart after each rebuild. `npm run dev` keeps TypeScript compiling in the background, but it does not copy the icons or the codex `.node.json` files, so run the full build after touching those.

## Checks

| command | what it does |
| :-- | :-- |
| `npm run lint` | ESLint over `package.json`, `index.js` and everything under `nodes` and `credentials`, the codex `.node.json` files included, with the n8n community-nodes ruleset and `no-console`, and `eslint-plugin-n8n-nodes-base` on `package.json` and the TypeScript under `nodes` and `credentials`, over `tests` with the community-nodes ruleset, `no-console` and the eslint and typescript-eslint recommended rules, and over `scripts` with the eslint recommended rules and Node globals. It runs with `--max-warnings 0`, so a warning fails it: seven rules in the n8n ruleset ship as `warn` rather than `error`, among them `no-dead-files`, and the scanner's own verdict counts only errors. These are the rules the verification scanner applies, at the severities it applies them: its source leg reads `package.json`, `nodes` and `credentials`, its tarball leg adds `index.js` and the compiled `dist`, and that `dist` is the only thing either leg reads and this lint does not. No test and no script is in either scope, and a clean lint on its own is still not a clean scan; see below |
| `npx --no -- n8n-node lint` | The lint the n8n verification process runs, through the official `@n8n/node-cli`. It is `eslint .` with this repository's own `eslint.config.mjs`, and every rule there names the paths it applies to, so the config puts no rule on the one file it reaches beyond the lint script's paths, `.prettierrc.js`. The command itself runs without `--max-warnings 0`, so it is that same run minus the threshold rather than a complement to it: the seven `warn` rules still print and it still exits 0 on them. What it adds is the process check, and the one file the lint script never reads: a `.prettierrc.js` that does not parse, that names a rule that does not exist, or that turns a rule on at `error` in a comment and then breaks it, fails this command while `npm run lint` stays green. It refuses to run while `package.json` carries a truthy `n8n.strict` next to a custom config, which is why that flag is gone; `false` is accepted, and the ruleset errors on anything that is not a boolean. Keep the `--no`: an unscoped `n8n-node` on the registry is a placeholder published against dependency confusion rather than this CLI, so without the flag a checkout where `npm install` has not run fetches that and lints nothing instead of failing. CI runs it |
| `npm run format` | Prettier over `nodes`, `credentials`, `tests` and `scripts`. `npm run format:check` is the same check without writing, and CI runs it |
| `npm run build` | Compile TypeScript, then copy the icons and the codex `.node.json` files into `dist` |
| `npm test` | Vitest, the full unit suite |
| `npm run test:coverage` | The same suite with coverage, checked against the thresholds in `vitest.config.mts` |
| `npm run scan` | The official n8n community package scanner, run against the published package before submitting for verification. The scanner prints its verdict and exits 0 either way, so the script pipes it through `scripts/scan-verdict.mjs`, which passes its output through and exits 1 on anything that is not a pass |

CI runs `lint`, `n8n-node lint`, `format:check`, `build` and `test:coverage` on Node 24, the version n8n has required since 2.36, and on Node 22, which n8n 2.35 and older still run on, and coverage is a gate rather than a report: the thresholds in `vitest.config.mts` are 100 for statements, branches, functions and lines, so a new line without a test fails the build. Please run those five before opening a pull request.

None of those touches IBM. `scripts/qa-run.mjs` does: pointed at a running n8n with the node linked in, it creates workflows through the n8n public API, a webhook one for every read operation, for the local circuit guards and for the session and job lifecycles, and one per polling trigger, which it activates and then waits for, runs them against your account, prints each node's output and deletes the workflows again. It needs `N8N_API_KEY` and `QA_CRED_ID` (the id of the IBM Quantum credential in that n8n); `N8N_BASE`, `QA_BACKEND`, `QA_PREFIX` and `KEEP=1` are optional, and the Noise Learner and identity probe phases run only with `QA_NOISE_LEARNER=1` and `QA_IDENTITY_PROBE=1`. The Sampler and Estimator phases submit real jobs and spend QPU quota, so it is a release check rather than a pull request check.

`scan` inspects the package already published on npm, so it cannot run on a pull request. It also does more than lint: it checks the npm provenance attestation, fetches the source commit that attestation points at and lints it, then lints the published tarball separately, because provenance pins the source and not the build output.

It runs on a monthly schedule in `scan.yml`, against whichever ruleset is current at that moment rather than the one this repository pins, because the n8n verification ruleset changes independently of this repository and has already broken a release that was compliant when it shipped. The scheduled job runs `npm run scan`, so it fails on a failed scan; the scanner alone would report success.

## Releasing

Publishing to npm is not the step that makes a version available. n8n's community node registry at `api.n8n.io/api/community-nodes` holds one row per node type in this package, and each row pins a single `npmVersion` beside that tarball's own npm `dist.integrity` as its checksum, with the earlier verified versions and their checksums listed next to it. n8n hands that checksum to its installer and refuses to install a community package without one whenever `N8N_UNVERIFIED_PACKAGES_ENABLED` is off, which n8n 3.0 makes the default and which n8n Cloud already is, since n8n documents that unverified community nodes are not available there at all. A checksum fits one tarball and no other, so until n8n relists the package the verified path installs the version those rows name, whatever npm's `latest` points at. `0.2.2`, `0.2.3` and `0.4.1` went to npm and never reached the registry; `0.5.0` reached it 57 hours after it was published. n8n documents how to submit a node for verification and says nothing about updating one it has already verified, so that 57 hours is a single measurement rather than a schedule: read the rows back before treating a release as delivered. [AGENTS.md](AGENTS.md) carries the rest of the sequence.

## Style

- Formatting is handled by Prettier and checked in CI, so run `npm run format` before pushing.
- Keep code comments minimal and in clean English.
- Conventional, imperative commit messages are appreciated, for example "Add backend filter".

## License

Contributions are accepted under the [MIT license](LICENSE) that covers this repository.
