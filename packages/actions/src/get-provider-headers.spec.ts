import { describe, expect, it } from "vitest";

import { getProviderHeaders } from "./get-provider-headers.js";

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
