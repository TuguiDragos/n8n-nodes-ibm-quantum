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
// Two things are easy to miss, and were missing before:
//   - the scanner also applies eslint-plugin-n8n-nodes-base (community, credentials and
//     nodes rulesets), not only @n8n/eslint-plugin-community-nodes;
//   - about a dozen community-nodes rules run only against package.json, which needs the
//     TypeScript parser because they walk a TSESTree ObjectExpression.
export default tseslint.config(
	{
		ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'eslint.config.mjs', 'index.js'],
	},
	n8nCommunityNodesPlugin.configs.recommended,
	{ plugins: { 'n8n-nodes-base': n8nNodesBase } },
	{
		files: ['package.json'],
		rules: { ...n8nNodesBase.configs.community.rules },
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
);
