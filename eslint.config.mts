import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import importPlugin from "eslint-plugin-import";
import globals from "globals";
import { globalIgnores } from "eslint/config";


export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		plugins: {
			import: importPlugin,
		},
		rules: {
			"import/no-extraneous-dependencies": [
				"error",
				{ packageDir: import.meta.dirname },
			],
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
