# Contributing

Thanks for your interest in improving this node. This guide covers the local setup and the
checks that run in continuous integration.

## Prerequisites

- Node.js 20.19 or newer
- npm

## Setup

```bash
npm install
```

A transitive development dependency (`isolated-vm`, pulled in by `n8n-workflow`) builds a
native module that does not yet support the newest Node releases. It is not needed to lint,
build or test this package, so on Node 24 or newer install with:

```bash
npm install --ignore-scripts
```

## Checks

```bash
npm run lint     # ESLint with the n8n community node ruleset
npm run build    # compile TypeScript and copy icons into dist
npm test         # Vitest unit tests
npm run scan     # official n8n community package scanner (run before submitting for verification)
```

All four run in CI on Node 20, 22 and 24. Please make sure `lint`, `build` and `test` pass
before opening a pull request.

## Style

- Formatting is handled by Prettier (`npm run format`).
- Keep code comments minimal and in clean English.
- Conventional, imperative commit messages are appreciated (for example, "Add backend filter").

## Releasing

Releases publish to npm with provenance through the `publish.yml` GitHub Actions workflow when
a GitHub release is created. The package version must match the release tag.
