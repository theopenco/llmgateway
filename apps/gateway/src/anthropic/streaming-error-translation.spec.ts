import { describe, expect, it } from "vitest";

import {
	buildAnthropicErrorEvent,
	mapInternalErrorTypeToAnthropic,
} from "./streaming-error-translation.js";

describe("mapInternalErrorTypeToAnthropic", () => {
	it("maps internal-only finish reasons to Anthropic types", () => {
		expect(mapInternalErrorTypeToAnthropic("client_error")).toBe(
			"invalid_request_error",
		);
		expect(mapInternalErrorTypeToAnthropic("gateway_error")).toBe(
			"authentication_error",
		);
		expect(mapInternalErrorTypeToAnthropic("upstream_error")).toBe("api_error");
	});

	it("preserves canonical Anthropic types (including ones not exposed internally)", () => {
		for (const type of [
			"invalid_request_error",
			"authentication_error",
			"billing_error",
			"permission_error",
			"not_found_error",
			"request_too_large",
			"rate_limit_error",
			"api_error",
			"timeout_error",
			"overloaded_error",
		]) {
			expect(mapInternalErrorTypeToAnthropic(type)).toBe(type);
		}
	});

	it("falls back to api_error for unknown / missing types", () => {
		expect(mapInternalErrorTypeToAnthropic(undefined)).toBe("api_error");
		expect(mapInternalErrorTypeToAnthropic(null)).toBe("api_error");
		expect(mapInternalErrorTypeToAnthropic("totally_made_up")).toBe(
			"api_error",
		);
		expect(mapInternalErrorTypeToAnthropic(42)).toBe("api_error");
	});
});

describe("buildAnthropicErrorEvent", () => {
	it("translates the user's exact repro: passthrough Anthropic shape with invalid_request_error", () => {
		const chunk = {
			type: "error",
			error: {
				type: "invalid_request_error",
				message:
					"messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01TEST123",
			},
		};
		expect(buildAnthropicErrorEvent(chunk)).toEqual({
			type: "error",
			error: {
				type: "invalid_request_error",
				message:
					"messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01TEST123",
			},
		});
	});

	it("preserves unknown-but-valid Anthropic types on passthrough (future-proofing)", () => {
		const chunk = {
			type: "error",
			error: { type: "billing_error", message: "Add a payment method" },
		};
		const out = buildAnthropicErrorEvent(chunk);
		expect(out.error.type).toBe("billing_error");
		expect(out.error.message).toBe("Add a payment method");
	});

	it("translates the wrapped internal client_error shape from chat.ts", () => {
		const chunk = {
			error: {
				message: "Error from provider anthropic: 400 Bad Request ...",
				type: "client_error",
				param: null,
				code: "client_error",
				responseText: "...",
			},
		};
		expect(buildAnthropicErrorEvent(chunk)).toEqual({
			type: "error",
			error: {
				type: "invalid_request_error",
				message: "Error from provider anthropic: 400 Bad Request ...",
			},
		});
	});

	it("translates the wrapped internal upstream_error shape", () => {
		const chunk = {
			error: {
				message: "Provider returned 503",
				type: "upstream_error",
				code: "upstream_error",
			},
		};
		expect(buildAnthropicErrorEvent(chunk).error.type).toBe("api_error");
	});

	it("translates the wrapped internal gateway_error shape", () => {
		const chunk = {
			error: { message: "Bad API key", type: "gateway_error" },
		};
		expect(buildAnthropicErrorEvent(chunk).error.type).toBe(
			"authentication_error",
		);
	});

	it("falls back to api_error + JSON-stringified body for unparseable shapes", () => {
		const chunk = { random: "thing" };
		const out = buildAnthropicErrorEvent(chunk);
		expect(out.type).toBe("error");
		expect(out.error.type).toBe("api_error");
		expect(out.error.message).toBe(JSON.stringify(chunk));
	});

	it("uses string chunks verbatim as the message", () => {
		expect(buildAnthropicErrorEvent("plain error text")).toEqual({
			type: "error",
			error: { type: "api_error", message: "plain error text" },
		});
	});

	it("falls back to JSON-stringified inner error when inner.message is non-string", () => {
		const chunk = {
			error: {
				type: "client_error",
				message: { nested: "object" },
			},
		};
		const out = buildAnthropicErrorEvent(chunk);
		expect(out.error.type).toBe("invalid_request_error");
		expect(out.error.message).toBe(JSON.stringify(chunk.error));
	});
});
