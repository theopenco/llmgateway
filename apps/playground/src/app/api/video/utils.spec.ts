import { describe, expect, it } from "vitest";

import { getGatewayErrorMessage } from "./utils";

describe("getGatewayErrorMessage", () => {
	const fallback = "Video creation failed";

	it("returns a plain string body", () => {
		expect(getGatewayErrorMessage("boom", fallback)).toBe("boom");
	});

	it("returns a top-level message", () => {
		expect(getGatewayErrorMessage({ message: "nope" }, fallback)).toBe("nope");
	});

	it("returns a string error field", () => {
		expect(getGatewayErrorMessage({ error: "denied" }, fallback)).toBe(
			"denied",
		);
	});

	it("unwraps the nested gateway error envelope", () => {
		expect(
			getGatewayErrorMessage(
				{
					error: {
						message: "Image size not allowed on the free plan",
						type: "invalid_request_error",
						param: null,
						code: null,
					},
				},
				fallback,
			),
		).toBe("Image size not allowed on the free plan");
	});

	it("falls back when the error object has no message", () => {
		expect(getGatewayErrorMessage({ error: { code: 400 } }, fallback)).toBe(
			fallback,
		);
	});

	it("falls back for empty or unknown bodies", () => {
		expect(getGatewayErrorMessage(null, fallback)).toBe(fallback);
		expect(getGatewayErrorMessage("", fallback)).toBe(fallback);
		expect(getGatewayErrorMessage({}, fallback)).toBe(fallback);
	});
});
