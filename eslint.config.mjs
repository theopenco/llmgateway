import lint from "@steebchen/lint-next";
import importPlugin from "eslint-plugin-import";

/** @type {import("eslint").Linter.Config[]} */
export default [
	...lint,
	{
		plugins: {
			import: importPlugin,
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
					noUselessIndex: true,
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
	// {
	// 	files: ["**/*.{ts,tsx}"],
	// 	rules: {
	// 		"import/no-relative-parent-imports": "error",
	// 	},
	// },
	{
		ignores: [
			"**/.tanstack/",
			"**/.next/",
			"**/.source/",
			"**/.output/",
			"**/.conductor/",
			"**/out/",
			"**/.content-collections/",
		],
	},
];
