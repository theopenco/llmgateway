import lint from "../../eslint.config.mjs";

/** @type {import("eslint").Linter.Config[]} */
export default [
	...lint,
	{
		files: ["src/**/*.ts"],
		ignores: ["src/utils/create-route.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "@hono/zod-openapi",
							importNames: ["createRoute"],
							message:
								"Use createRoute from @/utils/create-route.js so JSON bodies with required fields are validated.",
						},
					],
				},
			],
		},
	},
];
