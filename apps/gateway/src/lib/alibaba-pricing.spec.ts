import { describe, expect, it } from "vitest";

import { models, type ProviderModelMapping } from "@llmgateway/models";

const FIVE_MIN_WRITE_MULTIPLIER = 1.25;
const EXPLICIT_READ_MULTIPLIER = 0.1;
const IMPLICIT_READ_MULTIPLIER = 0.2;
const RATIO_TOLERANCE = 1e-9;

function assertRatio(
	modelName: string,
	label: string,
	actualStr: string,
	expected: number,
) {
	const actual = Number(actualStr);
	expect(
		actual,
		`${modelName} ${label}: expected ${expected} (got ${actual})`,
	).toBeCloseTo(expected, undefined);
	expect(Math.abs(actual - expected)).toBeLessThan(
		Math.max(expected * 1e-6, RATIO_TOLERANCE),
	);
}

describe("Alibaba Qwen explicit-cache pricing", () => {
	const alibabaProviderEntries = models.flatMap((model) =>
		model.family === "alibaba"
			? model.providers
					.filter((provider) => provider.providerId === "alibaba")
					.map((provider) => ({
						modelId: model.id,
						provider: provider as ProviderModelMapping,
					}))
			: [],
	);

	it("has at least one alibaba provider mapping to validate", () => {
		expect(alibabaProviderEntries.length).toBeGreaterThan(0);
	});

	// Alibaba's explicit context cache is fixed at a 5-minute TTL (resets on hit).
	// No 1-hour variant exists, so cacheWriteInputPrice1h must not be set.
	it.each(alibabaProviderEntries)(
		"$modelId does not define cacheWriteInputPrice1h (5m-only TTL)",
		({ provider }) => {
			expect(
				provider.cacheWriteInputPrice1h,
				`${provider.modelName}: Alibaba does not offer a 1h cache TTL`,
			).toBeUndefined();
			for (const tier of provider.pricingTiers ?? []) {
				expect(
					tier.cacheWriteInputPrice1h,
					`${provider.modelName} tier "${tier.name}": Alibaba does not offer a 1h cache TTL`,
				).toBeUndefined();
			}
			for (const region of provider.regions ?? []) {
				expect(
					region.cacheWriteInputPrice1h,
					`${provider.modelName} region "${region.id}": Alibaba does not offer a 1h cache TTL`,
				).toBeUndefined();
				for (const tier of region.pricingTiers ?? []) {
					expect(
						tier.cacheWriteInputPrice1h,
						`${provider.modelName} region "${region.id}" tier "${tier.name}": Alibaba does not offer a 1h cache TTL`,
					).toBeUndefined();
				}
			}
		},
	);

	it.each(alibabaProviderEntries)(
		"$modelId cacheWriteInputPrice follows the 1.25x explicit-cache multiplier",
		({ provider }) => {
			if (
				provider.cacheWriteInputPrice !== undefined &&
				provider.inputPrice !== undefined
			) {
				assertRatio(
					provider.modelName,
					"cacheWriteInputPrice (5m)",
					provider.cacheWriteInputPrice,
					Number(provider.inputPrice) * FIVE_MIN_WRITE_MULTIPLIER,
				);
			}
			for (const tier of provider.pricingTiers ?? []) {
				if (
					tier.cacheWriteInputPrice !== undefined &&
					tier.inputPrice !== undefined
				) {
					assertRatio(
						provider.modelName,
						`tier "${tier.name}" cacheWriteInputPrice (5m)`,
						tier.cacheWriteInputPrice,
						Number(tier.inputPrice) * FIVE_MIN_WRITE_MULTIPLIER,
					);
				}
			}
			for (const region of provider.regions ?? []) {
				if (
					region.cacheWriteInputPrice !== undefined &&
					region.inputPrice !== undefined
				) {
					assertRatio(
						provider.modelName,
						`region "${region.id}" cacheWriteInputPrice (5m)`,
						region.cacheWriteInputPrice,
						Number(region.inputPrice) * FIVE_MIN_WRITE_MULTIPLIER,
					);
				}
				for (const tier of region.pricingTiers ?? []) {
					if (
						tier.cacheWriteInputPrice !== undefined &&
						tier.inputPrice !== undefined
					) {
						assertRatio(
							provider.modelName,
							`region "${region.id}" tier "${tier.name}" cacheWriteInputPrice (5m)`,
							tier.cacheWriteInputPrice,
							Number(tier.inputPrice) * FIVE_MIN_WRITE_MULTIPLIER,
						);
					}
				}
			}
		},
	);

	// Alibaba's implicit-cache hits bill at 20% of the standard input rate.
	// When a model defines BOTH `cachedInputPrice` (implicit hit rate) AND
	// `cacheReadInputPrice` (explicit hit rate, 10%), it has opted into the
	// bimodal pricing regime — and `cachedInputPrice` must hold to the 0.20x
	// ratio. (qwen3-coder-plus regressed when first added — both fields had been
	// set to 10%, silently underbilling implicit-cache hits until this
	// assertion locked it in.) Older Alibaba rows that only have
	// `cachedInputPrice` (no split) are out of scope: they predate the
	// implicit/explicit distinction and their value reflects whatever single
	// rate the author intended.
	it.each(alibabaProviderEntries)(
		"$modelId cachedInputPrice follows the 0.20x implicit-cache-hit multiplier where the bimodal regime is active",
		({ provider }) => {
			const shouldAssert = (entry: {
				cachedInputPrice?: string;
				cacheReadInputPrice?: string;
				inputPrice?: string;
			}) =>
				entry.cachedInputPrice !== undefined &&
				entry.cacheReadInputPrice !== undefined &&
				entry.inputPrice !== undefined;

			if (shouldAssert(provider)) {
				assertRatio(
					provider.modelName,
					"cachedInputPrice (implicit hit)",
					provider.cachedInputPrice!,
					Number(provider.inputPrice) * IMPLICIT_READ_MULTIPLIER,
				);
			}
			for (const tier of provider.pricingTiers ?? []) {
				if (shouldAssert(tier)) {
					assertRatio(
						provider.modelName,
						`tier "${tier.name}" cachedInputPrice (implicit hit)`,
						tier.cachedInputPrice!,
						Number(tier.inputPrice) * IMPLICIT_READ_MULTIPLIER,
					);
				}
			}
			for (const region of provider.regions ?? []) {
				if (shouldAssert(region)) {
					assertRatio(
						provider.modelName,
						`region "${region.id}" cachedInputPrice (implicit hit)`,
						region.cachedInputPrice!,
						Number(region.inputPrice) * IMPLICIT_READ_MULTIPLIER,
					);
				}
				for (const tier of region.pricingTiers ?? []) {
					if (shouldAssert(tier)) {
						assertRatio(
							provider.modelName,
							`region "${region.id}" tier "${tier.name}" cachedInputPrice (implicit hit)`,
							tier.cachedInputPrice!,
							Number(tier.inputPrice) * IMPLICIT_READ_MULTIPLIER,
						);
					}
				}
			}
		},
	);

	// Alibaba's explicit-cache hits bill at 10% of the standard input rate
	// (vs. 20% for implicit). Whenever `cacheReadInputPrice` is set, it must
	// hold to that 0.10x ratio so calculateCosts picks the right rate when the
	// request used `cache_control`.
	it.each(alibabaProviderEntries)(
		"$modelId cacheReadInputPrice follows the 0.10x explicit-cache-hit multiplier",
		({ provider }) => {
			if (
				provider.cacheReadInputPrice !== undefined &&
				provider.inputPrice !== undefined
			) {
				assertRatio(
					provider.modelName,
					"cacheReadInputPrice (explicit hit)",
					provider.cacheReadInputPrice,
					Number(provider.inputPrice) * EXPLICIT_READ_MULTIPLIER,
				);
			}
			for (const tier of provider.pricingTiers ?? []) {
				if (
					tier.cacheReadInputPrice !== undefined &&
					tier.inputPrice !== undefined
				) {
					assertRatio(
						provider.modelName,
						`tier "${tier.name}" cacheReadInputPrice (explicit hit)`,
						tier.cacheReadInputPrice,
						Number(tier.inputPrice) * EXPLICIT_READ_MULTIPLIER,
					);
				}
			}
			for (const region of provider.regions ?? []) {
				if (
					region.cacheReadInputPrice !== undefined &&
					region.inputPrice !== undefined
				) {
					assertRatio(
						provider.modelName,
						`region "${region.id}" cacheReadInputPrice (explicit hit)`,
						region.cacheReadInputPrice,
						Number(region.inputPrice) * EXPLICIT_READ_MULTIPLIER,
					);
				}
				for (const tier of region.pricingTiers ?? []) {
					if (
						tier.cacheReadInputPrice !== undefined &&
						tier.inputPrice !== undefined
					) {
						assertRatio(
							provider.modelName,
							`region "${region.id}" tier "${tier.name}" cacheReadInputPrice (explicit hit)`,
							tier.cacheReadInputPrice,
							Number(tier.inputPrice) * EXPLICIT_READ_MULTIPLIER,
						);
					}
				}
			}
		},
	);
});
