import lint from "@steebchen/lint-base";
import importPlugin from "eslint-plugin-import";
import noRelativeImportPathsPlugin from "eslint-plugin-no-relative-import-paths";

/** @type {import("eslint").Linter.Config[]} */
export default [
	...lint,
	{
		plugins: {
			import: importPlugin,
			"no-relative-import-paths": noRelativeImportPathsPlugin,
		},
		settings: {
			"import/resolver": {
				typescript: {
					alwaysTryTypes: true,
					project: [
						"./tsconfig.json",
						"./apps/*/tsconfig.json",
						"./packages/*/tsconfig.json",
					],
				},
			},
		},
		rules: {
			"@typescript-eslint/consistent-type-assertions": "off",
			"@typescript-eslint/triple-slash-reference": "off",
			"max-nested-callbacks": "off",
			complexity: "off",
			"max-depth": "off",
			"max-params": "off",
			"no-console": "error",
			"no-unused-vars": [
				"error",
				{
					vars: "all",
					args: "none",
					ignoreRestSiblings: false,
					varsIgnorePattern: "^_",
					argsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
			"import/no-useless-path-segments": [
				"error",
				{
					noUselessIndex: false,
				},
			],
			"import/order": [
				"error",
				{
					groups: [
						["builtin"],
						["external"],
						// Internals
						["internal", "unknown", "parent", "sibling", "index"],
						// Types
						["object", "type"],
					],
					"newlines-between": "always",
					alphabetize: { order: "asc", caseInsensitive: true },
					warnOnUnassignedImports: true,
					pathGroups: [
						{
							pattern: "^\\u0000",
							group: "builtin",
							position: "before",
						},
						{
							pattern: "@/**",
							group: "internal",
							position: "before",
						},
						{
							pattern: "@llmgateway/**",
							group: "internal",
							position: "before",
						},
					],
					pathGroupsExcludedImportTypes: ["builtin", "type"],
				},
			],
			"no-relative-import-paths/no-relative-import-paths": [
				"error",
				{
					allowSameFolder: true,
					prefix: "@",
					rootDir: "./src",
				},
			],
		},
	},
	{
		files: [
			"**/*.spec.ts",
			"**/*.spec.tsx",
			"**/*.test.ts",
			"**/*.test.tsx",
			"**/*.e2e.ts",
			"**/test-utils/**",
			"apps/ui/**",
			"apps/docs/**",
		],
		rules: {
			"no-console": "off",
		},
	},
	{
		ignores: [
			"**/.tanstack/",
			"**/.next/",
			"**/.next-dev/",
			"**/.source/",
			"**/.output/",
			"**/.conductor/",
			"**/out/",
			"**/.content-collections/",
		],
	},
];
