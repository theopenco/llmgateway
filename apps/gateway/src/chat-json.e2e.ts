import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { testModels } from "@/chat-helpers.e2e.js";
import {
	beforeAllHook,
	beforeEachHook,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
} from "@/chat-helpers.e2e.js";

import {
	type ModelDefinition,
	models,
	type ProviderModelMapping,
} from "@llmgateway/models";

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(
		testModels.filter((m) => {
			const modelDef = models.find((mo) => m.originalModel === mo.id);
			return (modelDef as ModelDefinition)?.jsonOutput === true;
		}),
	)("JSON output $model", getTestOptions(), async ({ model }) => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: model,
				messages: [
					{
						role: "system",
						content:
							"You are a helpful assistant. Always respond with valid JSON.",
					},
					{
						role: "user",
						content: 'Return a JSON object with "message": "Hello World"',
					},
				],
				response_format: { type: "json_object" },
			}),
		});

		const json = await res.json();
		if (logMode) {
			console.log("json", JSON.stringify(json, null, 2));
		}
		expect(res.status).toBe(200);
		expect(json).toHaveProperty("choices[0].message.content");
		const content = json.choices[0].message.content;
		expect(() => JSON.parse(content)).not.toThrow();

		const parsedContent = JSON.parse(content);
		// temporarily do not require this check for routeway-discounted models
		if (!model.includes("routeway-discount")) {
			expect(parsedContent).toHaveProperty("message");
		}
	});

	test.each(
		testModels.filter((m) => {
			const modelDef = models.find((mo) => m.originalModel === mo.id);
			if ((modelDef as ModelDefinition)?.jsonOutput !== true) {
				return false;
			}
			// Check if any provider for this model supports jsonOutputSchema and is not explicitly disabled
			return modelDef?.providers.some(
				(provider) =>
					(provider as ProviderModelMapping).jsonOutputSchema === true &&
					!(provider as ProviderModelMapping).disableJsonOutputSchema,
			);
		}),
	)("JSON schema output $model", getTestOptions(), async ({ model }) => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: model,
				messages: [
					{
						role: "system",
						content: "You are a helpful assistant.",
					},
					{
						role: "user",
						content: "What is the weather like today?",
					},
				],
				response_format: {
					type: "json_schema",
					json_schema: {
						name: "weather_response",
						description: "A response about the weather",
						schema: {
							type: "object",
							properties: {
								location: {
									type: "string",
									description: "The location for the weather",
								},
								temperature: {
									type: "string",
									description: "The temperature",
								},
								conditions: {
									type: "string",
									description: "The weather conditions",
								},
							},
							required: ["location", "temperature", "conditions"],
							additionalProperties: false,
						},
						strict: true,
					},
				},
			}),
		});

		const json = await res.json();
		if (logMode) {
			console.log("json_schema", JSON.stringify(json, null, 2));
		}
		expect(res.status).toBe(200);
		expect(json).toHaveProperty("choices[0].message.content");
		const content = json.choices[0].message.content;
		expect(() => JSON.parse(content)).not.toThrow();

		const parsedContent = JSON.parse(content);
		expect(parsedContent).toHaveProperty("location");
		expect(parsedContent).toHaveProperty("temperature");
		expect(parsedContent).toHaveProperty("conditions");
		expect(typeof parsedContent.location).toBe("string");
		expect(typeof parsedContent.temperature).toBe("string");
		expect(typeof parsedContent.conditions).toBe("string");
	});
});
