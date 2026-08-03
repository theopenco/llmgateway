import { afterEach, describe, expect, it } from "vitest";

import { redactedProviderErrorText } from "@/lib/stealth-provider-errors.js";

import { clientFacingUpstreamMessage } from "./upstream-error.js";

const savedStealthBaseUrl = process.env.LLM_AVALANCHE_BASE_URL;

afterEach(() => {
	if (savedStealthBaseUrl === undefined) {
		delete process.env.LLM_AVALANCHE_BASE_URL;
	} else {
		process.env.LLM_AVALANCHE_BASE_URL = savedStealthBaseUrl;
	}
});

describe("clientFacingUpstreamMessage", () => {
	it("redacts the raw upstream error for stealth providers", () => {
		process.env.LLM_AVALANCHE_BASE_URL =
			"https://plataforma-secreta.example.com";

		const message = clientFacingUpstreamMessage(
			"avalanche",
			500,
			"quota exceeded at https://plataforma-secreta.example.com",
		);

		expect(message).toBe(redactedProviderErrorText(500));
		expect(message).not.toContain("plataforma-secreta");
		expect(message).not.toContain("quota");
	});

	it("passes the raw upstream error through for non-stealth providers", () => {
		const raw = "quota exceeded at https://api.openai.com/v1";

		expect(clientFacingUpstreamMessage("openai", 500, raw)).toBe(raw);
	});

	it("passes the raw upstream error through when the provider is unknown", () => {
		const raw = "quota exceeded at https://plataforma-secreta.example.com";

		expect(clientFacingUpstreamMessage(undefined, 500, raw)).toBe(raw);
	});
});
