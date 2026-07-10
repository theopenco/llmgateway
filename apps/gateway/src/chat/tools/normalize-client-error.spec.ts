import { describe, expect, it } from "vitest";

import { normalizeClientErrorBody } from "./normalize-client-error.js";

const ctx = {
	usedProvider: "aws-bedrock",
	finishReason: "client_error",
	status: 400,
	statusText: "Bad Request",
	requestedProvider: "aws-bedrock",
	requestedModel: "aws-bedrock/llama-4-scout-17b-instruct",
	usedInternalModel: "llama-4-scout-17b-instruct",
};

describe("normalizeClientErrorBody", () => {
	it("passes OpenAI-shaped error bodies through unchanged", () => {
		const body = JSON.stringify({
			error: { message: "bad param", type: "invalid_request_error", code: "x" },
		});
		expect(normalizeClientErrorBody(body, ctx)).toEqual({
			error: { message: "bad param", type: "invalid_request_error", code: "x" },
		});
	});

	it("wraps a bare Bedrock `{ message }` body into the OpenAI envelope", () => {
		const body = JSON.stringify({
			message: "The provided model identifier is invalid.",
		});
		const result = normalizeClientErrorBody(body, ctx) as {
			error: Record<string, unknown>;
		};
		expect(result.error.message).toBe(
			"The provided model identifier is invalid.",
		);
		expect(result.error.type).toBe("client_error");
		expect(result.error.code).toBe("client_error");
		expect(result.error.usedProvider).toBe("aws-bedrock");
		expect(result.error.responseText).toBe(body);
	});

	it("wraps a non-JSON body using the raw text as the message", () => {
		const result = normalizeClientErrorBody("upstream exploded", ctx) as {
			error: Record<string, unknown>;
		};
		expect(result.error.message).toBe("upstream exploded");
	});

	it("uses a string `error` field as the message when not an object", () => {
		const body = JSON.stringify({ error: "quota exceeded" });
		const result = normalizeClientErrorBody(body, ctx) as {
			error: Record<string, unknown>;
		};
		expect(result.error.message).toBe("quota exceeded");
	});
});
