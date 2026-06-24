import tseslint from 'typescript-eslint';
import { n8nCommunityNodesPlugin } from '@n8n/eslint-plugin-community-nodes';

export default tseslint.config(
	{
		ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'eslint.config.mjs', 'index.js'],
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
	n8nCommunityNodesPlugin.configs.recommended,
);
