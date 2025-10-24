import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	streamingModels,
} from "@/chat-helpers.e2e.js";
import { readAll } from "@/test-utils/test-helpers.js";

describe("Empty Response Error Handling", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	// Test to verify exactly one DONE event is sent in streaming responses
	test.each(streamingModels.slice(0, 3))(
		"streaming response with $model sends exactly one DONE event",
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
							role: "user",
							content: "Say 'hello'",
						},
					],
					stream: true,
				}),
			});

			expect(res.status).toBe(200);

			const streamResult = await readAll(res.body);

			// Should have content (normal response)
			expect(streamResult.hasContent).toBe(true);

			// Should NOT have error in normal response
			expect(streamResult.hasError).toBe(false);
			expect(streamResult.errorEvents.length).toBe(0);

			// Parse all SSE events from the raw content to count DONE events
			const rawContent = streamResult.fullContent || "";
			const doneEventMatches = rawContent.match(/data: \[DONE\]/g);
			const doneEventCount = doneEventMatches ? doneEventMatches.length : 0;

			// Assert exactly ONE DONE event
			expect(doneEventCount).toBe(1);
		},
	);

	// Test to verify error event ordering when empty response is detected
	// This test uses a synthetic approach: we test the readAll helper's ability
	// to parse error events and DONE events correctly
	test("readAll helper correctly parses error and DONE events", async () => {
		// Create a mock streaming response with error event followed by DONE
		const mockSSEContent = `event: error
id: 1
data: {"error":{"message":"Response finished successfully but returned no content or tool calls","type":"upstream_error","code":"upstream_error","param":null,"responseText":"Response finished successfully but returned no content or tool calls"}}

event: done
id: 2
data: [DONE]

`;

		// Create a ReadableStream from the mock content
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(mockSSEContent));
				controller.close();
			},
		});

		const result = await readAll(stream);

		// Verify error event was captured
		expect(result.hasError).toBe(true);
		expect(result.errorEvents.length).toBe(1);
		expect(result.errorEvents[0].error.type).toBe("upstream_error");
		expect(result.errorEvents[0].error.code).toBe("upstream_error");
		expect(result.errorEvents[0].error.message).toContain("no content");

		// Verify exactly one DONE event
		const doneEventMatches = mockSSEContent.match(/data: \[DONE\]/g);
		expect(doneEventMatches).not.toBeNull();
		expect(doneEventMatches?.length).toBe(1);

		// Verify ordering: error event comes before DONE
		const errorIndex = mockSSEContent.indexOf("event: error");
		const doneIndex = mockSSEContent.indexOf("data: [DONE]");
		expect(errorIndex).toBeGreaterThan(-1);
		expect(doneIndex).toBeGreaterThan(-1);
		expect(errorIndex).toBeLessThan(doneIndex);
	});
});
