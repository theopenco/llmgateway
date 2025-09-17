import lint from "../../eslint.config.mjs";
import react from "@abinnovision/eslint-config-react";
import noRelativeImportPathsPlugin from "eslint-plugin-no-relative-import-paths";

/** @type {import("eslint").Linter.Config[]} */
export default [
	...lint,
	...react,
	{
		rules: {
			"no-console": "off",
			"react/no-unescaped-entities": "off",
		},
	},
	{
		ignores: ["**/v1.d.ts"],
	},
];
