import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, eq, getEffectiveProviders, tables } from "@llmgateway/db";
import {
	getCompliantProvidersForModel,
	models,
	type ModelMappingAvailability,
	type ProviderCompliancePolicy,
} from "@llmgateway/models";

import { getModelAvailability } from "./compliance-alerts.js";

const modelId = "claude-fable-5-2";
const providerIds = ["anthropic", "aws-bedrock"];

const zeroDataRetention: ProviderCompliancePolicy = {
	enabled: true,
	zeroDataRetention: true,
};
const blockPromptLogging: ProviderCompliancePolicy = {
	enabled: true,
	blockPromptLogging: true,
};

describe("getModelAvailability", () => {
	beforeEach(async () => {
		await db
			.insert(tables.model)
			.values({ id: modelId, name: modelId, family: "anthropic" })
			.onConflictDoNothing();
		await db
			.insert(tables.provider)
			.values(
				providerIds.map((id) => ({
					id,
					name: id,
					description: id,
					streaming: true,
					cancellation: true,
					color: "#000000",
					website: "https://example.com",
				})),
			)
			.onConflictDoNothing();
		await db
			.delete(tables.modelProviderMapping)
			.where(eq(tables.modelProviderMapping.modelId, modelId));
		await db.insert(tables.modelProviderMapping).values(
			providerIds.map((providerId) => ({
				modelId,
				providerId,
				externalId: `${providerId}-${modelId}`,
			})),
		);
	});

	afterEach(async () => {
		await db
			.delete(tables.modelProviderMapping)
			.where(eq(tables.modelProviderMapping.modelId, modelId));
	});

	it("applies the catalogue mapping data policy to database rows", async () => {
		const now = new Date();
		const open = await getModelAvailability([modelId], { enabled: true }, now);
		expect(open.get(modelId)).toContain("aws-bedrock");

		for (const policy of [zeroDataRetention, blockPromptLogging]) {
			const availability = await getModelAvailability([modelId], policy, now);
			expect(availability.get(modelId)).not.toContain("aws-bedrock");
		}
	});

	it("agrees with the catalogue mappings the UI evaluates", async () => {
		const now = new Date();
		const catalogueMappings = (models.find((model) => model.id === modelId)
			?.providers ?? []) as readonly ModelMappingAvailability[];
		const effectiveProviders = await getEffectiveProviders();
		for (const policy of [zeroDataRetention, blockPromptLogging]) {
			const availability = await getModelAvailability([modelId], policy, now);
			const fromCatalogue = getCompliantProvidersForModel(
				modelId,
				catalogueMappings.filter((mapping) =>
					providerIds.includes(mapping.providerId),
				),
				policy,
				now,
				effectiveProviders,
			);
			expect([...(availability.get(modelId) ?? [])].sort()).toEqual(
				[...fromCatalogue].sort(),
			);
		}
	});
});
