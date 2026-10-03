import { APICallError, StreamProviderError } from "ai";
import { describe, expect, it } from "vitest";

import { getChatSupportErrorMessage } from "./public-chat-support.js";

describe("getChatSupportErrorMessage", () => {
	it("maps a mid-stream rate limit without leaking upstream details", () => {
		const error = new StreamProviderError({
			message:
				"Your requests to some-deployment in some-region have exceeded token rate limit.",
			type: "upstream_error",
			code: "rate_limit_exceeded",
			isRetryable: true,
		});
		const message = getChatSupportErrorMessage(error);
		expect(message).toMatch(/lot of requests/);
		expect(message).not.toMatch(/some-region/);
	});

	it("maps an HTTP 429", () => {
		const error = new APICallError({
			message: "Too Many Requests",
			url: "https://example.com",
			requestBodyValues: {},
			statusCode: 429,
		});
		expect(getChatSupportErrorMessage(error)).toMatch(/lot of requests/);
	});

	it("falls back to a generic message", () => {
		expect(getChatSupportErrorMessage(new Error("boom"))).toBe(
			"The assistant could not answer right now. Please try again.",
		);
	});
});
