# Working on this repository

Guidance for AI coding agents. For what the node does and how to use it, read `llms-full.txt`,
which documents every operation, parameter and output shape. This file is about changing the code.

## What this is

A verified n8n community node for the IBM Quantum Platform, wrapping the Qiskit Runtime REST API
(renamed IBM Quantum Compute Service by IBM in July 2026; the endpoints are unchanged). Three node
classes and one credential. TypeScript, zero runtime dependencies, Node.js 22 or 24.

## Layout

| path | what lives there |
| :-- | :-- |
| `nodes/IbmQuantum/IbmQuantum.node.ts` | action node: description, hints, and the resource dispatcher |
| `nodes/IbmQuantum/descriptions.ts` | every UI parameter, as a flat `INodeProperties[]` |
| `nodes/IbmQuantum/operations.ts` | one handler per resource, plus circuit and submit validation |
| `nodes/IbmQuantum/transport.ts` | request helper, region hosts, API version guard, IBM error unwrapping |
| `nodes/IbmQuantum/qasm3.ts` | gate palette, validation and OpenQASM 3 rendering |
| `nodes/IbmQuantum/results.ts` | sampler and estimator result parsing |
| `nodes/IbmQuantum/triggerPoll.ts` | shared polling loop for both triggers |
| `credentials/IbmQuantumApi.credentials.ts` | IAM token exchange and the connection test |
| `*.node.json` | codex metadata: picker category, search aliases, docs links |

## Rules that are not obvious

- **Never weaken a local validation.** Circuit checks run before the request on purpose: IBM queues
  a malformed job, charges QPU time, and only then fails it. Every guard in `requireSupportedCircuit`
  exists because a real job burned quota.
- **UI `minValue` and `maxValue` are hints only.** An expression can deliver a string, a float or a
  negative into any numeric parameter. Coerce with `clampCount` or `clampSeconds` before use.
- **Array query parameters must be repeated keys** (`tags=a&tags=b`). The transport sets
  `arrayFormat: 'repeat'` for this; bracket encodings are silently ignored by IBM, so a filter would
  return everything instead of erroring.
- **Do not name a parameter `mode`.** n8n's MCP server treats that name as a node discriminator and
  drops it from the type definitions AI workflow builders read. Node version 2 renamed the session
  parameter to `sessionMode` for exactly this reason; `mode` survives only for version 1 workflows.
- **Renaming a parameter needs a new node version.** Add it to the `version` array, bump
  `defaultVersion`, and gate both parameters with `displayOptions.show['@version']`.
- **Operation options must be sorted alphabetically by name,** and a numeric parameter named `limit`
  must default to 50. Both are enforced by the n8n lint rules, not by convention.
- **Triggers must not set `usableAsTool`.** A polling trigger cannot run as a tool, and the current
  verification ruleset rejects it.

## Before you finish

```bash
npm run lint && npm run build && npm run test:coverage
```

Coverage is a gate, not a report: lines 100, statements 99, functions 100, branches 97. Adding code
without tests fails the build. `descriptions.ts` and the `*.node.ts` wrappers are excluded, but the
node dispatcher is covered by `tests/node-routing.test.ts`, which walks every operation the UI
advertises and fails if one is not routed.

Run `npm run scan` before a release; it checks the published package against the live n8n
verification ruleset, which changes on its own schedule.

When you add or change an operation or a parameter, update `llms-full.txt` in the same change. It
states parameter names and defaults, and a stale entry sends every future agent down the wrong path.

## House style

Tabs, single quotes, and the formatting `npm run format` produces. Comments explain why a line
exists, not what it does, and are worth writing only where the reason is not visible in the code:
an IBM quirk, a rule that bit us, a value that looks arbitrary. Do not use em dashes in prose.
