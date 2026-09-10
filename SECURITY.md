<img src="./readme-assets/banner-security.svg" alt="Security policy" width="100%" />

## What this node can access

Nothing below has to be taken on trust. Every claim here is one `grep` or one command away from being checked.

### Your credentials

- Your IBM Cloud API key is held by n8n as an encrypted credential. This package stores nothing of its own.
- The key is read in exactly one place, `preAuthentication` in `IbmQuantumApi.credentials.ts`, where it is exchanged with IBM IAM for a short-lived bearer token. The string `apiKey` does not appear anywhere under `nodes/`.
- Every other request goes through n8n's `httpRequestWithAuthentication`, so n8n injects the token itself. The node's own code reads neither the key nor the token.
- The token is marked expirable, so n8n refreshes it on a 401 instead of caching it indefinitely.
- If the token exchange fails, the error you see is built from an allowlist: the HTTP status and IBM's public error code, nothing else. The underlying error can carry the request body, which holds the API key, so its message and response body are deliberately never shown.
- No refusal the node raises repeats what a credential field holds. That matters because such a message is copied into a workflow item, into the error n8n saves with the execution, and into the context of an AI Agent calling the node as a tool. The three refusals that read a credential field name the field and the shape it wants and stop there: `grep -n 'checkApiVersion\|requireCrn\|ACCOUNT_ID_PATTERN' nodes/IbmQuantum/*.ts` finds them. Two messages do name a credential value, and in each the check in front of it has already proved the value cannot be a secret: the deprecation notice names an API Version proved to be a calendar date, and the shared identifier guard names a value of nothing but dots.
- IBM's own errors are relayed word for word, and one of them can quote the credential back. The Instance CRN travels as the `Service-CRN` header on every request (`grep -n 'Service-CRN' credentials/IbmQuantumApi.credentials.ts`), and `enrichApiError` puts IBM's message on the node error unchanged (`grep -n 'ibm.message' nodes/IbmQuantum/transport.ts`), so whatever IBM writes lands in the item, in the saved execution and in an AI Agent's context. What has been measured is a CRN of the wrong region: IBM answers `code 1279`, "Instance ... not found.", naming the CRN it was sent. What a value that is not a CRN at all draws has not been measured, and IBM's registry carries two codes for that case whose text has no room for the value, `1241` "Invalid CRN." and `1348` "Invalid CRN format. The CRN must have the expected number of fields.", so the choice is IBM's and not this package's.
- Treat a key that has been in the Instance CRN box as exposed and rotate it, whatever IBM answered. That box is not a password field (`grep -n 'password: true' credentials/IbmQuantumApi.credentials.ts` finds the two that are, API Key and the hidden session token), so the value stays readable in the credential form, and it is sent to IBM on every authenticated request.

### Where requests go

Four hosts, and no others:

| host | used for |
| :-- | :-- |
| `iam.cloud.ibm.com` | exchanging the API key for a short-lived token |
| `quantum.cloud.ibm.com` | Qiskit Runtime, US East instances |
| `eu-de.quantum.cloud.ibm.com` | Qiskit Runtime, EU (Germany) instances |
| `resource-controller.cloud.ibm.com` | IBM Cloud Resource Controller, only for Account > Get Many Instances and Account > Set Cost Limit |

No telemetry, no analytics, no third party of any kind. The Resource Controller calls carry the same bearer token and, because the credential adds its headers to every authenticated request, the `Service-CRN` and `IBM-API-Version` headers as well, which that API does not define. Every request the node itself issues carries a 30 second timeout. The credential Test button and the IAM token exchange run through n8n's own helpers, so they take n8n's defaults rather than this one.

### What gets written down

The node itself never touches the filesystem. The polling triggers keep a cursor, the ids of the jobs they have already seen, in n8n's own workflow static data, so a poll does not emit the same job twice. That cursor holds no credentials.

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

Publishing runs from a tag through npm trusted publishing over OpenID Connect, on a GitHub release or on a manual run of the same workflow pointed at that tag, and either way the job stops unless the tag is the version `package.json` declares. There is no npm token stored in this repository, so there is nothing here to steal or rotate, and every release carries a provenance attestation tying the tarball to the public commit it was built from. The job that holds the OIDC token installs with no dependency cache, which is what `actions/setup-node` advises for a publishing workflow: a poisoned cache is a way to hand that token to the code it restores.

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

### Open advisories

Four, at the moment, on three packages, which `npm audit` reports as ten moderate findings because it counts every package on the path to them as well. All of them arrive through `@n8n/node-cli`, the CLI the n8n submission guide requires as a development dependency, and its `@n8n/ai-node-sdk` tree: `qs` 6.15.2 (GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g), `stream-json` 1.9.1 (GHSA-528h-pc64-c93x) and `uuid` 10 (GHSA-w5hq-g745-h8pq). Five release sections in [CHANGELOG.md](CHANGELOG.md) record where `npm audit` stood at the time, 0.2.2, 0.3.3, 0.4.1, 0.5.0 and 0.6.0; `grep -n 'npm audit' CHANGELOG.md` finds them.

None of them can be closed from here. Inside that tree the `qs` and `stream-json` links are exact pins, on the `beta` tag as well, and `uuid` sits behind exact pins on `@langchain/classic` 1.0.27 and `@langchain/community` 1.1.27, which want it as `^10.0.0`, a range whose only published release is 10.0.0 while the fix is 11.1.1, so there is no in-range update to take on any of the three; `npm audit fix --force` would install `@n8n/node-cli` 0.20.0, below the 0.23.0 the submission guide asks for, and every CLI version from 0.21.0 up carries the same tree; and an `overrides` entry is forbidden to community node packages by the n8n verification ruleset. They clear when n8n moves its own pins, so they wait on n8n.

The three findings that 0.4.1 and 0.5.0 recorded were a different set: two advisories on `nanoid`, reached through `n8n-workflow` and `@n8n/utils`, which pinned it at 3.3.8 while the fix was 3.3.18. They closed when the `stable` line moved to 2.36 and the pin here followed, in August 2026.

Whatever the count is when you read this, it describes the development tree only. The published package declares no `dependencies`, only a peer on `n8n-workflow` that n8n itself provides, so installing this package adds nothing for `npm audit` to walk. Both claims can be checked against the version you have:

```bash
npm ci --ignore-scripts && npm audit   # the development tree
npm ls --omit=dev --all                # what ships, which prints (empty)
```

A finding that appears next is handled the same way: no `overrides`, a bump of `n8n-workflow` only to the version n8n's own stable release ships, which `npm view n8n dependencies.n8n-workflow` reports and which can run ahead of the `stable` tag on `n8n-workflow` itself, and the finding recorded in this section until it clears.
