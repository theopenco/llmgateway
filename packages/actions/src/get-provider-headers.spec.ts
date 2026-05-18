import { afterEach, describe, expect, it } from "vitest";

import { getProviderHeaders } from "./get-provider-headers.js";

const originalVertexTokenType = process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE;
const originalQuartzTokenType = process.env.LLM_QUARTZ_TOKEN_TYPE;

afterEach(() => {
	if (originalVertexTokenType === undefined) {
		delete process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE;
	} else {
		process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = originalVertexTokenType;
	}

	if (originalQuartzTokenType === undefined) {
		delete process.env.LLM_QUARTZ_TOKEN_TYPE;
	} else {
		process.env.LLM_QUARTZ_TOKEN_TYPE = originalQuartzTokenType;
	}
});

describe("getProviderHeaders", () => {
	describe("google-vertex", () => {
		it("returns no auth header by default (api-key mode)", () => {
			expect(
				getProviderHeaders("google-vertex", "AIzaSyExampleApiKey"),
			).toEqual({});
		});

		it("uses Bearer when the provider key is configured for OAuth", () => {
			expect(
				getProviderHeaders("google-vertex", "ya29.example", {
					providerKeyOptions: { google_vertex_token_type: "oauth" },
				}),
			).toEqual({
				Authorization: "Bearer ya29.example",
			});
		});

		it("omits the Authorization header when the provider key uses an API key", () => {
			expect(
				getProviderHeaders("google-vertex", "AIzaSyExample", {
					providerKeyOptions: { google_vertex_token_type: "api-key" },
				}),
			).toEqual({});
		});

		it("honors the LLM_GOOGLE_VERTEX_TOKEN_TYPE env var when no key option is set", () => {
			process.env.LLM_GOOGLE_VERTEX_TOKEN_TYPE = "oauth";

			expect(getProviderHeaders("google-vertex", "ya29.example")).toEqual({
				Authorization: "Bearer ya29.example",
			});
		});

		it("includes the request id when token type is api-key", () => {
			expect(
				getProviderHeaders("google-vertex", "AIzaSyExample", {
					requestId: "req-1",
				}),
			).toEqual({
				"x-request-id": "req-1",
			});
		});
	});

	describe("quartz", () => {
		it("returns no auth header by default (api-key mode)", () => {
			expect(getProviderHeaders("quartz", "quartz-api-key")).toEqual({});
		});

		it("uses Bearer when the provider key is configured for OAuth", () => {
			expect(
				getProviderHeaders("quartz", "ya29.example", {
					providerKeyOptions: { quartz_token_type: "oauth" },
				}),
			).toEqual({
				Authorization: "Bearer ya29.example",
			});
		});

		it("omits the auth header when the provider key uses an API key", () => {
			expect(
				getProviderHeaders("quartz", "quartz-api-key", {
					providerKeyOptions: { quartz_token_type: "api-key" },
				}),
			).toEqual({});
		});

		it("honors the LLM_QUARTZ_TOKEN_TYPE env var when no key option is set", () => {
			process.env.LLM_QUARTZ_TOKEN_TYPE = "api-key";

			expect(getProviderHeaders("quartz", "ya29.example")).toEqual({});
		});
	});
});
