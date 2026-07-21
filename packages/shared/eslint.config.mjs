import lint from "../../eslint.config.mjs";

/** @type {import("eslint").Linter.Config[]} */
export default [
	...lint,
	{
		// The models directory UI was moved from apps/ui, where console
		// logging is allowed; keep its original error-logging behavior.
		files: ["src/components/models-directory/**"],
		rules: {
			"no-console": "off",
		},
	},
];
