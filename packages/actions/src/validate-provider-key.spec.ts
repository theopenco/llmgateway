import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "@llmgateway/logger";
import { models } from "@llmgateway/models";

import {
	getValidationModel,
	pickCheapestRecentModel,
	validateProviderKey,
} from "./validate-provider-key.js";

describe("getValidationModel", () => {
	it("never selects an OCR model for provider key validation", () => {
		// The OCR model has zero token prices, which would otherwise make it the
		// cheapest (first) candidate. It must be excluded so key validation calls
		// the chat-completions endpoint with a real chat model.
		const selected = getValidationModel("mistral");
		expect(selected).not.toBeNull();
		expect(selected?.modelId).not.toBe("mistral-ocr-latest");

		const selectedDef = models.find((m) => m.id === selected?.modelId);
		const usesOcr = selectedDef?.providers.some(
			(p) => p.providerId === "mistral" && (p as { ocr?: boolean }).ocr,
		);
		expect(usesOcr).toBeFalsy();
	});

	it("selects a model from the newer half of the provider's releases", () => {
		const selected = getValidationModel("openai");
		expect(selected).not.toBeNull();

		const selectedDef = models.find((m) => m.id === selected?.modelId);
		const releasedAt =
			selectedDef && "releasedAt" in selectedDef
				? (selectedDef.releasedAt as Date | undefined)
				: undefined;
		expect(releasedAt).toBeDefined();

		const datedReleases = models
			.filter((m) => "releasedAt" in m && m.releasedAt !== undefined)
			.filter((m) =>
				m.providers.some(
					(p) =>
						p.providerId === "openai" &&
						!("deprecatedAt" in p && p.deprecatedAt) &&
						!("deactivatedAt" in p && p.deactivatedAt),
				),
			)
			.map((m) => (m.releasedAt as Date).getTime());
		const olderOrSame = datedReleases.filter(
			(t) => t <= releasedAt!.getTime(),
		).length;
		// The pick must not be in the older half of the catalog
		expect(olderOrSame * 2).toBeGreaterThanOrEqual(datedReleases.length);
	});
});

describe("pickCheapestRecentModel", () => {
	it("returns undefined for an empty list", () => {
		expect(pickCheapestRecentModel([])).toBeUndefined();
	});

	it("picks the cheapest recent model over a cheaper outdated one", () => {
		const picked = pickCheapestRecentModel([
			{ id: "old-cheap", price: 0.1, releasedAt: new Date("2024-01-01") },
			{ id: "older", price: 0.5, releasedAt: new Date("2023-06-01") },
			{ id: "new-cheap", price: 0.3, releasedAt: new Date("2025-05-01") },
			{ id: "new-pricey", price: 2, releasedAt: new Date("2025-06-01") },
		]);
		expect(picked?.id).toBe("new-cheap");
	});

	it("falls back to the cheapest model when release dates are unknown", () => {
		const picked = pickCheapestRecentModel([
			{ id: "pricey", price: 2 },
			{ id: "cheap", price: 0.1 },
		]);
		expect(picked?.id).toBe("cheap");
	});

	it("ignores undated models when dated candidates exist", () => {
		const picked = pickCheapestRecentModel([
			{ id: "undated-cheap", price: 0.01 },
			{ id: "new", price: 1, releasedAt: new Date("2025-05-01") },
			{ id: "old", price: 0.5, releasedAt: new Date("2023-01-01") },
		]);
		expect(picked?.id).toBe("new");
	});
});

