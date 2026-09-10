import { describe, expect, it } from "vitest";

import { providerBaseUrlHasEndpointPath } from "./custom-providers.js";

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
