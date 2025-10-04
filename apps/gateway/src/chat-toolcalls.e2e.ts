import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	toolCallModels,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(toolCallModels)(
		"tool calls $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{
							role: "system",
							content:
								"You are a weather assistant that can get weather information for cities.",
						},
						{
							role: "user",
							content: "What's the weather like in San Francisco?",
						},
					],
					tools: [
						{
							type: "function",
							function: {
								name: "get_weather",
								description: "Get the current weather for a given city",
								parameters: {
									type: "object",
									properties: {
										city: {
											type: "string",
											description: "The city name to get weather for",
										},
										unit: {
											type: "string",
											enum: ["celsius", "fahrenheit"],
											description: "Temperature unit",
											default: "fahrenheit",
										},
									},
									required: ["city"],
								},
							},
						},
					],
					tool_choice: "auto",
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("tool calls response:", JSON.stringify(json, null, 2));
			}

			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices");
			expect(json.choices).toHaveLength(1);
			expect(json.choices[0]).toHaveProperty("message");

			const message = json.choices[0].message;
			expect(message).toHaveProperty("role", "assistant");

			// Should have tool calls since we're asking about weather
			expect(message).toHaveProperty("tool_calls");
			expect(Array.isArray(message.tool_calls)).toBe(true);
			expect(message.tool_calls.length).toBeGreaterThan(0);

			// Validate tool call structure
			const toolCall = message.tool_calls[0];
			expect(toolCall).toHaveProperty("id");
			expect(toolCall).toHaveProperty("type", "function");
			expect(toolCall).toHaveProperty("function");
			expect(toolCall.function).toHaveProperty("name", "get_weather");
			expect(toolCall.function).toHaveProperty("arguments");

			// Parse and validate arguments
			const args = JSON.parse(toolCall.function.arguments);
			expect(args).toHaveProperty("city");
			expect(typeof args.city).toBe("string");
			expect(args.city.toLowerCase()).toContain("san francisco");

			// Check finish reason
			expect(json.choices[0]).toHaveProperty("finish_reason", "tool_calls");

			// Validate logs
			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);

			// Validate usage
			expect(json).toHaveProperty("usage");
			expect(json.usage).toHaveProperty("prompt_tokens");
			expect(json.usage).toHaveProperty("completion_tokens");
			expect(json.usage).toHaveProperty("total_tokens");
			expect(typeof json.usage.prompt_tokens).toBe("number");
			expect(typeof json.usage.completion_tokens).toBe("number");
			expect(typeof json.usage.total_tokens).toBe("number");
			expect(json.usage.prompt_tokens).toBeGreaterThan(0);
			expect(json.usage.completion_tokens).toBeGreaterThan(0);
			expect(json.usage.total_tokens).toBeGreaterThan(0);
		},
	);
});
