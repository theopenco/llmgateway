import { describe, expect, test } from "vitest";

import { apiErrorMessage, thrownErrorMessage } from "./api-error";

function jsonResponse(status: number): Response {
	return new Response(null, { status });
}

describe("apiErrorMessage", () => {
	test("reads the message of the global HTTPException envelope", () => {
		expect(
			apiErrorMessage(
				{ error: true, status: 400, message: "Unknown provider: nope" },
				"Failed to test credential",
			),
		).toBe("Unknown provider: nope");
	});

	test("describes zod-openapi request validation failures", () => {
		expect(
			apiErrorMessage(
				{
					success: false,
					error: {
						name: "ZodError",
						issues: [
							{
								code: "too_big",
								path: ["region"],
								message: "String must contain at most 64 character(s)",
							},
						],
					},
				},
				"Failed to test credential",
			),
		).toBe("region: String must contain at most 64 character(s)");
	});

	test("joins multiple validation issues", () => {
		expect(
			apiErrorMessage(
				{
					success: false,
					error: {
						issues: [
							{ path: ["config", "region"], message: "Expected string" },
							{ path: [], message: "Invalid input" },
						],
					},
				},
				"fallback",
			),
		).toBe("config.region: Expected string; Invalid input");
	});

	test("unwraps a nested provider error object", () => {
		expect(
			apiErrorMessage(
				{ error: { message: "Incorrect API key provided" } },
				"fallback",
			),
		).toBe("Incorrect API key provided");
	});

	test("accepts a bare string body", () => {
		expect(apiErrorMessage("Bad Gateway\n", "fallback")).toBe("Bad Gateway");
	});

	test("falls back with the status when the body carries no reason", () => {
		expect(
			apiErrorMessage(
				undefined,
				"Failed to test credential",
				jsonResponse(502),
			),
		).toBe("Failed to test credential (HTTP 502)");
	});

	test("falls back verbatim when there is no response either", () => {
		expect(apiErrorMessage({}, "Failed to test credential")).toBe(
			"Failed to test credential",
		);
	});

	test("ignores a blank message rather than showing an empty reason", () => {
		expect(
			apiErrorMessage({ message: "   " }, "fallback", jsonResponse(500)),
		).toBe("fallback (HTTP 500)");
	});

	test("prefers the status over a proxy's HTML error page", () => {
		expect(
			apiErrorMessage(
				"<html><head><title>502 Bad Gateway</title></head></html>",
				"Failed to test credential",
				jsonResponse(502),
			),
		).toBe("Failed to test credential (HTTP 502)");
	});

	test("truncates a message too long for a dialog", () => {
		const message = apiErrorMessage({ message: "x".repeat(1000) }, "fallback");
		expect(message).toHaveLength(401);
		expect(message.endsWith("…")).toBe(true);
	});
});

describe("thrownErrorMessage", () => {
	test("appends the cause that fetch hides behind 'fetch failed'", () => {
		const error = new Error("fetch failed", {
			cause: new Error("connect ECONNREFUSED 127.0.0.1:4002"),
		});
		expect(thrownErrorMessage(error, "Failed to test credential")).toBe(
			"fetch failed: connect ECONNREFUSED 127.0.0.1:4002",
		);
	});

	test("keeps a single message when the cause repeats it", () => {
		const error = new Error("boom", { cause: new Error("boom") });
		expect(thrownErrorMessage(error, "fallback")).toBe("boom");
	});

	test("falls back for a thrown value with nothing to say", () => {
		expect(thrownErrorMessage(new Error("  "), "fallback")).toBe("fallback");
		expect(thrownErrorMessage(undefined, "fallback")).toBe("fallback");
	});
});
