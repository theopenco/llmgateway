import { describe, expect, it } from "vitest";

import { parseTrailingUpstreamError } from "./parse-trailing-upstream-error.js";

describe("parseTrailingUpstreamError", () => {
	it("parses the Gemini Flex capacity-shed tail", () => {
		const buffer =
			'\n\r\n{\n  "error": {\n    "code": 503,\n    "message": "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",\n    "status": "UNAVAILABLE"\n  }\n}\n';
		const error = parseTrailingUpstreamError(buffer);
		expect(error).not.toBeNull();
		expect(error?.code).toBe(503);
		expect(error?.status).toBe("UNAVAILABLE");
		expect(error?.message).toContain("high demand");
	});

	it("skips leftover SSE framing lines before the error tail", () => {
		const buffer =
			'\nid: 1\n\n\r\n{\n  "error": {\n    "code": 503,\n    "message": "This model is currently experiencing high demand.",\n    "status": "UNAVAILABLE"\n  }\n}\n';
		const error = parseTrailingUpstreamError(buffer);
		expect(error).not.toBeNull();
		expect(error?.code).toBe(503);
	});

	it("returns null for whitespace-only buffers", () => {
		expect(parseTrailingUpstreamError("")).toBeNull();
		expect(parseTrailingUpstreamError("\n\r\n  ")).toBeNull();
	});

	it("returns null for a partial SSE frame", () => {
		expect(
			parseTrailingUpstreamError('data: {"choices":[{"delta":{"content":"hi'),
		).toBeNull();
	});

	it("returns null for truncated JSON", () => {
		expect(
			parseTrailingUpstreamError('{"error":{"code":503,"message":"high dem'),
		).toBeNull();
	});

	it("returns null for JSON without an error member", () => {
		expect(parseTrailingUpstreamError('{"candidates":[]}')).toBeNull();
	});

	it("returns null when error.message is missing or empty", () => {
		expect(parseTrailingUpstreamError('{"error":{"code":503}}')).toBeNull();
		expect(
			parseTrailingUpstreamError('{"error":{"code":503,"message":""}}'),
		).toBeNull();
	});

	it("returns null when error is not an object", () => {
		expect(parseTrailingUpstreamError('{"error":"boom"}')).toBeNull();
		expect(parseTrailingUpstreamError('{"error":[1]}')).toBeNull();
	});
});
