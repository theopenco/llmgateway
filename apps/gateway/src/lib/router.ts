import { OpenAPIHono } from "@hono/zod-openapi";

import type { Env } from "hono";

/**
 * zod 4's ZodError serializes to `{ name, message }` only, so zod-openapi's
 * stock 400 body lost the `issues` array clients parse. Restore the
 * pre-zod-4 envelope: `{ success: false, error: { name, issues } }`.
 * Endpoints with their own error envelope set an explicit `defaultHook`
 * instead of using this factory.
 */
export function createRouter<E extends Env>(): OpenAPIHono<E> {
	return new OpenAPIHono<E>({
		defaultHook: (result, c) => {
			if (result.success) {
				return undefined;
			}
			return c.json(
				{
					success: false,
					error: { name: "ZodError", issues: result.error.issues },
				},
				400,
			);
		},
	});
}
