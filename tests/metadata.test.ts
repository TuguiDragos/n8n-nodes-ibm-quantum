import { describe, expect, it } from 'vitest';

// Everything here is read through a relative import rather than the filesystem. The n8n
// verification scanner lints this directory too, and its no-restricted-imports rule allows only
// relative paths, devDependencies and a short allowlist, so `node:fs` would fail the scan.
import changelog from '../CHANGELOG.md?raw';
import { IbmQuantumApi } from '../credentials/IbmQuantumApi.credentials';
import llmsFull from '../llms-full.txt?raw';
import llmsIndex from '../llms.txt?raw';
import { nodeProperties } from '../nodes/IbmQuantum/descriptions';
import { IbmQuantum } from '../nodes/IbmQuantum/IbmQuantum.node';
import codexAction from '../nodes/IbmQuantum/IbmQuantum.node.json';
import { IbmQuantumErrorTrigger } from '../nodes/IbmQuantum/IbmQuantumErrorTrigger.node';
import codexErrorTrigger from '../nodes/IbmQuantum/IbmQuantumErrorTrigger.node.json';
import { IbmQuantumTrigger } from '../nodes/IbmQuantum/IbmQuantumTrigger.node';
import codexTrigger from '../nodes/IbmQuantum/IbmQuantumTrigger.node.json';
import PACKAGE from '../package.json';
import readme from '../README.md?raw';

const NODES = [
	[new IbmQuantum(), codexAction],
	[new IbmQuantumTrigger(), codexTrigger],
	[new IbmQuantumErrorTrigger(), codexErrorTrigger],
] as const;

describe('package registration', () => {
	it('registers every node class it ships, and the credential', () => {
		for (const [node] of NODES) {
			const file = `dist/nodes/IbmQuantum/${node.constructor.name}.node.js`;
			expect(PACKAGE.n8n.nodes).toContain(file);
		}
		expect(PACKAGE.n8n.nodes).toHaveLength(NODES.length);
		expect(PACKAGE.n8n.credentials).toContain('dist/credentials/IbmQuantumApi.credentials.js');
	});

	it('names the credential the nodes ask for', () => {
		const credentialName = new IbmQuantumApi().name;
		for (const [node] of NODES) {
			expect(node.description.credentials?.[0].name).toBe(credentialName);
		}
	});
});

describe('codex files', () => {
	// The build copies these into dist; if one drifts from its node name n8n silently ignores it,
	// so the picker category, search aliases and docs links disappear without any error.
	it.each(NODES.map(([node, codex]) => [node.constructor.name, node, codex] as const))(
		'%s has a codex naming its own node type',
		(_className, node, codex) => {
			expect(codex.node).toBe(`${PACKAGE.name}.${node.description.name}`);
			expect(codex.categories.length).toBeGreaterThan(0);
			expect(codex.alias.length).toBeGreaterThan(0);
			expect(codex.resources).toBeTruthy();
		},
	);

	// Both codex versions belong to the codex schema and are always "1.0". Neither tracks the
	// node's runtime typeVersion: n8n's own Code node ships version [1, 2] with codex "1.0", and
	// 399 of the 400 built-in codex files use it. Setting nodeVersion to "2.0" to match
	// defaultVersion failed the n8n review twice, so it is pinned here.
	it.each(NODES.map(([node, codex]) => [node.constructor.name, codex] as const))(
		'%s pins both codex versions to the schema value',
		(_className, codex) => {
			expect(codex.nodeVersion).toBe('1.0');
			expect(codex.codexVersion).toBe('1.0');
		},
	);
});

