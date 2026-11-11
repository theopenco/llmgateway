import { describe, expect, it } from "vitest";

import {
	buildBenchmarkTargets,
	fetchGatewayMappingDescriptors,
	gatewayMappingDescriptors,
	gatewayModelsUrl,
	resolveBenchmarkTargets,
} from "./targets.js";

describe("gateway catalogue descriptors", () => {
	it("marks pairs missing from the static catalogue as Airside and expands regions", () => {
		const descriptors = gatewayMappingDescriptors({
			id: "deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			providers: [
				{
					providerId: "deepinfra",
					externalId: "deepseek-ai/DeepSeek-V4-Flash",
				},
				{
					providerId: "airside-carrier",
					externalId: "DeepSeek-V4-Flash",
					pricing: { prompt: "1e-7", completion: "2e-7" },
					regions: [{ id: "eu", pricing: { prompt: "2e-7" } }],
				},
			],
		});
		expect(
			descriptors.map((descriptor) => [
				descriptor.providerId,
				descriptor.region,
				descriptor.source,
				descriptor.inputPrice,
				descriptor.outputPrice,
			]),
		).toEqual([
			["deepinfra", null, "catalogue", null, null],
			["airside-carrier", null, "airside", "1e-7", "2e-7"],
			["airside-carrier", "eu", "airside", "2e-7", "2e-7"],
		]);
	});

	it("skips deactivated gateway mappings unless asked", () => {
		const descriptors = gatewayMappingDescriptors({
			id: "deepseek-v4-flash",
			providers: [
				{ providerId: "deepinfra", externalId: "a" },
				{
					providerId: "fireworks",
					externalId: "b",
					deactivated_at: "2020-01-01T00:00:00.000Z",
				},
			],
		});
		expect(
			buildBenchmarkTargets({ descriptors }).map((target) => target.id),
		).toEqual(["deepinfra/deepseek-v4-flash"]);
		expect(() =>
			buildBenchmarkTargets({ descriptors, mappings: ["fireworks"] }),
		).toThrow("No selected model has mapping(s): fireworks");
	});

	it("derives the models URL from the chat-completions URL", () => {
		expect(gatewayModelsUrl("http://127.0.0.1:4001/v1/chat/completions")).toBe(
			"http://127.0.0.1:4001/v1/models?include_deactivated=true",
		);
	});

	it("rejects a model the gateway does not list", async () => {
		await expect(
			fetchGatewayMappingDescriptors({
				modelIds: ["missing-model"],
				modelsUrl: "http://gateway.test/v1/models",
				fetch: async () => Response.json({ data: [] }),
			}),
		).rejects.toThrow("Unknown model: missing-model");
	});
});

describe("resolveBenchmarkTargets", () => {
	it("resolves selected provider mappings to pinned model ids", () => {
		const targets = resolveBenchmarkTargets({
			modelIds: ["deepseek-v4-pro"],
			mappings: ["deepinfra", "canopywave"],
		});
		expect(targets.map((target) => target.id)).toEqual([
			"deepinfra/deepseek-v4-pro",
			"canopywave/deepseek-v4-pro",
		]);
	});

	it("rejects unknown mappings", () => {
		expect(() =>
			resolveBenchmarkTargets({
				modelIds: ["deepseek-v4-pro"],
				mappings: ["not-a-provider"],
			}),
		).toThrow("No selected model has mapping(s): not-a-provider");
	});
});