describe("validateProviderKey error reporting", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function mockUpstream(status: number, body: unknown) {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}

	// A provider can answer 401 for a perfectly valid key that simply lacks
	// entitlement to the validation model (AWS Bedrock does exactly this). The
	// reason must reach the caller instead of being flattened into a generic
	// "invalid API key", which sends users chasing the wrong problem.
	it("forwards the upstream message on a 401", async () => {
		const message =
			"openai.gpt-5.6-luna is not available for this account. You can explore other available models on Amazon Bedrock.";
		mockUpstream(401, { error: { message } });

		const result = await validateProviderKey(
			"aws-mantle",
			"ABSKtest",
			undefined,
			false,
		);

		expect(result.valid).toBe(false);
		expect(result.statusCode).toBe(401);
		expect(result.error).toBe(message);
	});

	it("still forwards the upstream message on non-401 failures", async () => {
		mockUpstream(429, { error: { message: "Rate limit exceeded" } });

		const result = await validateProviderKey(
			"openai",
			"sk-test",
			undefined,
			false,
		);

		expect(result.valid).toBe(false);
		expect(result.statusCode).toBe(429);
		expect(result.error).toBe("Rate limit exceeded");
	});

	// An Azure resource name that does not resolve is bad tenant input, not a
	// gateway fault: it used to surface as a bare "fetch failed" and page us via
	// an error-level log. It must read as an unreachable endpoint and log at warn.
	it("explains a connectivity failure instead of 'fetch failed'", async () => {
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new TypeError("fetch failed", {
				cause: Object.assign(
					new Error("getaddrinfo ENOTFOUND api.openai.com"),
					{ code: "ENOTFOUND" },
				),
			}),
		);

		const result = await validateProviderKey(
			"openai",
			"sk-test",
			undefined,
			false,
		);

		expect(result.valid).toBe(false);
		expect(result.unreachable).toBe(true);
		expect(result.error).toContain("api.openai.com");
		expect(result.error).not.toBe("fetch failed");
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("falls back to status text when the body carries no message", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("not json", { status: 401, statusText: "Unauthorized" }),
		);

		const result = await validateProviderKey(
			"openai",
			"sk-test",
			undefined,
			false,
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBe("401 Unauthorized");
	});
});

describe("validateProviderKey region resolution", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// Covers the whole BYOK chain rather than just the endpoint helper: the
	// region stored on the provider key must reach the Mantle URL. Region-aware
	// providers resolve it from regionConfig.optionsKey, so a break anywhere
	// between the stored option and the request would silently send traffic to
	// the default region.
	it.each([
		{ region: "us-east-1" as const },
		{ region: "us-east-2" as const },
		{ region: "us-west-2" as const },
	])(
		"sends validation to $region when the provider key selects it",
		async ({ region }) => {
			const fetchMock = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(new Response("{}", { status: 200 }));

			const result = await validateProviderKey(
				"aws-mantle",
				"ABSKtest",
				undefined,
				false,
				{ aws_mantle_region: region },
			);

			expect(result.valid).toBe(true);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(fetchMock.mock.calls[0][0]).toBe(
				`https://bedrock-mantle.${region}.api.aws/openai/v1/responses`,
			);
		},
	);

	// Sol is not deployed to us-west-2, so a key pinned there must validate
	// against a model that actually exists in the region.
	it("picks a us-west-2 model when the key is pinned to us-west-2", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));

		const result = await validateProviderKey(
			"aws-mantle",
			"ABSKtest",
			undefined,
			false,
			{ aws_mantle_region: "us-west-2" },
		);

		expect(result.model).not.toBe("gpt-5.6-sol");
		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(body.model).not.toBe("openai.gpt-5.6-sol");
	});
});

describe("validateProviderKey credential hygiene", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// Google AI Studio and Vertex in api-key mode carry the credential in the
	// query string (`?key=<token>`), so the endpoint string is not safe to log
	// verbatim. The warn/error sites in the same function already run it through
	// redactToken; the debug line did not.
	//
	// Production defaults to `info`, so this did not leak there by default — but
	// development defaults to `debug`, and turning debug on to troubleshoot a
	// failing provider key is exactly when it would have fired.
	it("keeps the api key out of the debug log for google-ai-studio", async () => {
		const token = "AIzaSyTESTKEYdoNotUse0123456789abcdefg";
		const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));

		await validateProviderKey("google-ai-studio", token);

		// The key really is in the URL — without this the test would pass
		// vacuously if the endpoint ever stopped carrying it.
		expect(String(fetchMock.mock.calls[0][0])).toContain(`key=${token}`);

		const logged = JSON.stringify(debugSpy.mock.calls);
		expect(logged).not.toContain(token);
		expect(logged).toContain("[REDACTED_TOKEN]");
	});
});
