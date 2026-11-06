import lint from "../../eslint.config.mjs";

/** @type {import("eslint").Linter.Config[]} */
export default [
	...lint,
	{
		files: ["integration/**/*.ts"],
		languageOptions: {
			parserOptions: { project: "./tsconfig.integration.json" },
		},
	},
];
