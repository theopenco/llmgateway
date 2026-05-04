import { describe, expect, it } from "vitest";

import { normalizeStreamingError } from "./normalize-streaming-error.js";

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

	it("preserves generic streaming read errors with 500 classification", () => {
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
		expect(normalized.client.details.statusCode).toBe(500);
		expect(normalized.client.details.statusText).toBe("Streaming Read Error");
		expect(normalized.log.details.name).toBe("SyntaxError");
		expect(normalized.log.details.bufferSnapshot).toBe("data: {");
	});
});
