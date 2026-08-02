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
| `npm run lint` | ESLint with the n8n community node ruleset |
| `npm run build` | Compile TypeScript and copy icons into `dist` |
| `npm test` | Vitest, the full unit suite |
| `npm run scan` | The official n8n community package scanner, run before submitting for verification |

All four run in CI on Node 22 and 24. Please make sure `lint`, `build` and `test` pass before opening a pull request.

## Style

- Formatting is handled by Prettier, `npm run format`.
- Keep code comments minimal and in clean English.
- Conventional, imperative commit messages are appreciated, for example "Add backend filter".

## Releasing

`publish.yml` publishes to npm with provenance when a GitHub release is created. The `package.json` version must match the release tag; the workflow checks this and fails the publish if they diverge.
