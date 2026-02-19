import { describe, expect, it } from "vitest";

import { getFinishReasonFromError } from "./get-finish-reason-from-error.js";

describe("getFinishReasonFromError", () => {
	it("returns upstream_error for 5xx status codes", () => {
		expect(getFinishReasonFromError(500)).toBe("upstream_error");
		expect(getFinishReasonFromError(502)).toBe("upstream_error");
		expect(getFinishReasonFromError(503)).toBe("upstream_error");
	});

	it("returns upstream_error for 429 rate limit", () => {
		expect(getFinishReasonFromError(429)).toBe("upstream_error");
	});

	it("returns upstream_error for 404 not found", () => {
		expect(getFinishReasonFromError(404)).toBe("upstream_error");
	});

	it("returns content_filter for Azure ResponsibleAIPolicyViolation", () => {
		const azureError = JSON.stringify({
			error: {
				inner_error: {
					code: "ResponsibleAIPolicyViolation",
					content_filter_results: {
						sexual: { filtered: false, severity: "safe" },
						violence: { filtered: true, severity: "high" },
						hate: { filtered: false, severity: "safe" },
						self_harm: { filtered: false, severity: "safe" },
					},
				},
				code: "content_filter",
				message:
					"The response was filtered due to the prompt triggering Azure OpenAI's content management policy.",
				param: "prompt",
				type: null,
			},
		});
		expect(getFinishReasonFromError(400, azureError)).toBe("content_filter");
	});

	it("returns content_filter for Azure error even with 5xx (5xx takes precedence)", () => {
		const azureError =
			'{"error":{"inner_error":{"code":"ResponsibleAIPolicyViolation"}}}';
		// 5xx check runs first, so upstream_error takes precedence
		expect(getFinishReasonFromError(500, azureError)).toBe("upstream_error");
	});

	it("returns client_error for zai content filter", () => {
		expect(
			getFinishReasonFromError(
				400,
				"System detected potentially unsafe or sensitive content in input or generation",
			),
		).toBe("client_error");
	});

	it("returns client_error for OpenAI JSON format validation error", () => {
		expect(
			getFinishReasonFromError(
				400,
				"'messages' must contain the word 'json' in some form",
			),
		).toBe("client_error");
	});

	it("returns gateway_error for other 400 errors", () => {
		expect(getFinishReasonFromError(400, "some other error")).toBe(
			"gateway_error",
		);
	});

	it("returns gateway_error for 401/403 auth errors", () => {
		expect(getFinishReasonFromError(401)).toBe("gateway_error");
		expect(getFinishReasonFromError(403)).toBe("gateway_error");
	});

	it("returns gateway_error when no error text provided", () => {
		expect(getFinishReasonFromError(400)).toBe("gateway_error");
	});
});
