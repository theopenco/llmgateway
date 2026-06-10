import { describe, expect, test } from "vitest";

import { getGatewayErrorMessage } from "./utils";

describe("getGatewayErrorMessage", () => {
	test("returns plain string bodies", () => {
		expect(getGatewayErrorMessage("upstream exploded", "fallback")).toBe(
			"upstream exploded",
		);
	});

	test("reads root-level message", () => {
		expect(
			getGatewayErrorMessage({ message: "root message" }, "fallback"),
		).toBe("root message");
	});

	test("reads root-level error string", () => {
		expect(getGatewayErrorMessage({ error: "flat error" }, "fallback")).toBe(
			"flat error",
		);
	});

	test("reads the OpenAI error envelope", () => {
		expect(
			getGatewayErrorMessage(
				{
					error: {
						message:
							"Model grok-imagine-video-1-5-preview requires an input image.",
						type: "invalid_request_error",
						param: null,
						code: null,
					},
				},
				"fallback",
			),
		).toBe("Model grok-imagine-video-1-5-preview requires an input image.");
	});

	test("falls back when the envelope has no message", () => {
		expect(getGatewayErrorMessage({ error: {} }, "fallback")).toBe("fallback");
		expect(getGatewayErrorMessage(null, "fallback")).toBe("fallback");
		expect(getGatewayErrorMessage("", "fallback")).toBe("fallback");
	});
});
