import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { n8nCommunityNodesPlugin } from '@n8n/eslint-plugin-community-nodes';
import n8nNodesBase from 'eslint-plugin-n8n-nodes-base';

// Mirrors the config the official verification scanner builds (buildScanConfig in
// @n8n/scan-community-package), so the rules and their severities are the ones the gate applies.
// The `lint` script then goes one step further and passes --max-warnings 0. Seven of these rules
// ship as `warn` rather than `error`, among them no-dead-files, resource-operation-pattern and
// node-registration-complete, and the scanner's verdict is errorCount alone. Without the flag
// eslint exits 0 on a warning, so a deletion that orphaned a file, or a resource shape the plugin
// dislikes, would pass CI green and only ever be seen by a human reviewer.
// Three things are easy to miss, and were missing before:
//   - the scanner also applies eslint-plugin-n8n-nodes-base (community, credentials and
//     nodes rulesets), not only @n8n/eslint-plugin-community-nodes;
//   - about a dozen community-nodes rules run only against package.json, which needs the
//     TypeScript parser because they walk a TSESTree ObjectExpression;
//   - it adds no-console as an error with no files key, so it covers every file it reads, and it
//     reads more than the TypeScript sources: `covered` below is its own source glob verbatim,
//     which takes in the codex .node.json files, plus the index.js its tarball leg lints.
// The community-nodes ruleset covers the tests as well as the code that ships. The scanner reads
// package.json and {nodes,credentials} on its source leg and the published tarball on the other,
// so it never sees a test; the rules it applies to shipped code cost nothing on tests and catch a
// restricted import there rather than nowhere. It stays off scripts/: its no-restricted-globals
// bans `process` and `setTimeout`, and no-console would ban the output, all of which the QA
// harness needs. What the gate reads and this config does not is the rest of that tarball leg,
// the compiled dist/**/*.js: tsc writes it from the sources linted here, and reading it would tie
// the lint to a build CI runs after it. tests/ gets the eslint and typescript-eslint recommended
// sets on top, scripts/ the eslint recommended set alone. Nothing here names vitest.config.mts,
// the one TypeScript file outside nodes/, credentials/ and tests/, so it is linted by nothing.
const covered = [
	'package.json',
	'index.js',
	'{nodes,credentials}/**/*.{js,ts,json}',
	'tests/**/*.ts',
];

export default tseslint.config(
	{
		// n8n-node lint runs `eslint .`, which walks the generated coverage report after a local
		// test:coverage run; the lint script names its paths and never saw it.
		ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'eslint.config.mjs'],
	},
	{
		...n8nCommunityNodesPlugin.configs.recommended,
		files: covered,
	},
	{ files: covered, rules: { 'no-console': 'error' } },
	{ plugins: { 'n8n-nodes-base': n8nNodesBase } },
	{
		files: ['package.json'],
		rules: { ...n8nNodesBase.configs.community.rules },
	},
	{
		files: ['package.json', '{nodes,credentials}/**/*.json'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { extraFileExtensions: ['.json'] },
		},
	},
	{
		files: ['nodes/**/*.ts', 'credentials/**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['credentials/**/*.ts'],
		rules: {
			...n8nNodesBase.configs.credentials.rules,
			// Not valid for community nodes.
			'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
			// The community-nodes credential-password-field rule is more accurate.
			'n8n-nodes-base/cred-class-field-type-options-password-missing': 'off',
		},
	},
	{
		files: ['nodes/**/*.ts'],
		rules: {
			...n8nNodesBase.configs.nodes.rules,
			// Inputs and outputs use the NodeConnectionTypes enum, not the "main" string.
			'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
			'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
			// IBM does cap GET /jobs at 200, so maxValue is meaningful here.
			'n8n-nodes-base/node-param-type-options-max-value-present': 'off',
		},
	},
	{
		files: ['tests/**/*.ts'],
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
	},
	{
		files: ['scripts/**/*.mjs'],
		extends: [js.configs.recommended],
		languageOptions: { globals: globals.nodeBuiltin },
	},
);
