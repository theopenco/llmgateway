import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	isProviderCircuitOpen,
	openCircuitOnUpstreamFailure,
	openProviderCircuit,
	providerCapabilityContext,
} from "./provider-circuit-breaker.js";

import type { ProviderModelMapping } from "@llmgateway/models";

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: vi.fn(),
		set: vi.fn(),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

const mockCache = await import("@llmgateway/cache");
const redis = mockCache.redisClient;

describe("provider circuit breaker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reports a circuit closed when no entry exists", async () => {
		vi.mocked(redis.get).mockResolvedValue(null);
		await expect(
			isProviderCircuitOpen("orgA", "runware", "deepseek-v4-flash", "x"),
		).resolves.toBe(false);
		expect(redis.get).toHaveBeenCalledWith(
			"circuit:provider:orgA:runware:deepseek-v4-flash:x",
		);
	});

	it("reports a circuit open when an entry exists", async () => {
		vi.mocked(redis.get).mockResolvedValue("1");
		await expect(
			isProviderCircuitOpen("orgA", "runware", "deepseek-v4-flash"),
		).resolves.toBe(true);
	});

	it("writes an open circuit with a TTL", async () => {
		await openProviderCircuit("orgA", "runware", "deepseek-v4-flash", "us");
		expect(redis.set).toHaveBeenCalledWith(
			"circuit:provider:orgA:runware:deepseek-v4-flash:us",
			"1",
			"EX",
			expect.any(Number),
		);
	});

	it("does not trip on client errors (4xx)", async () => {
		await openCircuitOnUpstreamFailure("orgA", "runware", "deepseek", 400);
		expect(redis.set).not.toHaveBeenCalled();
	});

	it("trips on server errors but not rate limits", async () => {
		await openCircuitOnUpstreamFailure("orgA", "runware", "deepseek", 503);
		expect(redis.set).toHaveBeenCalled();
		vi.clearAllMocks();
		await openCircuitOnUpstreamFailure("orgA", "runware", "deepseek", 429);
		expect(redis.set).not.toHaveBeenCalled();
	});

	it("trips on unknown status (network failure)", async () => {
		await openCircuitOnUpstreamFailure(
			"orgA",
			"runware",
			"deepseek",
			undefined,
		);
		expect(redis.set).toHaveBeenCalled();
	});

	it("trips on a 400 when the mapping cannot serve the requested capability", async () => {
		// Runware-style: `supportsAssistantPrefill: false` while the request
		// ends on an assistant turn ("a conversation cannot end on an assistant turn").
		await openCircuitOnUpstreamFailure(
			"orgA",
			"runware",
			"deepseek-v4-pro",
			400,
			undefined,
			{
				supportsAssistantPrefill: false,
				jsonOutput: false,
				jsonOutputSchema: true,
				hasAssistantPrefill: true,
				responseFormatType: undefined,
			},
		);
		expect(redis.set).toHaveBeenCalled();
	});

	it("does not trip on a 400 when the request did not use the unsupported capability", async () => {
		await openCircuitOnUpstreamFailure(
			"orgA",
			"runware",
			"deepseek-v4-pro",
			400,
			undefined,
			{
				supportsAssistantPrefill: false,
				jsonOutput: false,
				jsonOutputSchema: true,
				hasAssistantPrefill: false,
				responseFormatType: "text",
			},
		);
		expect(redis.set).not.toHaveBeenCalled();
	});

	it("builds the capability context from the used provider mapping", () => {
		const context = providerCapabilityContext(
			[
				{
					providerId: "runware",
					externalId: "deepseek-v4-flash",
					supportsAssistantPrefill: false,
					jsonOutput: false,
					jsonOutputSchema: true,
				},
				{
					providerId: "deepinfra",
					externalId: "deepseek-v4-flash",
					supportsAssistantPrefill: true,
					jsonOutput: true,
					jsonOutputSchema: true,
				},
			] as ProviderModelMapping[],
			"runware",
			true,
			"text",
		);
		expect(context).toEqual({
			supportsAssistantPrefill: false,
			jsonOutput: false,
			jsonOutputSchema: true,
			hasAssistantPrefill: true,
			responseFormatType: "text",
		});
	});
});
