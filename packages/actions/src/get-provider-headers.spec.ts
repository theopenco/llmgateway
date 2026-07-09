import { afterEach, describe, expect, it } from "vitest";

import { getProviderHeaders } from "./get-provider-headers.js";

const originalVertexTokenType = process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE;

afterEach(() => {
	if (originalVertexTokenType === undefined) {
		delete process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE;
	} else {
		process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = originalVertexTokenType;
	}
});

describe("getProviderHeaders", () => {
	describe("google-vertex", () => {
		it("returns no auth header by default (api-key mode)", () => {
			expect(
				getProviderHeaders("google-vertex", "AIzaSyExampleApiKey"),
			).toEqual({});
		});

		it("uses Bearer when the provider key is configured for oauth", () => {
			expect(
				getProviderHeaders("google-vertex", "ya29.example", {
					providerKeyOptions: { google_vertex_token_type: "oauth" },
				}),
			).toEqual({ Authorization: "Bearer ya29.example" });
		});

		it("omits the Authorization header when the provider key uses api-key", () => {
			expect(
				getProviderHeaders("google-vertex", "AIzaSyExample", {
					providerKeyOptions: { google_vertex_token_type: "api-key" },
				}),
			).toEqual({});
		});

		it("honors LLM_GOOGLE_VERTEX_TOKEN_TYPE env var when no key option is set", () => {
			process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "oauth";

			expect(getProviderHeaders("google-vertex", "ya29.example")).toEqual({
				Authorization: "Bearer ya29.example",
			});
		});

		it("ignores the env var when skipEnvVars is true (BYOK), matching the endpoint", () => {
			process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "oauth";

			expect(
				getProviderHeaders("google-vertex", "AIzaSyExample", {
					providerKeyOptions: { google_vertex_project_id: "project-a" },
					skipEnvVars: true,
				}),
			).toEqual({});
		});

		it("still honors an explicit oauth key option when skipEnvVars is true", () => {
			expect(
				getProviderHeaders("google-vertex", "ya29.example", {
					providerKeyOptions: { google_vertex_token_type: "oauth" },
					skipEnvVars: true,
				}),
			).toEqual({ Authorization: "Bearer ya29.example" });
		});

		it("uses a pre-resolved tokenType over options and env var", () => {
			process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "api-key";

			expect(
				getProviderHeaders("google-vertex", "ya29.example", {
					providerKeyOptions: { google_vertex_token_type: "api-key" },
					tokenType: "oauth",
				}),
			).toEqual({ Authorization: "Bearer ya29.example" });
		});

		it("uses a pre-resolved api-key tokenType to suppress the Bearer header", () => {
			process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "oauth";

			expect(
				getProviderHeaders("google-vertex", "AIzaSyExample", {
					providerKeyOptions: { google_vertex_token_type: "oauth" },
					tokenType: "api-key",
				}),
			).toEqual({});
		});
	});

	describe("quartz", () => {
		it("never sends an Authorization header (api-key only, no OAuth)", () => {
			expect(getProviderHeaders("quartz", "quartz-api-key")).toEqual({});
			expect(getProviderHeaders("quartz", "ya29.looks-like-oauth")).toEqual({});
		});
	});
});

const VERTEX_TIER_HEADER = "X-Vertex-AI-LLM-Shared-Request-Type";
const VERTEX_REQUEST_TYPE_HEADER = "X-Vertex-AI-LLM-Request-Type";

describe("getProviderHeaders - Google Vertex service tiers", () => {
	it("sets the flex shared-request-type header for google-vertex", () => {
		const headers = getProviderHeaders("google-vertex", "token", {
			serviceTier: "flex",
		});
		expect(headers[VERTEX_TIER_HEADER]).toBe("flex");
		// Bypass Provisioned Throughput so the shared Flex tier is actually used.
		expect(headers[VERTEX_REQUEST_TYPE_HEADER]).toBe("shared");
	});

	it("sets the priority shared-request-type header for google-vertex", () => {
		const headers = getProviderHeaders("google-vertex", "token", {
			serviceTier: "priority",
		});
		expect(headers[VERTEX_TIER_HEADER]).toBe("priority");
		expect(headers[VERTEX_REQUEST_TYPE_HEADER]).toBe("shared");
	});

	it("omits the headers for the standard/default tier", () => {
		expect(
			getProviderHeaders("google-vertex", "token", { serviceTier: "default" })[
				VERTEX_TIER_HEADER
			],
		).toBeUndefined();
		expect(
			getProviderHeaders("google-vertex", "token", { serviceTier: "default" })[
				VERTEX_REQUEST_TYPE_HEADER
			],
		).toBeUndefined();
		expect(
			getProviderHeaders("google-vertex", "token", { serviceTier: "auto" })[
				VERTEX_TIER_HEADER
			],
		).toBeUndefined();
	});

	it("omits the headers when no service tier is provided", () => {
		const headers = getProviderHeaders("google-vertex", "token");
		expect(headers[VERTEX_TIER_HEADER]).toBeUndefined();
		expect(headers[VERTEX_REQUEST_TYPE_HEADER]).toBeUndefined();
	});

	it("preserves the request id alongside the tier header", () => {
		const headers = getProviderHeaders("google-vertex", "token", {
			serviceTier: "priority",
			requestId: "req-123",
		});
		expect(headers[VERTEX_TIER_HEADER]).toBe("priority");
		expect(headers["x-request-id"]).toBe("req-123");
	});

	it("does not set the Vertex tier header for other providers", () => {
		const openai = getProviderHeaders("openai", "token", {
			serviceTier: "priority",
		});
		expect(openai[VERTEX_TIER_HEADER]).toBeUndefined();
		expect(openai.Authorization).toBe("Bearer token");

		const aiStudio = getProviderHeaders("google-ai-studio", "token", {
			serviceTier: "flex",
		});
		expect(aiStudio[VERTEX_TIER_HEADER]).toBeUndefined();

		const quartz = getProviderHeaders("quartz", "token", {
			serviceTier: "flex",
		});
		expect(quartz[VERTEX_TIER_HEADER]).toBeUndefined();
	});
});
