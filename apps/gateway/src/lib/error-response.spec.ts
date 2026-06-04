import { describe, expect, test } from "vitest";

import {
	buildAnthropicErrorBody,
	buildOpenAIErrorBody,
	getAnthropicErrorType,
	getOpenAIErrorMeta,
} from "./error-response.js";

describe("error-response", () => {
	test("builds OpenAI envelope with status-derived type and code", () => {
		expect(
			buildOpenAIErrorBody({
				message: "Unauthorized: LLMGateway API key reached its usage limit.",
				status: 401,
			}),
		).toEqual({
			error: {
				message: "Unauthorized: LLMGateway API key reached its usage limit.",
				type: "invalid_request_error",
				param: null,
				code: "invalid_api_key",
			},
			message: "Unauthorized: LLMGateway API key reached its usage limit.",
			status: 401,
		});
	});

	test("maps rate limit and server errors to OpenAI types", () => {
		expect(getOpenAIErrorMeta(429)).toEqual({
			type: "rate_limit_error",
			code: "rate_limit_exceeded",
		});
		expect(getOpenAIErrorMeta(500)).toEqual({ type: "api_error", code: null });
		expect(getOpenAIErrorMeta(400)).toEqual({
			type: "invalid_request_error",
			code: null,
		});
	});

	test("allows explicit type/code/param overrides", () => {
		expect(
			buildOpenAIErrorBody({
				message: "bad input",
				status: 400,
				code: "invalid_json",
				param: "messages",
			}),
		).toEqual({
			error: {
				message: "bad input",
				type: "invalid_request_error",
				param: "messages",
				code: "invalid_json",
			},
			message: "bad input",
			status: 400,
		});
	});

	test("builds Anthropic envelope with status-derived type", () => {
		expect(buildAnthropicErrorBody({ message: "denied", status: 403 })).toEqual(
			{
				type: "error",
				error: { type: "permission_error", message: "denied" },
				message: "denied",
				status: 403,
			},
		);
		expect(getAnthropicErrorType(429)).toBe("rate_limit_error");
		expect(getAnthropicErrorType(500)).toBe("api_error");
	});
});
