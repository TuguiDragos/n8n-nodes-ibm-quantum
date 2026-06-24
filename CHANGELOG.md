# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Backend resource: list backends, get configuration, properties and status, and select the
  least busy backend with optional minimum qubit and simulator filters.
- Circuit resource: build an OpenQASM 3 program from a gate list, or import an existing one.
- Job resource: submit to the Sampler or Estimator primitive, get status, poll for results,
  and list, cancel or delete jobs.
- IBM Quantum Trigger node that polls for jobs reaching a terminal state and starts a workflow,
  so long-running jobs can be handled asynchronously instead of blocking on Get Results.
- IBM Quantum Error Trigger node that fires only on failed or canceled jobs and emits the
  failure reason, reason code and suggested solution, for alerting and classical fallback.
- Session resource (Create dedicated or batch, Get, Set Accepting Jobs, Close) plus a Session ID
  field on Submit, so hybrid loops (VQE, QAOA) can reserve the backend for consecutive jobs.
- Account resource (Get Usage, Get Instance) to check remaining compute allocation before a run.
- Split Submit into Submit to Sampler and Submit to Estimator, and added structured V2 options
  (dynamical decoupling, gate and measurement twirling, precision) and parametrized-circuit support.
- Credential authentication through the n8n native mechanism (preAuthentication, authenticate)
  with an automatic token refresh and a credential test.
- Build-time validation of gate arity, qubit and classical bit ranges, and parameter counts.
- Vitest unit tests and coverage thresholds for the QASM builder and result parser.
- Continuous integration across Node 20, 22 and 24.

### Changed

- Clearer field and credential descriptions throughout the UI, explaining the quantum
  terms (primitive, observable, CRN, region, terminal status) for non-expert users.

## [0.1.0]

- Initial development version.
