import lint from "../../eslint.config.mjs";
import { react } from "@abinnovision/eslint-config-react";

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
	{ rules: { "@eslint-react/no-unstable-context-value": "off" } },
];
