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
		"tool calls res $model",
		getTestOptions(),
		async ({ model }) => {
			// STEP 1: Make initial request to get tool calls
			const requestId1 = generateTestRequestId();
			const initialRes = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId1,
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

			const initialJson = await initialRes.json();
			if (logMode) {
				console.log(
					"Initial tool calls response:",
					JSON.stringify(initialJson, null, 2),
				);
			}

			// Verify initial response has tool calls
			expect(initialRes.status).toBe(200);
			expect(initialJson).toHaveProperty("choices");
			expect(initialJson.choices[0].message).toHaveProperty("tool_calls");
			expect(initialJson.choices[0].message.tool_calls.length).toBeGreaterThan(
				0,
			);

			const toolCalls = initialJson.choices[0].message.tool_calls;
			const assistantMessage = initialJson.choices[0].message;

			// STEP 2: Send tool results back
			const requestId2 = generateTestRequestId();
			const followupRes = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId2,
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
						{
							role: "assistant",
							content: assistantMessage.content ?? "",
							tool_calls: toolCalls,
						},
						...toolCalls.map((tc: any) => ({
							role: "tool",
							content: JSON.stringify({
								city: "San Francisco",
								temperature: 72,
								unit: "fahrenheit",
								condition: "Sunny",
							}),
							tool_call_id: tc.id,
						})),
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

			const followupJson = await followupRes.json();
			if (logMode) {
				console.log(
					"Tool calls result response:",
					JSON.stringify(followupJson, null, 2),
				);
			}

			// Log error response if status is not 200
			if (followupRes.status !== 200) {
				console.log(
					`Error ${followupRes.status} - tool calls with result response:`,
					JSON.stringify(followupJson, null, 2),
				);
			}

			expect(followupRes.status).toBe(200);
			expect(followupJson).toHaveProperty("choices");
			expect(followupJson.choices).toHaveLength(1);
			expect(followupJson.choices[0]).toHaveProperty("message");

			const message = followupJson.choices[0].message;
			expect(message).toHaveProperty("role", "assistant");

			// Should have proper content (not empty) as a response to the tool call
			expect(message).toHaveProperty("content");
			// verify either content is string or tool_calls is present
			expect(message.content ?? message.tool_calls).toBeTruthy();

			// Validate logs
			const log = await validateLogByRequestId(requestId2);
			expect(log.streamed).toBe(false);

			// Validate usage
			expect(followupJson).toHaveProperty("usage");
			expect(followupJson.usage).toHaveProperty("prompt_tokens");
			expect(followupJson.usage).toHaveProperty("completion_tokens");
			expect(followupJson.usage).toHaveProperty("total_tokens");
			expect(typeof followupJson.usage.prompt_tokens).toBe("number");
			expect(typeof followupJson.usage.completion_tokens).toBe("number");
			expect(typeof followupJson.usage.total_tokens).toBe("number");
			expect(followupJson.usage.prompt_tokens).toBeGreaterThan(0);
			expect(followupJson.usage.completion_tokens).toBeGreaterThan(0);
			expect(followupJson.usage.total_tokens).toBeGreaterThan(0);
		},
	);
});
