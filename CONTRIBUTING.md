<img src="./readme-assets/banner-contributing.svg" alt="Contributing" width="100%" />

Thanks for your interest in improving this node. This guide covers the local setup and the checks that run in continuous integration.

## Prerequisites

Node.js 22 or newer, and npm.

## Setup

```bash
npm install
```

`isolated-vm`, a native transitive development dependency pulled in by `n8n-workflow`, does not yet build on the newest Node releases. It is not needed to lint, build or test this package, so on Node 24 or newer install with:

```bash
npm install --ignore-scripts
```

## Checks

| command | what it does |
| :-- | :-- |
| `npm run lint` | ESLint over `package.json`, `nodes` and `credentials`, with both the n8n community-nodes ruleset and `eslint-plugin-n8n-nodes-base`. This mirrors what the official verification scanner runs, so a clean local lint means a clean scan. |
| `npm run build` | Compile TypeScript, then copy the icons and the codex `.node.json` files into `dist` |
| `npm test` | Vitest, the full unit suite |
| `npm run test:coverage` | The same suite with coverage, checked against the thresholds in `vitest.config.mts` |
| `npm run scan` | The official n8n community package scanner, run before submitting for verification |

CI runs `lint`, `build` and `test:coverage` on Node 22 and 24, and coverage is a gate rather than a report: the thresholds in `vitest.config.mts` are 100 for statements, branches, functions and lines, so a new line without a test fails the build. Please make sure all 3 pass before opening a pull request.

`scan` inspects the package already published on npm, so it cannot run on a pull request. It runs instead on a monthly schedule in `scan.yml`, because the n8n verification ruleset changes independently of this repository and has already broken a release that was compliant when it shipped.

## Style

- Formatting is handled by Prettier, `npm run format`.
- Keep code comments minimal and in clean English.
- Conventional, imperative commit messages are appreciated, for example "Add backend filter".

## Releasing

`publish.yml` publishes to npm when a GitHub release is created. The `package.json` version must match the release tag; the workflow checks this and fails the publish if they diverge.

Authentication is npm trusted publishing over OpenID Connect, so there is no token in the repository and nothing to rotate. The job holds `id-token: write` and exchanges a short-lived, workflow-scoped credential for publish rights, and provenance attestations are generated automatically on that path. It runs on Node 24 rather than 22 because trusted publishing needs npm 11.5.1 or newer, and Node 22 still ships npm 10.9.x.
