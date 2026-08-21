import { describe, expect, it } from "vitest";

import { redactedProviderErrorText } from "@/lib/stealth-provider-errors.js";

import {
	isUpstreamTermination,
	normalizeStreamingError,
} from "./normalize-streaming-error.js";

describe("normalizeStreamingError", () => {
	it("classifies terminated undici stream reads as upstream termination", () => {
		const socketCloseError = new Error("other side closed") as Error & {
			code?: string;
		};
		socketCloseError.name = "SocketError";
		socketCloseError.code = "UND_ERR_SOCKET";

		const error = new TypeError("terminated", {
			cause: socketCloseError,
		});

		const normalized = normalizeStreamingError({
			error,
			provider: "novita",
			model: "deepseek/deepseek-chat-v3.2",
			bufferSnapshot: "\n\n",
			phase: "upstream_read",
		});

		expect(normalized.terminated).toBe(true);
		expect(normalized.client.message).toBe(
			"Upstream stream terminated unexpectedly before completion",
		);
		expect(normalized.client.details.statusCode).toBe(502);
		expect(normalized.client.details.statusText).toBe(
			"Upstream Stream Terminated",
		);
		expect(normalized.client.details.errorCode).toBe("UND_ERR_SOCKET");
		expect(normalized.log.details.responseText).toContain("terminated");
		expect(normalized.log.details.cause).toContain("UND_ERR_SOCKET");
	});

	it("surfaces a structured trailing upstream error on termination", () => {
		// The Gemini API sheds Flex-tier capacity by writing a raw JSON error
		// tail and closing the socket; the tail is still in the stream buffer.
		const socketCloseError = new Error("other side closed") as Error & {
			code?: string;
		};
		socketCloseError.name = "SocketError";
		socketCloseError.code = "UND_ERR_SOCKET";
		const error = new TypeError("terminated", { cause: socketCloseError });

		const bufferSnapshot =
			'\n\r\n{\n  "error": {\n    "code": 503,\n    "message": "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",\n    "status": "UNAVAILABLE"\n  }\n}\n';

		const normalized = normalizeStreamingError({
			error,
			provider: "google-ai-studio",
			model: "gemini-3.7-flash",
			bufferSnapshot,
			phase: "upstream_read",
		});

		expect(normalized.terminated).toBe(true);
		expect(normalized.client.message).toContain("high demand");
		expect(normalized.client.details.statusCode).toBe(503);
		expect(normalized.client.details.statusText).toBe(
			"Upstream Stream Terminated",
		);
	});

	it("keeps the scrubbed payload when a trailing error is redacted", () => {
		const socketCloseError = new Error("other side closed") as Error & {
			code?: string;
		};
		socketCloseError.name = "SocketError";
		socketCloseError.code = "UND_ERR_SOCKET";
		const error = new TypeError("terminated", { cause: socketCloseError });

		const bufferSnapshot =
			'{"error":{"code":503,"message":"SecretVendor is currently experiencing high demand.","status":"UNAVAILABLE"}}';

		const normalized = normalizeStreamingError({
			error,
			provider: "tundra",
			model: "kimi-k2.6",
			bufferSnapshot,
			phase: "upstream_read",
			redact: true,
		});

		// The upstream status still classifies the failure, but the vendor's
		// message never reaches the client.
		expect(normalized.client.details.statusCode).toBe(503);
		expect(normalized.client.message).toBe(redactedProviderErrorText(503));
		const clientSerialized = JSON.stringify(normalized.client);
		expect(clientSerialized).not.toContain("SecretVendor");
		expect(normalized.log.details.bufferSnapshot).toBe(bufferSnapshot);
	});

	it("preserves generic streaming read errors with 500 classification", () => {
		const error = new SyntaxError("Unexpected end of JSON input");

		const normalized = normalizeStreamingError({
			error,
			provider: "openai",
			model: "gpt-4.1-mini",
			bufferSnapshot: "data: {",
			phase: "upstream_read",
		});

		expect(normalized.terminated).toBe(false);
		expect(normalized.client.message).toBe(
			"Streaming error: Unexpected end of JSON input",
		);
		expect(normalized.client.details.statusCode).toBe(500);
		expect(normalized.client.details.statusText).toBe("Streaming Read Error");
		expect(normalized.log.details.name).toBe("SyntaxError");
		expect(normalized.log.details.bufferSnapshot).toBe("data: {");
	});

	it("serializes non-Error object payloads instead of [object Object]", () => {
		const error = {
			status: 503,
			body: { error: { type: "overloaded_error", message: "Try again" } },
		};

		const normalized = normalizeStreamingError({
			error,
			provider: "anthropic",
			model: "claude-3-5-sonnet",
			phase: "upstream_read",
		});

		expect(normalized.log.details.responseText).not.toContain(
			"[object Object]",
		);
		expect(normalized.log.details.responseText).toContain("overloaded_error");
		expect(normalized.client.message).not.toContain("[object Object]");
		expect(normalized.client.message).toContain("overloaded_error");
	});

	it("uses message field when non-Error object provides one", () => {
		const error = { message: "Connection reset by peer", code: "ECONNRESET" };

		const normalized = normalizeStreamingError({
			error,
			provider: "openai",
			model: "gpt-4.1-mini",
			phase: "upstream_read",
		});

		expect(normalized.client.message).toBe(
			"Streaming error: Connection reset by peer",
		);
		expect(normalized.log.details.responseText).toBe(
			"Connection reset by peer",
		);
	});

	it("falls back to a meaningful string for empty objects", () => {
		const normalized = normalizeStreamingError({
			error: {},
			provider: "openai",
			model: "gpt-4.1-mini",
			phase: "upstream_read",
		});

		expect(normalized.log.details.responseText).not.toBe("[object Object]");
		expect(normalized.client.message).not.toContain("[object Object]");
	});

	it("scrubs the client payload when redact is set but keeps the log raw", () => {
		// A mid-stream read fault whose undici cause chain and buffered body both
		// embed the secret stealth host / vendor identity.
		const dnsError = new Error(
			"getaddrinfo ENOTFOUND api.secretvendor.com",
		) as Error & { code?: string };
		dnsError.code = "ENOTFOUND";
		const error = new TypeError("fetch failed", { cause: dnsError });

		const bufferSnapshot =
			'data: {"error":{"message":"SecretVendor quota exceeded at api.secretvendor.com"}}';

		const normalized = normalizeStreamingError({
			error,
			provider: "tundra",
			model: "kimi-k2.6",
			bufferSnapshot,
			phase: "upstream_read",
			redact: true,
		});

		// Client payload: no host, vendor identity, raw message or buffered body.
		const clientSerialized = JSON.stringify(normalized.client);
		expect(clientSerialized).not.toContain("SecretVendor");
		expect(clientSerialized).not.toContain("secretvendor.com");
		expect(clientSerialized).not.toContain("fetch failed");
		expect(clientSerialized).not.toContain("getaddrinfo");
		expect(clientSerialized).not.toContain(bufferSnapshot);

		// The cause chain (which embeds the secret host) is dropped entirely.
		expect(normalized.client.details.cause).toBeUndefined();
		// Node-level failure identifiers are dropped too, matching the sibling
		// redactErrorDetails: only statusCode/statusText survive.
		expect(normalized.client.details.errorName).toBeUndefined();
		expect(normalized.client.details.errorCode).toBeUndefined();
		expect(clientSerialized).not.toContain("ENOTFOUND");
		// Only the gateway-derived status survives, as the generic status text.
		expect(normalized.client.details.statusCode).toBe(500);
		expect(normalized.client.responseText).toBe(redactedProviderErrorText(500));
		expect(normalized.client.message).toBe(redactedProviderErrorText(500));
		expect(normalized.client.code).toBe("streaming_error");

		// The internal log is never redacted: it feeds the internal-only columns.
		expect(normalized.log.details.responseText).toContain(
			"api.secretvendor.com",
		);
		expect(normalized.log.details.cause).toContain("ENOTFOUND");
		expect(normalized.log.details.bufferSnapshot).toBe(bufferSnapshot);
	});

	it("scrubs the buffered body on a redacted upstream termination", () => {
		// The realistic mid-stream leak: the provider kills the socket while a
		// half-written, vendor-branded event is still sitting in the SSE buffer,
		// so the raw bytes reach the client through responseText rather than
		// through the error message.
		const socketCloseError = new Error("other side closed") as Error & {
			code?: string;
		};
		socketCloseError.name = "SocketError";
		socketCloseError.code = "UND_ERR_SOCKET";
		const error = new TypeError("terminated", { cause: socketCloseError });

		const bufferSnapshot =
			'data: {"choices":[{"delta":{"content":"SecretVendor internal note: api.secretvendor.com';

		const normalized = normalizeStreamingError({
			error,
			provider: "tundra",
			model: "kimi-k2.6",
			bufferSnapshot,
			phase: "upstream_read",
			redact: true,
		});

		// Redaction must not change how the failure is classified: it is still an
		// upstream termination, so it keeps the 502/warn treatment.
		expect(normalized.terminated).toBe(true);
		expect(normalized.client.details.statusCode).toBe(502);
		expect(normalized.client.details.statusText).toBe(
			"Upstream Stream Terminated",
		);
		expect(normalized.client.type).toBe("gateway_error");

		const clientSerialized = JSON.stringify(normalized.client);
		expect(clientSerialized).not.toContain("SecretVendor");
		expect(clientSerialized).not.toContain("secretvendor.com");
		expect(clientSerialized).not.toContain("UND_ERR_SOCKET");
		expect(normalized.client.responseText).toBe(redactedProviderErrorText(502));
		expect(normalized.client.message).toBe(redactedProviderErrorText(502));

		expect(normalized.log.details.bufferSnapshot).toBe(bufferSnapshot);
		expect(normalized.log.details.errorCode).toBe("UND_ERR_SOCKET");
	});

	it("leaves the client payload untouched when redact is false", () => {
		const socketCloseError = new Error("other side closed") as Error & {
			code?: string;
		};
		socketCloseError.name = "SocketError";
		socketCloseError.code = "UND_ERR_SOCKET";
		const error = new TypeError("terminated", { cause: socketCloseError });

		const normalized = normalizeStreamingError({
			error,
			provider: "openai",
			model: "gpt-4.1-mini",
			bufferSnapshot: 'data: {"choices":[{"delta":{"content":"partial',
			phase: "upstream_read",
			redact: false,
		});

		expect(normalized.client.responseText).toBe(
			'data: {"choices":[{"delta":{"content":"partial',
		);
		expect(normalized.client.details.errorCode).toBe("UND_ERR_SOCKET");
		expect(normalized.client.details.cause).toContain("other side closed");
	});

	it("leaves the client payload untouched when redact is not set", () => {
		const error = new SyntaxError("Unexpected end of JSON input");

		const normalized = normalizeStreamingError({
			error,
			provider: "openai",
			model: "gpt-4.1-mini",
			bufferSnapshot: "data: {",
			phase: "upstream_read",
		});

		expect(normalized.client.message).toBe(
			"Streaming error: Unexpected end of JSON input",
		);
		expect(normalized.client.responseText).toBe("data: {");
	});
});

describe("isUpstreamTermination", () => {
	it("detects a bare undici terminated TypeError", () => {
		expect(isUpstreamTermination(new TypeError("terminated"))).toBe(true);
	});

	it("detects an upstream socket close via the cause chain", () => {
		const socketCloseError = new Error("other side closed") as Error & {
			code?: string;
		};
		socketCloseError.name = "SocketError";
		socketCloseError.code = "UND_ERR_SOCKET";

		const error = new TypeError("terminated", { cause: socketCloseError });

		expect(isUpstreamTermination(error)).toBe(true);
	});

	it("detects ECONNRESET surfaced through the cause chain", () => {
		const reset = new Error("read ECONNRESET") as Error & { code?: string };
		reset.code = "ECONNRESET";

		expect(
			isUpstreamTermination(new Error("fetch failed", { cause: reset })),
		).toBe(true);
	});

	it("does not flag genuine gateway-side errors", () => {
		expect(
			isUpstreamTermination(new SyntaxError("Unexpected end of JSON input")),
		).toBe(false);
		expect(isUpstreamTermination("terminated")).toBe(false);
		expect(isUpstreamTermination(undefined)).toBe(false);
	});
});
