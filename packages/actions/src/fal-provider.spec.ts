import { afterEach, describe, expect, it, vi } from "vitest";

import { models } from "@llmgateway/models";

import { getProviderSelectionPrice } from "./get-cheapest-from-available-providers.js";
import {
	getProviderDefaultBaseUrl,
	getProviderEndpoint,
} from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";

afterEach(() => vi.unstubAllEnvs());

describe("fal provider", () => {
	it("uses Key authentication and preserves request correlation", () => {
		expect(
			getProviderHeaders("fal-ai", "test-token", { requestId: "req-1" }),
		).toEqual({
			Authorization: "Key test-token",
			"x-request-id": "req-1",
		});
	});

	it("returns the queue root rather than an OpenAI chat endpoint", () => {
		vi.stubEnv("LLM_FAL_AI_BASE_URL", undefined);
		expect(getProviderDefaultBaseUrl("fal-ai")).toBe("https://queue.fal.run");
		expect(getProviderEndpoint("fal-ai", undefined, "flux-3-max")).toBe(
			"https://queue.fal.run",
		);
	});

	it("resolves explicit, managed and environment base URLs in precedence order", () => {
		vi.stubEnv("LLM_FAL_AI_BASE_URL", "https://env.example/queue");
		expect(getProviderEndpoint("fal-ai")).toBe("https://env.example/queue");
		const options = {
			env_config: { baseUrl: "https://managed.example/queue" },
		};
		expect(
			getProviderEndpoint(
				"fal-ai",
				undefined,
				"flux-3-max",
				undefined,
				false,
				undefined,
				undefined,
				options,
			),
		).toBe("https://managed.example/queue");
		expect(
			getProviderEndpoint(
				"fal-ai",
				"https://explicit.example/queue",
				"flux-3-max",
				undefined,
				false,
				undefined,
				undefined,
				options,
			),
		).toBe("https://explicit.example/queue");
	});

	it("does not leak platform base URL overrides into BYOK", () => {
		vi.stubEnv("LLM_FAL_AI_BASE_URL", "https://platform.example/queue");
		expect(
			getProviderEndpoint(
				"fal-ai",
				undefined,
				"flux-3-max",
				undefined,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true,
			),
		).toBe("https://queue.fal.run");
	});

	it.each([
		["720p", false, "0.85"],
		["720p", true, "0.85"],
		["1080p", false, "1.45"],
		["1080p", true, "1.45"],
	] as const)(
		"prices five seconds at list rates for %s audio=%s",
		(resolution, includeAudio, expected) => {
			const mapping = models
				.find((model) => model.id === "flux-3-max")
				?.providers.find((provider) => provider.providerId === "fal-ai");
			expect(mapping).toBeDefined();
			expect(
				getProviderSelectionPrice(mapping, {
					durationSeconds: 5,
					resolution,
					includeAudio,
				}).toString(),
			).toBe(expected);
		},
	);
});
