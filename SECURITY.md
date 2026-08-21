<img src="./readme-assets/banner-security.svg" alt="Security policy" width="100%" />

## What this node can access

Nothing below has to be taken on trust. Every claim here is one `grep` or one command away from being checked.

### Your credentials

- Your IBM Cloud API key is held by n8n as an encrypted credential. This package stores nothing of its own.
- The key is read in exactly one place, `preAuthentication` in `IbmQuantumApi.credentials.ts`, where it is exchanged with IBM IAM for a short-lived bearer token. The string `apiKey` does not appear anywhere under `nodes/`.
- Every other request goes through n8n's `httpRequestWithAuthentication`, so n8n injects the token itself. The node's own code reads neither the key nor the token.
- The token is marked expirable, so n8n refreshes it on a 401 instead of caching it indefinitely.
- If the token exchange fails, the error you see is built from an allowlist: the HTTP status and IBM's public error code, nothing else. The underlying error can carry the request body, which holds the API key, so its message and response body are deliberately never shown.

### Where requests go

Three hosts, and no others:

| host | used for |
| :-- | :-- |
| `iam.cloud.ibm.com` | exchanging the API key for a short-lived token |
| `quantum.cloud.ibm.com` | Qiskit Runtime, US East instances |
| `eu-de.quantum.cloud.ibm.com` | Qiskit Runtime, EU (Germany) instances |

No telemetry, no analytics, no third party of any kind. Every request the node itself issues carries a 30 second timeout. The credential Test button and the IAM token exchange run through n8n's own helpers, so they take n8n's defaults rather than this one.

### What gets written down

The node itself never touches the filesystem. The polling triggers keep a cursor, the ids and timestamps of the jobs they have already seen, in n8n's own workflow static data, so a poll does not emit the same job twice. That cursor holds no credentials.

## Reporting a vulnerability

Report security issues privately, never as a public issue. The preferred route is GitHub's [Report a vulnerability](https://github.com/TuguiDragos/n8n-nodes-ibm-quantum/security/advisories/new) form, which opens a private advisory only you and the maintainer can see. Email **[contact@tuguidragos.com](mailto:contact@tuguidragos.com)** works just as well if you prefer it.

Include a description, reproduction steps and the affected version. You can expect an initial response within a few business days, and good faith research is welcome.

In scope: this package's own code, its credential handling, and what it publishes to npm.

Out of scope, because they belong to someone else and are fixed faster at the source:

| not this package | report it here |
| :-- | :-- |
| n8n itself, including everything reachable through the `n8n-workflow` peer dependency | [n8n security policy](https://github.com/n8n-io/n8n/security/policy) |
| the IBM Quantum Platform API | [IBM PSIRT](https://www.ibm.com/trust/security-psirt) |

## Supported versions

The latest published version receives security fixes. Older versions receive none, so upgrading is the fix. A security release is recorded in [CHANGELOG.md](CHANGELOG.md) like any other change.

## Supply chain

### How this package is published

Publishing runs from a GitHub release through npm trusted publishing over OpenID Connect. There is no npm token stored in this repository, so there is nothing here to steal or rotate, and every release carries a provenance attestation tying the tarball to the public commit it was built from.

You can check that without installing anything:

```bash
npm view n8n-nodes-ibm-quantum dist.attestations
```

### What is in the package

| what | detail |
| :-- | :-- |
| compiled JavaScript | the node, its two triggers, the credential and their helpers |
| type declarations and source maps | the maps carry file paths only, never source content |
| icons | 4 SVGs, light and dark, for the node and the credential |
| codex files | 3, giving each node its picker category, aliases and documentation links |
| documentation and license | `README.md`, `LICENSE`, `llms.txt` and `llms-full.txt` |

There are no runtime dependencies at all: `npm ls --omit=dev --all` prints `(empty)`. To list the exact contents of any published version:

```bash
npm pack --dry-run n8n-nodes-ibm-quantum
```

### Reading a scanner report

Scanners such as Socket report alerts for the whole dependency graph, and for this package that graph is not what it looks like at first glance.

What a scanner walks is the single **peer** dependency, `n8n-workflow`. A peer dependency is not installed by this package; n8n itself provides it, and every n8n community node declares it the same way, because that is how the n8n node API is consumed. Alerts belonging to that tree still appear under this package's name:

| alert | where it actually comes from |
| :-- | :-- |
| install scripts, native code | `isolated-vm`, via `n8n-workflow` and `@n8n/expression-runtime` |
| dynamic code execution | `recast`, `ast-types`, `esprima-next` |
| network access | `axios` and the Sentry client |
| unmaintained packages | `md5`, `ssh2` |

None of it is reachable from this node's code, and none of it changes if you install this package. An alert count on a scanner page is about the n8n runtime you already trust enough to run n8n at all.

### Known advisory

`npm audit` currently flags `nanoid` through two advisories, and counts three vulnerabilities because it also counts the two packages above it, `@n8n/utils` and `n8n-workflow`.

Neither advisory can be closed from here. The patched `nanoid` does exist upstream, but the first `n8n-workflow` that pulls it in is published on the `beta` tag rather than `stable`, and this package pins the stable release on purpose. The other route, an `overrides` entry, is forbidden to community node packages by the n8n verification ruleset.

Both are confined to the development tree and never ship. GitHub's own Dependabot reaches the same conclusion and auto-dismisses them as development-scoped, so they wait on n8n.
