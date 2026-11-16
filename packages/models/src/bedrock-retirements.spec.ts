import { describe, expect, it } from "vitest";

import { anthropicModels } from "./models/anthropic.js";
import { expandProviderRegions } from "./region-helpers.js";

import type { ModelDefinition } from "./models.js";

describe("AWS Bedrock retirements", () => {
	it.each(["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"])(
		"retires aws-bedrock/%s in every region on April 8, 2027",
		(modelId) => {
			const model = (anthropicModels as readonly ModelDefinition[]).find(
				(entry) => entry.id === modelId,
			);
			const bedrock = model?.providers.find(
				(mapping) => mapping.providerId === "aws-bedrock",
			);
			expect(bedrock).toBeDefined();
			for (const mapping of expandProviderRegions(bedrock!)) {
				expect(mapping.deprecatedAt).toEqual(new Date("2026-10-08"));
				expect(mapping.deactivatedAt).toEqual(new Date("2027-04-08"));
			}
		},
	);
});
