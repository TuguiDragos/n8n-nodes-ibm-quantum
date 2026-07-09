# Changelog

All notable changes to this package are documented in this file.

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
