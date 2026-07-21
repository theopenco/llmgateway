import { describe, expect, it } from "vitest";

import {
	buildUpstreamErrorClientPayload,
	canonicalStatusText,
	clientFacingUpstreamFailureMessage,
	redactErrorDetails,
	redactedProviderErrorText,
	shouldRedactProviderError,
} from "./stealth-provider-errors.js";

describe("shouldRedactProviderError", () => {
	it("returns true for stealth providers", () => {
		expect(shouldRedactProviderError("granite")).toBe(true);
		expect(shouldRedactProviderError("glacier")).toBe(true);
		expect(shouldRedactProviderError("tundra")).toBe(true);
	});

	it("returns false for regular providers", () => {
		expect(shouldRedactProviderError("openai")).toBe(false);
		expect(shouldRedactProviderError("anthropic")).toBe(false);
		expect(shouldRedactProviderError("aws-bedrock")).toBe(false);
	});

	it("returns false for missing or unknown providers", () => {
		expect(shouldRedactProviderError(null)).toBe(false);
		expect(shouldRedactProviderError(undefined)).toBe(false);
		expect(shouldRedactProviderError("")).toBe(false);
		expect(shouldRedactProviderError("not-a-provider")).toBe(false);
	});
});

describe("redactedProviderErrorText", () => {
	it("contains only the status code and canonical reason phrase", () => {
		expect(redactedProviderErrorText(429)).toBe(
			"Upstream provider error (429 Too Many Requests)",
		);
		expect(redactedProviderErrorText(500)).toBe(
			"Upstream provider error (500 Internal Server Error)",
		);
	});

	it("omits the reason phrase for unknown status codes", () => {
		expect(redactedProviderErrorText(599)).toBe(
			"Upstream provider error (599)",
		);
	});
});

describe("redactErrorDetails", () => {
	it("keeps only the status code and replaces provider-controlled text", () => {
		const redacted = redactErrorDetails({
			statusCode: 429,
			statusText: "SecretVendor rate limited",
			responseText: '{"error":{"message":"SecretVendor quota exceeded"}}',
			cause: "connect to api.secretvendor.com failed",
		});
		expect(redacted).toEqual({
			statusCode: 429,
			statusText: "Too Many Requests",
			responseText: "Upstream provider error (429 Too Many Requests)",
		});
	});
});

describe("buildUpstreamErrorClientPayload", () => {
	it("passes the raw body through for regular providers", () => {
		const payload = buildUpstreamErrorClientPayload(
			"openai",
			500,
			"Internal Server Error",
			'{"error":{"message":"boom"}}',
		);
		expect(payload.message).toBe(
			'Error from provider openai: 500 Internal Server Error {"error":{"message":"boom"}}',
		);
		expect(payload.responseText).toBe('{"error":{"message":"boom"}}');
	});

	it("redacts the body and upstream status text for stealth providers", () => {
		const payload = buildUpstreamErrorClientPayload(
			"granite",
			500,
			"SecretVendor exploded",
			'{"error":{"message":"SecretVendor internal error"}}',
		);
		expect(payload.message).toBe(
			"Error from provider granite: 500 Internal Server Error",
		);
		expect(payload.responseText).toBe(
			"Upstream provider error (500 Internal Server Error)",
		);
		expect(JSON.stringify(payload)).not.toContain("SecretVendor");
	});
});

describe("clientFacingUpstreamFailureMessage", () => {
	it("includes the error message for regular providers", () => {
		expect(
			clientFacingUpstreamFailureMessage(
				"openai",
				"Failed to connect to provider",
				"getaddrinfo ENOTFOUND api.openai.com",
			),
		).toBe(
			"Failed to connect to provider: getaddrinfo ENOTFOUND api.openai.com",
		);
	});

	it("drops the error message for stealth providers", () => {
		expect(
			clientFacingUpstreamFailureMessage(
				"tundra",
				"Failed to connect to provider",
				"getaddrinfo ENOTFOUND api.secretvendor.com",
			),
		).toBe("Failed to connect to provider");
	});
});

describe("canonicalStatusText", () => {
	it("maps known status codes and falls back to empty string", () => {
		expect(canonicalStatusText(404)).toBe("Not Found");
		expect(canonicalStatusText(599)).toBe("");
	});
});
