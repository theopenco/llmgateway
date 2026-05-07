import lint from "../../eslint.config.mjs";
import { react } from "@abinnovision/eslint-config-react";

/** @type {import("eslint").Linter.Config[]} */
export default [
	...lint,
	...react,
	{
		rules: {
			"@eslint-react/hooks-extra/no-direct-set-state-in-use-effect": "off",
			"@eslint-react/no-array-index-key": "off",
			"@eslint-react/no-children-count": "off",
			"@eslint-react/no-children-map": "off",
			"@eslint-react/no-children-to-array": "off",
			"@eslint-react/no-unnecessary-use-callback": "off",
			"@eslint-react/no-unnecessary-use-memo": "off",
			"@eslint-react/no-unstable-context-value": "off",
			"@eslint-react/naming-convention/id-name": "off",
			"@eslint-react/naming-convention/ref-name": "off",
			"@eslint-react/naming-convention/use-state": "off",
			"@eslint-react/prefer-use-state-lazy-initialization": "off",
		},
	},
];
