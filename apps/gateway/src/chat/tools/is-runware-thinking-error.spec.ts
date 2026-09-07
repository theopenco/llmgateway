import { describe, expect, it } from "vitest";

import { isRunwareThinkingError } from "./is-runware-thinking-error.js";

describe("isRunwareThinkingError", () => {
	const error = {
		message:
			"Unsupported parameter 'chat_template_kwargs.enable_thinking'; use 'reasoning_effort'.",
		type: "invalid_request_error",
		param: "chat_template_kwargs.enable_thinking",
		code: "invalid_value",
	};
	const body = { model: "zai-glm-5-2", reasoning_effort: "high" };
	const errorText = JSON.stringify({ error });

	it("recognizes the exact rejection of an unsent flag", () => {
		expect(isRunwareThinkingError("runware", 400, errorText, body)).toBe(true);
	});

	it("does not reclassify a request that actually sent chat-template parameters", () => {
		expect(
			isRunwareThinkingError("runware", 400, errorText, {
				...body,
				chat_template_kwargs: { enable_thinking: true },
			}),
		).toBe(false);
	});

	it.each([undefined, null, "{}"])(
		"requires the outbound request body: %s",
		(requestBody) => {
			expect(
				isRunwareThinkingError("runware", 400, errorText, requestBody),
			).toBe(false);
		},
	);

	it("does not match another provider or HTTP status", () => {
		expect(isRunwareThinkingError("novita", 400, errorText, body)).toBe(false);
		expect(isRunwareThinkingError("runware", 422, errorText, body)).toBe(false);
	});

	it.each([
		{ param: "reasoning_effort" },
		{ code: "unsupported_content_type" },
		{ type: "content_filter" },
		{ message: "This parameter is not supported for this model" },
	])("requires the known structured error: %j", (override) => {
		expect(
			isRunwareThinkingError(
				"runware",
				400,
				JSON.stringify({ error: { ...error, ...override } }),
				body,
			),
		).toBe(false);
	});

	it.each(["not JSON", "null", "{}", '{"error":null}', '{"error":"invalid"}'])(
		"ignores other error bodies: %s",
		(text) => {
			expect(isRunwareThinkingError("runware", 400, text, body)).toBe(false);
		},
	);
});
