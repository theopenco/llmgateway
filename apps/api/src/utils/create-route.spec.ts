import { z } from "@hono/zod-openapi";
import { describe, expect, test } from "vitest";
import { z as plainZod } from "zod";

import { createRoute } from "@/utils/create-route.js";

function route(schema: z.ZodType, required?: boolean) {
	return createRoute({
		method: "post",
		path: "/",
		request: {
			body: {
				content: { "application/json": { schema } },
				...(required !== undefined ? { required } : {}),
			},
		},
		responses: { 200: { description: "ok" } },
	});
}

describe("createRoute", () => {
	test.each([
		["an object with a required field", z.object({ name: z.string() })],
		["a plain zod schema", plainZod.object({ name: plainZod.string() })],
		[
			"a union without an empty branch",
			z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
		],
	])("requires a JSON body for %s", (_label, schema) => {
		expect(route(schema).request.body.required).toBe(true);
	});

	test.each([
		["optional fields", z.object({ name: z.string().optional() })],
		["defaulted fields", z.object({ name: z.string().default("x") })],
	])("leaves a body with only %s optional", (_label, schema) => {
		expect(route(schema).request.body.required).toBeUndefined();
	});

	test("keeps an explicit required flag", () => {
		const r = route(z.object({ name: z.string() }), false);
		expect(r.request.body.required).toBe(false);
	});

	test("keeps the routing path helper", () => {
		const r = createRoute({
			method: "get",
			path: "/items/{id}",
			responses: { 200: { description: "ok" } },
		});
		expect(r.getRoutingPath()).toBe("/items/:id");
	});
});
