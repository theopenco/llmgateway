import { describe, expect, it } from "vitest";

import { models, type ProviderModelMapping } from "@llmgateway/models";

const FIVE_MIN_WRITE_MULTIPLIER = 1.25;
const ONE_HOUR_WRITE_MULTIPLIER = 2;
const CACHE_READ_MULTIPLIER = 0.1;
const RATIO_TOLERANCE = 1e-9;

const LEGACY_RATIO_EXCEPTIONS = new Set(["claude-3-haiku-20240307"]);

function assertRatio(
	modelName: string,
	label: string,
	actual: number,
	expected: number,
) {
	expect(
		actual,
		`${modelName} ${label}: expected ${expected} (got ${actual}). If Anthropic's published price diverges from the standard multiplier, add the modelName to LEGACY_RATIO_EXCEPTIONS.`,
	).toBeCloseTo(expected, undefined);
	expect(Math.abs(actual - expected)).toBeLessThan(
		Math.max(expected * 1e-6, RATIO_TOLERANCE),
	);
}

describe("Anthropic model pricing", () => {
	const anthropicProviderEntries = models.flatMap((model) =>
		model.family === "anthropic"
			? model.providers
					.filter((provider) => provider.providerId === "anthropic")
					.map((provider) => ({
						modelId: model.id,
						provider: provider as ProviderModelMapping,
					}))
			: [],
	);

	it("has at least one anthropic provider mapping to validate", () => {
		expect(anthropicProviderEntries.length).toBeGreaterThan(0);
	});

	it.each(anthropicProviderEntries)(
		"$modelId defines cacheWriteInputPrice1h whenever cacheWriteInputPrice is set",
		({ provider }) => {
			if (provider.cacheWriteInputPrice === undefined) {
				return;
			}
			expect(
				provider.cacheWriteInputPrice1h,
				`${provider.modelName}: cacheWriteInputPrice is set but cacheWriteInputPrice1h is missing — 1h cache writes would silently bill at the 5m rate`,
			).toBeDefined();
		},
	);

	it.each(anthropicProviderEntries)(
		"$modelId defines cacheWriteInputPrice1h on every pricing tier that sets cacheWriteInputPrice",
		({ provider }) => {
			const tiers = provider.pricingTiers ?? [];
			for (const tier of tiers) {
				if (tier.cacheWriteInputPrice === undefined) {
					continue;
				}
				expect(
					tier.cacheWriteInputPrice1h,
					`${provider.modelName} tier "${tier.name}": cacheWriteInputPrice is set but cacheWriteInputPrice1h is missing`,
				).toBeDefined();
			}
		},
	);

	it.each(anthropicProviderEntries)(
		"$modelId cache prices follow the standard 1.25x/2x/0.1x ratios",
		({ provider }) => {
			if (LEGACY_RATIO_EXCEPTIONS.has(provider.modelName)) {
				return;
			}
			if (provider.inputPrice === undefined) {
				return;
			}
			const base = provider.inputPrice;
			if (provider.cacheWriteInputPrice !== undefined) {
				assertRatio(
					provider.modelName,
					"cacheWriteInputPrice (5m)",
					provider.cacheWriteInputPrice,
					base * FIVE_MIN_WRITE_MULTIPLIER,
				);
			}
			if (provider.cacheWriteInputPrice1h !== undefined) {
				assertRatio(
					provider.modelName,
					"cacheWriteInputPrice1h",
					provider.cacheWriteInputPrice1h,
					base * ONE_HOUR_WRITE_MULTIPLIER,
				);
			}
			if (provider.cachedInputPrice !== undefined) {
				assertRatio(
					provider.modelName,
					"cachedInputPrice",
					provider.cachedInputPrice,
					base * CACHE_READ_MULTIPLIER,
				);
			}
			for (const tier of provider.pricingTiers ?? []) {
				if (tier.inputPrice === undefined) {
					continue;
				}
				const tierBase = tier.inputPrice;
				const label = `tier "${tier.name}"`;
				if (tier.cacheWriteInputPrice !== undefined) {
					assertRatio(
						provider.modelName,
						`${label} cacheWriteInputPrice (5m)`,
						tier.cacheWriteInputPrice,
						tierBase * FIVE_MIN_WRITE_MULTIPLIER,
					);
				}
				if (tier.cacheWriteInputPrice1h !== undefined) {
					assertRatio(
						provider.modelName,
						`${label} cacheWriteInputPrice1h`,
						tier.cacheWriteInputPrice1h,
						tierBase * ONE_HOUR_WRITE_MULTIPLIER,
					);
				}
				if (tier.cachedInputPrice !== undefined) {
					assertRatio(
						provider.modelName,
						`${label} cachedInputPrice`,
						tier.cachedInputPrice,
						tierBase * CACHE_READ_MULTIPLIER,
					);
				}
			}
		},
	);
});
