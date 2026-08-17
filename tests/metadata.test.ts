import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { IbmQuantumApi } from '../credentials/IbmQuantumApi.credentials';
import { nodeProperties } from '../nodes/IbmQuantum/descriptions';
import { IbmQuantum } from '../nodes/IbmQuantum/IbmQuantum.node';
import { IbmQuantumErrorTrigger } from '../nodes/IbmQuantum/IbmQuantumErrorTrigger.node';
import { IbmQuantumTrigger } from '../nodes/IbmQuantum/IbmQuantumTrigger.node';

const PACKAGE = JSON.parse(readFileSync('package.json', 'utf8')) as {
	name: string;
	n8n: { nodes: string[]; credentials: string[] };
};

const NODES = [new IbmQuantum(), new IbmQuantumTrigger(), new IbmQuantumErrorTrigger()];

describe('package registration', () => {
	it('registers every node class it ships, and the credential', () => {
		for (const node of NODES) {
			const file = `dist/nodes/IbmQuantum/${node.constructor.name}.node.js`;
			expect(PACKAGE.n8n.nodes).toContain(file);
		}
		expect(PACKAGE.n8n.nodes).toHaveLength(NODES.length);
		expect(PACKAGE.n8n.credentials).toContain(
			'dist/credentials/IbmQuantumApi.credentials.js',
		);
	});

	it('names the credential the nodes ask for', () => {
		const credentialName = new IbmQuantumApi().name;
		for (const node of NODES) {
			expect(node.description.credentials?.[0].name).toBe(credentialName);
		}
	});
});

describe('codex files', () => {
	// The build copies these into dist; if one drifts from its node name n8n silently ignores it,
	// so the picker category, search aliases and docs links disappear without any error.
	it.each(NODES.map((node) => [node.constructor.name, node] as const))(
		'%s has a codex naming its own node type',
		(className, node) => {
			const codex = JSON.parse(
				readFileSync(`nodes/IbmQuantum/${className}.node.json`, 'utf8'),
			) as { node: string; categories: string[]; alias: string[]; resources: unknown };
			expect(codex.node).toBe(`${PACKAGE.name}.${node.description.name}`);
			expect(codex.categories.length).toBeGreaterThan(0);
			expect(codex.alias.length).toBeGreaterThan(0);
			expect(codex.resources).toBeTruthy();
		},
	);
});

describe('documented surface', () => {
	// The operation count appears in README.md and llms.txt. Both are written by hand, so this
	// pins the real figure: if you add an operation, update the prose the failure points at.
	const EXPECTED = { account: 9, backend: 6, circuit: 2, job: 12, session: 4, workload: 1 };

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
		expect(total).toBe(34);

		// The same figure is written out in three places by hand. Pin all of them, because a count
		// that drifts in prose is the kind of error no other test would ever catch.
		expect(readFileSync('llms.txt', 'utf8')).toContain(`${total} operations`);
		expect(readFileSync('README.md', 'utf8')).toContain(
			`${total} operations across ${Object.keys(EXPECTED).length} resources`,
		);
		expect(readFileSync('CHANGELOG.md', 'utf8')).toContain(`${total} operations`);
	});
});

describe('AI tool exposure', () => {
	it('offers the action node as a tool, with a description written for an agent', () => {
		const usableAsTool = new IbmQuantum().description.usableAsTool;
		expect(usableAsTool).toBeTruthy();
		const replacement = (usableAsTool as { replacements?: { description?: string } }).replacements;
		expect(replacement?.description).toMatch(/transpiled/i);

		// n8n's MCP server gives a model the parameter definitions and nothing else: neither
		// documentationUrl nor the codex resources reach it. A reference is therefore only
		// reachable from description text, which is why the URL lives here.
		expect(replacement?.description).toContain('llms-full.txt');
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
