import { describe, expect, it, vi } from "vitest";

import { logger } from "@llmgateway/logger";

import {
	classifyContentFilterError,
	contentFilterErrorLogLevel,
	logContentFilterError,
	summarizeUpstreamBody,
} from "./content-filter-error.js";

const CONTEXT = {
	requestId: "request-id",
	organizationId: "org-id",
	projectId: "project-id",
	apiKeyId: "api-key-id",
};

const CLOUDFLARE_504 = `<!DOCTYPE html>
<html class="no-js" lang="en-US">
<head>
<title>api.openai.com | 504: Gateway time-out</title>
<meta charset="UTF-8" />
</head>
<body>${"<div>filler</div>".repeat(200)}</body>
</html>`;

describe("classifyContentFilterError", () => {
	it("classifies an upstream 4xx with its error code and message", () => {
		expect(
			classifyContentFilterError({
				source: "openai",
				inputType: "image",
				status: 400,
				response: {
					error: {
						code: "invalid_image_format",
						message: "Unsupported format: image/avif",
						type: "invalid_request_error",
					},
				},
			}),
		).toEqual({
			source: "openai",
			kind: "upstream_4xx",
			inputType: "image",
			status: 400,
			code: "invalid_image_format",
			message: "Unsupported format: image/avif",
		});
	});

	it("reduces an HTML error page to its title", () => {
		expect(
			classifyContentFilterError({
				source: "openai",
				inputType: "image",
				status: 504,
				response: CLOUDFLARE_504,
			}),
		).toEqual({
			source: "openai",
			kind: "upstream_5xx",
			inputType: "image",
			status: 504,
			message: "api.openai.com | 504: Gateway time-out",
		});
	});

	it("classifies a thrown TypeError as a network failure with its code", () => {
		const error = new TypeError("fetch failed", {
			cause: Object.assign(new Error("read ECONNRESET"), {
				code: "ECONNRESET",
			}),
		});
		expect(classifyContentFilterError({ source: "jev", error })).toEqual({
			source: "jev",
			kind: "network",
			code: "ECONNRESET",
			message: "fetch failed: Error: read ECONNRESET (code: ECONNRESET)",
		});
	});

	it("classifies timeouts before anything else", () => {
		const error = new Error("timed out");
		error.name = "TimeoutError";
		expect(classifyContentFilterError({ source: "internal", error }).kind).toBe(
			"timeout",
		);
		expect(
			classifyContentFilterError({ source: "internal", timeout: true }),
		).toEqual({
			source: "internal",
			kind: "timeout",
			message: "moderation call timed out",
		});
	});

	it("marks a 2xx that is not a moderation response", () => {
		expect(
			classifyContentFilterError({
				source: "openai",
				status: 200,
				response: "ok",
				badResponse: true,
			}),
		).toEqual({
			source: "openai",
			kind: "bad_response",
			status: 200,
			message: "ok",
		});
	});

	it("truncates long messages", () => {
		const result = classifyContentFilterError({
			source: "openai",
			status: 400,
			response: { error: { message: "x".repeat(1000) } },
		});
		expect(result.message).toHaveLength(200);
		expect(result.message.endsWith("…")).toBe(true);
	});

	it("falls back to the status when the body says nothing", () => {
		expect(
			classifyContentFilterError({ source: "openai", status: 503 }).message,
		).toBe("HTTP 503");
	});
});

describe("summarizeUpstreamBody", () => {
	it("keeps structured bodies and shortens strings", () => {
		const body = { error: { code: "x" } };
		expect(summarizeUpstreamBody(body)).toBe(body);
		expect(summarizeUpstreamBody(CLOUDFLARE_504)).toBe(
			"api.openai.com | 504: Gateway time-out",
		);
		expect(summarizeUpstreamBody("a".repeat(500))).toHaveLength(200);
	});
});

describe("contentFilterErrorLogLevel", () => {
	it("warns on 4xx and errors on everything else", () => {
		expect(contentFilterErrorLogLevel({ kind: "upstream_4xx" })).toBe("warn");
		for (const kind of [
			"upstream_5xx",
			"timeout",
			"network",
			"bad_response",
			"unexpected",
		] as const) {
			expect(contentFilterErrorLogLevel({ kind })).toBe("error");
		}
	});
});

describe("logContentFilterError", () => {
	it("logs a 4xx as a warning with a summarized body", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		try {
			logContentFilterError(
				"openai",
				"openai",
				CONTEXT,
				classifyContentFilterError({
					source: "openai",
					inputType: "image",
					status: 400,
					response: { error: { code: "image_parse_error", message: "eof" } },
				}),
				{ status: 400, response: CLOUDFLARE_504 },
			);
			expect(errorSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledWith("gateway_content_filter_error", {
				provider: "openai",
				mode: "openai",
				...CONTEXT,
				status: 400,
				response: "api.openai.com | 504: Gateway time-out",
				errorKind: "upstream_4xx",
				errorCode: "image_parse_error",
				error: "eof",
			});
		} finally {
			warnSpy.mockRestore();
			errorSpy.mockRestore();
		}
	});

	it("logs a thrown error at error level with the error attached", () => {
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		try {
			const thrown = new TypeError("fetch failed", {
				cause: new Error("other side closed"),
			});
			logContentFilterError(
				"internal",
				"internal",
				CONTEXT,
				classifyContentFilterError({ source: "internal", error: thrown }),
				{ durationMs: 3 },
				thrown,
			);
			expect(errorSpy).toHaveBeenCalledWith(
				"gateway_content_filter_error",
				expect.objectContaining({
					errorKind: "network",
					error: "fetch failed",
					errorName: "TypeError",
					errorCause: "Error: other side closed",
				}),
				thrown,
			);
		} finally {
			errorSpy.mockRestore();
		}
	});
});
