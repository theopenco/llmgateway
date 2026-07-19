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

	it("returns upstream_error for 400 temporary routing errors", () => {
		expect(
			getFinishReasonFromError(
				400,
				'{"error":{"message":"Temporary routing error (400).","type":"upstream_error","code":400}}',
			),
		).toBe("upstream_error");
	});

	it("returns gateway_error for 402 insufficient balance", () => {
		expect(getFinishReasonFromError(402)).toBe("gateway_error");
		expect(
			getFinishReasonFromError(
				402,
				'{"error":{"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}',
			),
		).toBe("gateway_error");
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

	it("returns content_filter for ByteDance SensitiveContentDetected", () => {
		const bytedanceError = JSON.stringify({
			error: {
				code: "SensitiveContentDetected",
				message:
					"The request failed because the input text may contain sensitive information.",
				param: "",
				type: "BadRequest",
			},
		});
		expect(getFinishReasonFromError(400, bytedanceError)).toBe(
			"content_filter",
		);
	});

	it("returns content_filter for Alibaba data inspection errors", () => {
		const alibabaError = JSON.stringify({
			error: {
				code: "data_inspection_failed",
				message:
					"Input data may contain inappropriate content. Please ensure that your input complies with the usage policy of DashScope LLM.",
				param: null,
				type: "data_inspection_failed",
			},
		});
		expect(getFinishReasonFromError(400, alibabaError)).toBe("content_filter");
	});

	it("returns content_filter for zai content filter", () => {
		expect(
			getFinishReasonFromError(
				400,
				"System detected potentially unsafe or sensitive content in input or generation",
			),
		).toBe("content_filter");
	});

	it("returns client_error for OpenAI JSON format validation error", () => {
		expect(
			getFinishReasonFromError(
				400,
				"'messages' must contain the word 'json' in some form",
			),
		).toBe("client_error");
	});

	it("returns content_filter for OpenAI safety system rejection", () => {
		const openaiError = JSON.stringify({
			error: {
				code: "moderation_blocked",
				message: "Your request was rejected by the safety system.",
				param: null,
				type: "image_generation_user_error",
			},
		});
		expect(getFinishReasonFromError(400, openaiError)).toBe("content_filter");
	});

	it("returns content_filter for xAI 403 safety rejection", () => {
		expect(
			getFinishReasonFromError(
				403,
				"Content violates usage guidelines: SAFETY_CHECK_TYPE_CSAM",
			),
		).toBe("content_filter");
	});

	it("returns content_filter for Azure OpenAI prompt content filter", () => {
		const azurePromptFilterError = JSON.stringify({
			error: {
				message:
					"The response was filtered due to the prompt triggering Microsoft's content management policy. Please modify your prompt and retry.",
				type: null,
				param: "prompt",
				code: "content_filter",
				status: 400,
			},
		});
		expect(getFinishReasonFromError(400, azurePromptFilterError)).toBe(
			"content_filter",
		);
	});

	it("returns client_error for other 400 errors", () => {
		expect(getFinishReasonFromError(400, "some other error")).toBe(
			"client_error",
		);
	});

	it("returns gateway_error for 401/403 auth errors", () => {
		expect(getFinishReasonFromError(401)).toBe("gateway_error");
		expect(getFinishReasonFromError(403)).toBe("gateway_error");
	});

	it("returns gateway_error for 400 invalid API key payloads", () => {
		expect(
			getFinishReasonFromError(
				400,
				'{"error":{"message":"API key not valid. Please pass a valid API key.","type":"authentication_error","code":"invalid_api_key"}}',
			),
		).toBe("gateway_error");
	});

	it("returns gateway_error for invalid_api_key code only", () => {
		expect(
			getFinishReasonFromError(
				400,
				'{"error":{"message":"Some unfamiliar wording","code":"invalid_api_key"}}',
			),
		).toBe("gateway_error");
	});

	it("returns gateway_error for 'Incorrect API key provided' wording", () => {
		expect(
			getFinishReasonFromError(401, "Incorrect API key provided: sk-test***"),
		).toBe("gateway_error");
	});

	it("returns client_error when no error text provided for other 4xx", () => {
		expect(getFinishReasonFromError(400)).toBe("client_error");
		expect(getFinishReasonFromError(422)).toBe("client_error");
	});

	it("returns gateway_error for bare 'Not Found' body", () => {
		expect(getFinishReasonFromError(400, "Not Found")).toBe("gateway_error");
		expect(getFinishReasonFromError(400, "  Not Found  ")).toBe(
			"gateway_error",
		);
	});

	it("returns gateway_error for Azure missing deployment errors", () => {
		const azureDeploymentError = JSON.stringify({
			type: "error",
			error: {
				type: "invalid_request_error",
				code: null,
				headers: { "x-ms-fe-error": "true" },
				message:
					"Could not find an existing deployment to match the model in the request. Please verify the model matches an existing deployment in the account.",
				param: null,
			},
			sequence_number: 2,
		});
		expect(getFinishReasonFromError(400, azureDeploymentError)).toBe(
			"gateway_error",
		);
	});

	it("returns gateway_error for upstream 'Unknown model' messages", () => {
		expect(
			getFinishReasonFromError(
				400,
				'{"object":"error","message":"Unknown model: foo","type":"invalid_model"}',
			),
		).toBe("gateway_error");
		expect(getFinishReasonFromError(400, "unknown model: bar")).toBe(
			"gateway_error",
		);
	});
});
