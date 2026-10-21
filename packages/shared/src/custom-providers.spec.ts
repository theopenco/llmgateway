import { describe, expect, it, afterEach, vi } from "vitest";

import {
	providerBaseUrlHasEndpointPath,
	isProviderBaseUrlOverrideAllowed,
} from "./custom-providers.js";

describe("providerBaseUrlHasEndpointPath", () => {
	it("accepts a bare base URL", () => {
		expect(providerBaseUrlHasEndpointPath("https://api.acme.ai")).toBe(false);
		expect(providerBaseUrlHasEndpointPath("https://api.acme.ai/")).toBe(false);
		expect(providerBaseUrlHasEndpointPath("https://acme.ai/openai")).toBe(
			false,
		);
	});

	it("rejects a URL that already carries the endpoint path", () => {
		expect(providerBaseUrlHasEndpointPath("https://api.acme.ai/v1")).toBe(true);
		expect(providerBaseUrlHasEndpointPath("https://api.acme.ai/V1/")).toBe(
			true,
		);
		expect(
			providerBaseUrlHasEndpointPath("https://api.acme.ai/v1/chat/completions"),
		).toBe(true);
		expect(
			providerBaseUrlHasEndpointPath("https://acme.ai/openai/chat/completions"),
		).toBe(true);
	});

	it("sees through percent-encoded paths", () => {
		expect(providerBaseUrlHasEndpointPath("https://api.acme.ai/%76%31")).toBe(
			true,
		);
		expect(
			providerBaseUrlHasEndpointPath("https://api.acme.ai/chat%2Fcompletions"),
		).toBe(true);
		expect(providerBaseUrlHasEndpointPath("https://api.acme.ai/%zz/v1")).toBe(
			true,
		);
		expect(providerBaseUrlHasEndpointPath("https://api.acme.ai/%zz")).toBe(
			false,
		);
	});

	it("leaves unparsable input to the URL validator", () => {
		expect(providerBaseUrlHasEndpointPath("not a url")).toBe(false);
	});
});

describe("isProviderBaseUrlOverrideAllowed", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("allows the override when self-hosted", () => {
		vi.stubEnv("ALLOW_PROVIDER_BASE_URL_OVERRIDE", "");
		vi.stubEnv("HOSTED", "");
		expect(isProviderBaseUrlOverrideAllowed()).toBe(true);
	});

	it("disallows the override on the hosted service", () => {
		vi.stubEnv("ALLOW_PROVIDER_BASE_URL_OVERRIDE", "");
		vi.stubEnv("HOSTED", "true");
		expect(isProviderBaseUrlOverrideAllowed()).toBe(false);
	});

	it("lets the flag override either default", () => {
		vi.stubEnv("HOSTED", "true");
		vi.stubEnv("ALLOW_PROVIDER_BASE_URL_OVERRIDE", "true");
		expect(isProviderBaseUrlOverrideAllowed()).toBe(true);

		vi.stubEnv("HOSTED", "");
		vi.stubEnv("ALLOW_PROVIDER_BASE_URL_OVERRIDE", "false");
		expect(isProviderBaseUrlOverrideAllowed()).toBe(false);
	});
});
