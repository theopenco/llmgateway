import { describe, expect, it } from "vitest";

import { getProviderHeaders } from "./get-provider-headers.js";
import {
	createUpstreamClientRequestId,
	getUpstreamRequestId,
} from "./upstream-request-id.js";

const ID_PATTERN = /^lgr_[0-9A-Za-z]{20}$/;

describe("createUpstreamClientRequestId", () => {
	it("creates a fresh lgr_ id for OpenAI and Azure", () => {
		const ids = new Set(
			Array.from({ length: 50 }, () => createUpstreamClientRequestId("openai")),
		);
		expect(ids.size).toBe(50);
		for (const id of ids) {
			expect(id).toMatch(ID_PATTERN);
		}
		expect(createUpstreamClientRequestId("azure")).toMatch(ID_PATTERN);
	});

	it("returns null for providers without a documented header", () => {
		expect(createUpstreamClientRequestId("anthropic")).toBeNull();
		expect(createUpstreamClientRequestId("google-ai-studio")).toBeNull();
	});
});

describe("getProviderHeaders clientRequestId", () => {
	it("sends X-Client-Request-Id to OpenAI", () => {
		expect(
			getProviderHeaders("openai", "token", { clientRequestId: "lgr_abc" }),
		).toMatchObject({ "X-Client-Request-Id": "lgr_abc" });
	});

	it("sends x-ms-client-request-id to Azure", () => {
		const headers = getProviderHeaders("azure", "token", {
			clientRequestId: "lgr_abc",
		});
		expect(headers).toMatchObject({ "x-ms-client-request-id": "lgr_abc" });
		expect(headers).not.toHaveProperty("X-Client-Request-Id");
	});

	it("sends nothing to providers without a documented header", () => {
		const headers = getProviderHeaders("anthropic", "token", {
			clientRequestId: "lgr_abc",
		});
		expect(Object.values(headers)).not.toContain("lgr_abc");
	});
});

describe("getUpstreamRequestId", () => {
	it("reads the provider's x-request-id", () => {
		expect(
			getUpstreamRequestId(
				"openai",
				new Headers({ "x-request-id": "req_123" }),
			),
		).toBe("req_123");
	});

	it("ignores missing, oversized, or non-printable values and other providers", () => {
		expect(getUpstreamRequestId("openai", new Headers())).toBeNull();
		expect(getUpstreamRequestId("openai", undefined)).toBeNull();
		expect(
			getUpstreamRequestId(
				"openai",
				new Headers({ "x-request-id": "x".repeat(129) }),
			),
		).toBeNull();
		expect(
			getUpstreamRequestId("openai", new Headers({ "x-request-id": "a b" })),
		).toBeNull();
		expect(
			getUpstreamRequestId(
				"anthropic",
				new Headers({ "x-request-id": "req_123" }),
			),
		).toBeNull();
	});
});
