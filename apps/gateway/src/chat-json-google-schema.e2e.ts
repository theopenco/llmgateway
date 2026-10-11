import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	getConcurrentTestOptions,
	getTestOptions,
	jsonSchemaOutputModels,
	logMode,
} from "@/chat-helpers.e2e.js";

// Google's two transports take schemas differently: AI Studio gets raw JSON
// Schema (responseJsonSchema), Vertex the converted OpenAPI subset
// (responseSchema). This sample covers the shapes either path has dropped:
// nullable and multi-member unions, $ref/$defs, arrays of refs, a
// single-member allOf around a ref (pydantic <= 2.8) and a recursive model.
const googleSchemaModels = jsonSchemaOutputModels.filter(
	({ model }) =>
		model.startsWith("google-ai-studio/") || model.startsWith("google-vertex/"),
);

const addressSchema = z.object({ city: z.string() });
const personSchema = z.object({ name: z.string() }).passthrough();

const sampleOutputSchema = z.object({
	nickname: z.string().nullable(),
	id: z.union([z.string(), z.number()]),
	address: addressSchema,
	previous: z.array(addressSchema),
	shipping: addressSchema,
	manager: personSchema.nullable(),
});

function createGoogleSchemaSampleRequest(model: string) {
	return {
		model,
		messages: [
			{ role: "system", content: "Extract the user record as JSON." },
			{
				role: "user",
				content:
					"User u-42 has no nickname, lives in Paris, previously lived in Berlin and Rome, ships to a warehouse in Porto, and is managed by Alice, who manages Bob.",
			},
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "user_record",
				schema: {
					type: "object",
					properties: {
						nickname: { anyOf: [{ type: "string" }, { type: "null" }] },
						id: { anyOf: [{ type: "string" }, { type: "integer" }] },
						address: { $ref: "#/$defs/Address" },
						previous: { type: "array", items: { $ref: "#/$defs/Address" } },
						shipping: {
							allOf: [{ $ref: "#/$defs/Address" }],
							description: "Shipping address",
						},
						manager: {
							anyOf: [{ $ref: "#/$defs/Person" }, { type: "null" }],
						},
					},
					required: [
						"nickname",
						"id",
						"address",
						"previous",
						"shipping",
						"manager",
					],
					$defs: {
						Address: {
							type: "object",
							properties: { city: { type: "string" } },
							required: ["city"],
						},
						Person: {
							type: "object",
							properties: {
								name: { type: "string" },
								reports: { type: "array", items: { $ref: "#/$defs/Person" } },
							},
							required: ["name"],
						},
					},
				},
			},
		},
	};
}

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(googleSchemaModels)(
		"Google JSON schema unions and refs $model",
		getTestOptions(),
		async ({ model }) => {
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify(createGoogleSchemaSampleRequest(model)),
			});

			const json = await res.json();
			if (logMode) {
				console.log("google json_schema", JSON.stringify(json, null, 2));
			}
			expect(res.status).toBe(200);
			const content = json.choices[0].message.content;
			const result = sampleOutputSchema.safeParse(JSON.parse(content));
			if (!result.success) {
				console.error("Received content:", content);
			}
			expect(result.success).toBe(true);
		},
	);
});