describe('documented surface', () => {
	// The operation count appears in README.md and llms.txt. Both are written by hand, so this
	// pins the real figure: if you add an operation, update the prose the failure points at.
	const EXPECTED = { account: 8, backend: 6, circuit: 2, job: 12, session: 4, workload: 1 };

	it('has the resource and operation counts the docs claim', () => {
		const counts: Record<string, number> = {};
		for (const property of nodeProperties) {
			if (property.name !== 'operation') continue;
			for (const resource of (property.displayOptions?.show?.resource ?? []) as string[]) {
				counts[resource] = ((property.options ?? []) as unknown[]).length;
			}
		}
		expect(counts).toEqual(EXPECTED);
		const total = Object.values(EXPECTED).reduce((sum, n) => sum + n, 0);
		expect(total).toBe(33);

		// The same figure is written out in three places by hand. Pin all of them, because a count
		// that drifts in prose is the kind of error no other test would ever catch.
		expect(llmsIndex).toContain(`${total} operations`);
		expect(readme).toContain(
			`${total} operations across ${Object.keys(EXPECTED).length} resources`,
		);
		expect(changelog).toContain(`${total} operations`);
	});
});

describe('the example workflow in llms-full.txt', () => {
	// The fenced JSON is written to be imported into n8n verbatim, so it must stay parseable and
	// internally wired: a stale node name inside connections would import as a broken workflow,
	// and an AI assistant copying it would ship that breakage onward.
	it('parses, wires every connection to a real node, and uses the current node version', () => {
		const fenced = llmsFull.match(/```json\n([\s\S]*?)```/);
		expect(fenced).not.toBeNull();
		const workflow = JSON.parse((fenced as RegExpMatchArray)[1]) as {
			nodes: Array<{ name: string; type: string; typeVersion: number }>;
			connections: Record<string, { main: Array<Array<{ node: string }>> }>;
		};
		const names = workflow.nodes.map((node) => node.name);
		expect(names.length).toBeGreaterThan(0);
		for (const [source, outputs] of Object.entries(workflow.connections)) {
			expect(names).toContain(source);
			for (const port of outputs.main) {
				for (const target of port) expect(names).toContain(target.node);
			}
		}
		const ibmNodes = workflow.nodes.filter((node) => node.type === `${PACKAGE.name}.ibmQuantum`);
		expect(ibmNodes.length).toBeGreaterThan(0);
		for (const node of ibmNodes) expect(node.typeVersion).toBe(2);
	});
});

// A json field whose default does not parse makes n8n's code editor show a lint error before the
// user has touched anything, on an optional field.
describe('every JSON field opens without an error marker', () => {
	it('gives each json parameter a default that parses', () => {
		const jsonFields = nodeProperties.filter((property) => property.type === 'json');
		expect(jsonFields.length).toBeGreaterThan(0);
		for (const field of jsonFields) {
			expect(() => JSON.parse(String(field.default))).not.toThrow();
		}
	});
});

// n8n loads a dynamic list once, on open, and on Refresh List. There is no polling and no TTL
// (ParameterInput.vue: the credentials watcher runs immediate, plus the refreshOptions action),
// so the status and queue in a label go stale while the panel stays open. Say so in the tooltip.
describe('the backend dropdowns explain when their labels refresh', () => {
	const dropdowns = nodeProperties.filter(
		(property) => property.typeOptions?.loadOptionsMethod === 'getBackends',
	);

	it('covers every field that loads the list', () => {
		expect(dropdowns.length).toBeGreaterThan(0);
		for (const field of dropdowns) {
			expect(field.description).toContain('Refresh List');
		}
	});

	// The lint rule node-param-description-wrong-for-dynamic-options requires the standard
	// sentence to be last, so anything added has to sit in front of it.
	it('keeps the expression hint as the closing sentence', () => {
		for (const field of dropdowns) {
			expect(field.description).toMatch(/expression<\/a>\.$/);
		}
	});
});

// With descriptionType 'auto', which is n8n's default, getToolDescriptionForNode builds the tool
// description from the operation's `action`. That makes `action` the only text a model reads, so
// the constraint that sinks a submitted job has to be in it. Verified against n8n's own MCP
// server, which reports the base description and never the usableAsTool replacement.
describe('the submit actions carry the constraint a model must not miss', () => {
	const operations = nodeProperties.filter((property) => property.name === 'operation');
	const submits = operations
		.flatMap((property) => (property.options ?? []) as Array<{ value: string; action?: string }>)
		.filter((option) => option.value.startsWith('submit'));

	it('names all three submit operations', () => {
		expect(submits.map((option) => option.value).sort()).toEqual([
			'submitEstimator',
			'submitNoiseLearner',
			'submitSampler',
		]);
	});

	it('says the circuit must already be transpiled', () => {
		for (const option of submits) {
			expect(option.action).toMatch(/transpiled ISA circuit/);
		}
	});
});

