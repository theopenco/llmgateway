import lint from "../../eslint.config.mjs";
import { react } from "@abinnovision/eslint-config-react";
import typescriptParser from "@typescript-eslint/parser";

export default [
	{
		ignores: [
			"ios/**",
			"build/**",
			"artifacts/**",
			"coverage/**",
			"**/v1.d.ts",
			"**/gateway.d.ts",
		],
	},
	...lint,
	...react,
	{
		files: ["e2e/**/*.{ts,mts}"],
		languageOptions: {
			parser: typescriptParser,
			parserOptions: { project: "./e2e/tsconfig.json" },
		},
	},
	{ rules: { "@eslint-react/no-unstable-context-value": "off" } },
];
