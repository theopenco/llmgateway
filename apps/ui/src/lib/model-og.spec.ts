import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPublicModelDefinition } from "./airside-model-fallback";
import { fetchModelDiscounts, fetchProviders } from "./fetch-models";
import { getModelOgData } from "./model-og";

import type { ModelDefinition } from "@llmgateway/models";
import type { ApiProvider } from "@llmgateway/shared/components";

vi.mock("./airside-model-fallback", () => ({
	findPublicModelDefinition: vi.fn(),
}));
vi.mock("./fetch-models", () => ({
	fetchProviders: vi.fn(),
	fetchModelDiscounts: vi.fn(),
}));

const liveModel: ModelDefinition = {
	id: "approved-airside-model",
	name: "Approved model",
	family: "mistral",
	providers: [
		{
			providerId: "mistral",
			externalId: "approved-airside-model",
			inputPrice: "9e-6",
			outputPrice: "18e-6",
			streaming: true,
		},
	],
};
const liveProvider: ApiProvider = {
	id: "mistral",
	name: "Approved provider",
	createdAt: "2026-09-08T00:00:00Z",
	description: null,
	streaming: true,
	cancellation: null,
	color: null,
	website: null,
	announcement: null,
	status: "active",
};

describe("model OG data", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(findPublicModelDefinition).mockResolvedValue(liveModel);
		vi.mocked(fetchProviders).mockResolvedValue([liveProvider]);
		vi.mocked(fetchModelDiscounts).mockResolvedValue([]);
	});

	it.each([
		{ modelId: "gpt-4o", providerId: "openai" },
		{ modelId: "gpt-image-2", providerId: "openai" },
		{ modelId: "gpt-4o", providerId: "mistral" },
		{ modelId: "gpt-image-2", providerId: "mistral" },
		{ modelId: "approved-airside-model", providerId: "mistral" },
	] as const)(
		"keeps API pricing for $modelId on $providerId",
		async ({ modelId, providerId }) => {
			const expected = {
				...liveModel,
				id: modelId,
				providers: liveModel.providers.map((mapping) => ({
					...mapping,
					providerId,
				})),
			};
			vi.mocked(findPublicModelDefinition).mockResolvedValue(expected);

			const result = await getModelOgData(modelId, providerId);

			expect(result.model).toBe(expected);
			expect(result.providers).toEqual([liveProvider]);
			expect(findPublicModelDefinition).toHaveBeenCalledWith(modelId);
			expect(fetchModelDiscounts).toHaveBeenCalledWith(modelId, 60);
		},
	);

	it.each(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"])(
		"uses the catalogue snapshot for %s on OpenAI",
		async (modelId) => {
			const result = await getModelOgData(modelId, "openai");

			expect(result.model?.id).toBe(modelId);
			expect(result.model?.providers[0]?.providerId).toBe("openai");
			expect(result.providers).toEqual([]);
			expect(findPublicModelDefinition).not.toHaveBeenCalled();
			expect(fetchProviders).not.toHaveBeenCalled();
			expect(fetchModelDiscounts).toHaveBeenCalledWith(modelId, false);
		},
	);

	it.each(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"])(
		"keeps additional AirSide mappings live for %s",
		async (modelId) => {
			const expected = { ...liveModel, id: modelId };
			vi.mocked(findPublicModelDefinition).mockResolvedValue(expected);

			const result = await getModelOgData(modelId, "mistral");

			expect(result.model).toBe(expected);
			expect(result.providers).toEqual([liveProvider]);
			expect(fetchModelDiscounts).toHaveBeenCalledWith(modelId, 60);
		},
	);

	it("reflects API fare updates on subsequent loads", async () => {
		const updatedModel = {
			...liveModel,
			providers: liveModel.providers.map((mapping) => ({
				...mapping,
				outputPrice: "12e-6",
			})),
		};
		vi.mocked(findPublicModelDefinition)
			.mockResolvedValueOnce(liveModel)
			.mockResolvedValueOnce(updatedModel);

		const before = await getModelOgData(liveModel.id, "mistral");
		const after = await getModelOgData(liveModel.id, "mistral");

		expect(before.model?.providers[0]?.outputPrice).toBe("18e-6");
		expect(after.model?.providers[0]?.outputPrice).toBe("12e-6");
	});
});