// The credential dialog's "Read our docs" link comes from the credential class, while the node
// panel's link comes from the codex. They pointed at different pages, so a user got IBM's general
// guides index, which documents none of these four fields.
describe('the credential documentation links agree', () => {
	it('sends both the dialog and the codex to the same page', () => {
		const fromClass = new IbmQuantumApi().documentationUrl;
		const fromCodex = codexAction.resources.credentialDocumentation[0].url;
		expect(fromClass).toBe(fromCodex);
	});

	it('points at the section that lists the four fields', () => {
		expect(new IbmQuantumApi().documentationUrl).toMatch(/#credentials$/);
		expect(readme).toContain('### Credentials');
	});
});

describe('AI tool exposure', () => {
	// This text is the node panel blurb, not what a model reads. Two consumers were checked and
	// neither sees it: the AI Agent resolves `descriptionType: 'auto'` (n8n's default) through
	// getToolDescriptionForNode, which returns `<action> in IBM Quantum`; and n8n's own MCP server
	// reports the BASE description for every operation, confirmed live against the published
	// 0.4.1. What does reach a model is each parameter's own description, so the ISA constraint
	// is pinned there instead.
	it('keeps the tool blurb short, since a model never reads it', () => {
		const usableAsTool = new IbmQuantum().description.usableAsTool;
		expect(usableAsTool).toBeTruthy();
		const replacement = (usableAsTool as { replacements?: { description?: string } }).replacements;
		expect(replacement?.description).toMatch(/transpiled/i);
		expect((replacement?.description ?? '').length).toBeLessThan(160);
	});

	// The constraint a model must not miss, on the parameters it actually receives.
	it('states the transpilation constraint on the parameters a model is given', () => {
		const carriers = nodeProperties.filter((property) =>
			/does not transpile/i.test(property.description ?? ''),
		);
		expect(carriers.map((property) => property.name)).toEqual(expect.arrayContaining(['backend']));
	});

	it('keeps both triggers out of the tool picker, which the verification ruleset requires', () => {
		expect(new IbmQuantumTrigger().description.usableAsTool).toBeUndefined();
		expect(new IbmQuantumErrorTrigger().description.usableAsTool).toBeUndefined();
	});

	it('supports node version 2 by default while still loading version 1', () => {
		const description = new IbmQuantum().description;
		expect(description.version).toEqual([1, 2]);
		expect(description.defaultVersion).toBe(2);
	});
});

// descriptions.ts is 1000 lines of hand-written UI text that neither the type checker nor the lint
// rules read. These pin the properties that silently drift.
describe('the UI text stays consistent with the operations it names', () => {
	const allText = nodeProperties
		.flatMap((property) => [
			property.displayName,
			property.description ?? '',
			property.placeholder ?? '',
			...(
				(property.options ?? []) as Array<{ name?: string; description?: string; action?: string }>
			).flatMap((option) => [option.name ?? '', option.description ?? '', option.action ?? '']),
		])
		.join('\n');

	// The three listing operations were renamed to "Get Many"; prose that still says "List" sends
	// the reader looking for an operation that is no longer in the dropdown.
	it('never refers to a listing operation by its old name', () => {
		expect(allText).not.toMatch(/\b(Job|Backend|Workload) List\b/);
		expect(allText).not.toMatch(/\bList operation\b/);
		expect(allText).not.toMatch(/\bList Tags\b/);
	});

	it('gives every operation option a name, a value, an action and a description', () => {
		for (const property of nodeProperties) {
			if (property.name !== 'operation') continue;
			for (const option of (property.options ?? []) as Array<Record<string, unknown>>) {
				expect(option.name, `${String(option.value)} name`).toBeTruthy();
				expect(option.value, `${String(option.name)} value`).toBeTruthy();
				expect(option.action, `${String(option.value)} action`).toBeTruthy();
				expect(option.description, `${String(option.value)} description`).toBeTruthy();
			}
		}
	});

	// n8n's UX guidelines ask for examples to read as examples.
	it('prefixes every example placeholder with "e.g."', () => {
		const BUTTON_LABELS = new Set(['Add Filter', 'Add Gate', 'Add Option']);
		const check = (properties: typeof nodeProperties) => {
			for (const property of properties) {
				const placeholder = property.placeholder;
				if (placeholder && !BUTTON_LABELS.has(placeholder)) {
					expect(placeholder, `${property.name} placeholder`).toMatch(/^e\.g\. /);
				}
				const nested = (property.options ?? []) as unknown[];
				const collectionFields = nested.filter(
					(entry): entry is { placeholder?: string; name?: string } =>
						typeof entry === 'object' && entry !== null && 'name' in entry,
				);
				for (const field of collectionFields) {
					if (field.placeholder && !BUTTON_LABELS.has(field.placeholder)) {
						expect(field.placeholder, `${String(field.name)} placeholder`).toMatch(/^e\.g\. /);
					}
				}
			}
		};
		check(nodeProperties);
	});
});

describe('the consolidated trigger', () => {
	const trigger = new IbmQuantumTrigger().description;
	const errorTrigger = new IbmQuantumErrorTrigger().description;
	const triggerOn = trigger.properties.find((p) => p.name === 'statusFilter');

	// n8n builds the Triggers list from a property named Event, Events or Trigger On. Anything
	// else makes it fall back to a single unnamed placeholder entry.
	it('labels the event property so n8n lists each option in the panel', () => {
		expect(triggerOn?.displayName).toBe('Trigger On');
		expect(errorTrigger.properties.find((p) => p.name === 'errorFilter')?.displayName).toBe(
			'Trigger On',
		);
	});

	it('offers the combined failure option that replaced the error trigger', () => {
		const values = (triggerOn?.options ?? []).map((o) => (o as { value: string }).value);
		expect(values).toContain('failedOrCanceled');
		expect(values).toEqual(['any', 'canceled', 'completed', 'failed', 'failedOrCanceled']);
	});

	// Hidden, never deleted: saved workflows still resolve the type and keep polling.
	it('retires the error trigger without unregistering it', () => {
		expect(errorTrigger.hidden).toBe(true);
		expect(errorTrigger.name).toBe('ibmQuantumErrorTrigger');
		expect(PACKAGE.n8n.nodes).toContain('dist/nodes/IbmQuantum/IbmQuantumErrorTrigger.node.js');
	});

	// n8n renders each entry as `action ?? 'On ' + noCase(name)`, and noCase flattens the
	// parenthesised list into a run-on phrase, so the catch-all option sets its label explicitly.
	it('gives the catch-all option a short panel label', () => {
		const options = (triggerOn?.options ?? []) as Array<{ value: string; action?: string }>;
		const any = options.find((o) => o.value === 'any');
		expect(any?.action).toBe('On any terminal state');
		for (const option of options.filter((o) => o.value !== 'any')) {
			expect(option.action).toBeUndefined();
		}
	});

	// The subtitle renders the stored value on the canvas, so a value that is not plain lowercase
	// leaks camelCase into the UI unless the subtitle spells it out.
	it('never shows a raw camelCase value on the canvas', () => {
		const subtitle = String(trigger.subtitle);
		for (const option of (triggerOn?.options ?? []) as Array<{ value: string }>) {
			if (/^[a-z]+$/.test(option.value)) continue;
			expect(subtitle).toContain(option.value);
			expect(subtitle).toContain('failed or canceled');
		}
	});

	it('keeps the retired trigger findable through the main trigger aliases', () => {
		expect(codexTrigger.alias).toEqual(expect.arrayContaining(['Error', 'Failed', 'Canceled']));
	});
});
