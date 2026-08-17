<img src="./readme-assets/banner-security.svg" alt="Security policy" width="100%" />

## Supported versions

The latest published version receives security fixes.

## Reporting a vulnerability

Please report security issues privately to **[contact@tuguidragos.com](mailto:contact@tuguidragos.com)** rather than opening a public issue. Include a description, reproduction steps and the affected version. You can expect an initial response within a few business days.

## Scope

This node is a thin REST client for the IBM Quantum Platform. It ships **no runtime dependencies** and stores no credentials itself.

Your IBM Cloud API key is held by n8n as an encrypted credential and exchanged for a short-lived IAM bearer token at request time. Two details follow from that:

- The key never reaches this package's own storage, and nothing is written to disk by the node.
- If the IAM token exchange fails, the error surfaced to you is built from an allowlist: the HTTP status and IBM's public error code, nothing else. The underlying error can carry the request body, which holds the API key, so its message and response body are deliberately never shown.

Requests carry a 30 second timeout, and the token is refreshed by n8n on a 401 rather than being cached indefinitely.

## Reading a supply chain scanner report

Scanners such as Socket report alerts for the whole dependency graph, and for this package that graph is not what it looks like at first glance.

The package installs nothing. `npm ls --omit=dev --all` prints `(empty)`: there are no runtime dependencies, and the published tarball is compiled JavaScript, 4 icons, 3 codex files and the 2 documentation files.

What a scanner counts instead is the single **peer** dependency, `n8n-workflow`. A peer dependency is not installed by this package; n8n itself provides it, and every n8n community node declares it the same way, because that is how the n8n node API is consumed. Scanners still walk it, so alerts belonging to that tree appear under this package's name. Concretely, the install scripts and native code come from `isolated-vm`, reached through `n8n-workflow` and `@n8n/expression-runtime`; the dynamic code execution comes from `recast`, `ast-types` and `esprima-next`; the network access comes from `axios` and the Sentry client; the unmaintained packages include `md5` and `ssh2`. None of that is reachable from this node's code, and none of it changes if you install this package.

The practical consequence: an alert count on a scanner page is about the n8n runtime you already trust enough to run n8n at all, not about this node. The part that is genuinely ours is the package's own code and its own alerts, and there the surface is deliberately as small as it can be.

`npm audit` currently reports a transitive advisory in `nanoid`, pinned at an exact version by `@n8n/utils` under `n8n-workflow`. It cannot be fixed here: the only mechanism would be an `overrides` entry, and the n8n verification ruleset forbids community node packages from declaring one. It is confined to the development tree and waits on n8n.
