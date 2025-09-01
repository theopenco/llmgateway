import lint from "@steebchen/lint-next";

/** @type {import("eslint").Linter.Config[]} */
export default [
	...lint,
	{
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
			"**/.source/",
			"**/.output/",
			"**/.conductor/",
			"**/out/",
			"**/.content-collections/",
		],
	},
];
