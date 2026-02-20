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

			// Rules from strictTypeChecked that are new in @abinnovision/eslint-config-base v3.
			// The codebase uses `any` extensively (~3500 usages); these rules are not
			// practical to enforce without a large-scale retyping effort.
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-redundant-type-constituents": "off",
			"@typescript-eslint/no-duplicate-type-constituents": "off",
			"@typescript-eslint/restrict-template-expressions": "off",
			"@typescript-eslint/restrict-plus-operands": "off",
			"@typescript-eslint/no-base-to-string": "off",
			"@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
			"@typescript-eslint/no-confusing-void-expression": "off",
			"@typescript-eslint/no-unnecessary-type-parameters": "off",
			"@typescript-eslint/no-unnecessary-condition": "off",
			"@typescript-eslint/no-misused-promises": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/no-unnecessary-type-assertion": "off",
			"@typescript-eslint/no-unnecessary-type-conversion": "off",
			"@typescript-eslint/no-unnecessary-template-expression": "off",
			"@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
			"@typescript-eslint/prefer-reduce-type-parameter": "off",
			"@typescript-eslint/unbound-method": "off",
			"@typescript-eslint/no-deprecated": "off",
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/await-thenable": "off",
			"@typescript-eslint/no-extraneous-class": "off",
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
