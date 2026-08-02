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
