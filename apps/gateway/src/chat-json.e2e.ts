import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	streamingJsonOutputModels,
	streamingJsonSchemaOutputModels,
	testModels,
} from "@/chat-helpers.e2e.js";
import { readAll } from "@/test-utils/test-helpers.js";

import type { ProviderModelMapping } from "@llmgateway/models";

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(
		testModels.filter((m) => {
			// Check if any provider for this model supports jsonOutput
			return m.providers.some(
				(provider) => (provider as ProviderModelMapping).jsonOutput === true,
			);
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
		expect(parsedContent).toHaveProperty("message");
	});

	test.each(
		testModels.filter((m) => {
			// Check if any provider for this model supports jsonOutputSchema
			// Note: Some providers (like Anthropic) support json_schema without json_object mode
			return m.providers.some(
				(provider) =>
					(provider as ProviderModelMapping).jsonOutputSchema === true,
			);
		}),
	)("JSON schema output $model", getTestOptions(), async ({ model }) => {
		// Define the Zod schema that matches our JSON schema payload
		const weatherResponseSchema = z
			.object({
				location: z.string(),
				temperature: z.string(),
				conditions: z.string(),
			})
			.strict(); // strict() ensures no additional properties

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

		// Validate the parsed content matches the exact schema using Zod
		const validationResult = weatherResponseSchema.safeParse(parsedContent);
		if (!validationResult.success) {
			console.error(
				"Schema validation failed:",
				JSON.stringify(validationResult.error.format(), null, 2),
			);
			console.error(
				"Received content:",
				JSON.stringify(parsedContent, null, 2),
			);
		}
		expect(validationResult.success).toBe(true);

		// Additional type-safe assertions after validation
		if (validationResult.success) {
			const data = validationResult.data;
			expect(typeof data.location).toBe("string");
			expect(typeof data.temperature).toBe("string");
			expect(typeof data.conditions).toBe("string");
			expect(data.location.length).toBeGreaterThan(0);
			expect(data.temperature.length).toBeGreaterThan(0);
			expect(data.conditions.length).toBeGreaterThan(0);
		}
	});

	test.each(streamingJsonOutputModels)(
		"JSON output streaming $model",
		getTestOptions(),
		async ({ model }) => {
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
					stream: true,
				}),
			});

			if (res.status !== 200) {
				console.log("response:", await res.text());
				throw new Error(`Request failed with status ${res.status}`);
			}

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");

			const streamResult = await readAll(res.body);
			if (logMode) {
				console.log("streamResult", JSON.stringify(streamResult, null, 2));
			}

			expect(streamResult.hasValidSSE).toBe(true);
			expect(streamResult.eventCount).toBeGreaterThan(0);
			expect(streamResult.hasContent).toBe(true);
			expect(streamResult.hasOpenAIFormat).toBe(true);

			// Collect all content from the stream
			const contentChunks = streamResult.chunks
				.filter((chunk) => chunk.choices?.[0]?.delta?.content)
				.map((chunk) => chunk.choices[0].delta.content);
			const fullContent = contentChunks.join("");

			// Validate that the streamed content is valid JSON
			expect(() => JSON.parse(fullContent)).not.toThrow();
			const parsedContent = JSON.parse(fullContent);
			expect(parsedContent).toHaveProperty("message");
		},
	);

	test.each(streamingJsonSchemaOutputModels)(
		"JSON schema output streaming $model",
		getTestOptions(),
		async ({ model }) => {
			// Define the Zod schema that matches our JSON schema payload
			const weatherResponseSchema = z
				.object({
					location: z.string(),
					temperature: z.string(),
					conditions: z.string(),
				})
				.strict();

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
					stream: true,
				}),
			});

			if (res.status !== 200) {
				console.log("response:", await res.text());
				throw new Error(`Request failed with status ${res.status}`);
			}

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");

			const streamResult = await readAll(res.body);
			if (logMode) {
				console.log(
					"json_schema streaming",
					JSON.stringify(streamResult, null, 2),
				);
			}

			expect(streamResult.hasValidSSE).toBe(true);
			expect(streamResult.eventCount).toBeGreaterThan(0);
			expect(streamResult.hasContent).toBe(true);
			expect(streamResult.hasOpenAIFormat).toBe(true);

			// Collect all content from the stream
			const contentChunks = streamResult.chunks
				.filter((chunk) => chunk.choices?.[0]?.delta?.content)
				.map((chunk) => chunk.choices[0].delta.content);
			const fullContent = contentChunks.join("");

			// Validate that the streamed content is valid JSON
			expect(() => JSON.parse(fullContent)).not.toThrow();
			const parsedContent = JSON.parse(fullContent);

			// Validate the parsed content matches the exact schema using Zod
			const validationResult = weatherResponseSchema.safeParse(parsedContent);
			if (!validationResult.success) {
				console.error(
					"Schema validation failed:",
					JSON.stringify(validationResult.error.format(), null, 2),
				);
				console.error(
					"Received content:",
					JSON.stringify(parsedContent, null, 2),
				);
			}
			expect(validationResult.success).toBe(true);

			// Additional type-safe assertions after validation
			if (validationResult.success) {
				const data = validationResult.data;
				expect(typeof data.location).toBe("string");
				expect(typeof data.temperature).toBe("string");
				expect(typeof data.conditions).toBe("string");
				expect(data.location.length).toBeGreaterThan(0);
				expect(data.temperature.length).toBeGreaterThan(0);
				expect(data.conditions.length).toBeGreaterThan(0);
			}
		},
	);
});
