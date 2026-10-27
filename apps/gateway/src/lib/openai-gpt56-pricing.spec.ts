import { describe, expect, it } from "vitest";

import {
	expandProviderRegions,
	getSupportedServiceTiers,
	models,
	providers,
	type ProviderModelMapping,
} from "@llmgateway/models";

// OpenAI GPT-5.6 and GPT-6 pricing invariants per
// https://developers.openai.com/api/docs/pricing and
// https://developers.openai.com/api/docs/guides/prompt-caching:
// - cache writes bill at 1.25x the uncached input rate (single 30m TTL)
// - prompts with >272K input tokens bill the full request at 2x input,
//   2x cached input, 2x cache write, and 1.5x output
const CACHE_WRITE_MULTIPLIER = 1.25;
const LONG_CONTEXT_THRESHOLD = 272000;
const LONG_INPUT_MULTIPLIER = 2;
const LONG_OUTPUT_MULTIPLIER = 1.5;

function expectRatio(
	label: string,
	actualStr: string | undefined,
	baseStr: string | undefined,
	multiplier: number,
) {
	expect(actualStr, `${label}: price must be defined`).toBeDefined();
	expect(baseStr, `${label}: base price must be defined`).toBeDefined();
	const actual = Number(actualStr);
	const expected = Number(baseStr) * multiplier;
	expect(
		Math.abs(actual - expected),
		`${label}: expected ${expected}, got ${actual}`,
	).toBeLessThan(Math.max(expected * 1e-9, 1e-15));
}

describe("OpenAI GPT-5.6 and GPT-6 family pricing", () => {
	const gpt56Entries = models.flatMap((model) =>
		model.id.startsWith("gpt-5.6") || model.id.startsWith("gpt-6-")
			? model.providers
					// Decision mappings bill input only (no cache or output charges),
					// so the chat pricing invariants below don't apply to them.
					.filter(
						(provider) =>
							provider.providerId === "openai" &&
							!(provider as ProviderModelMapping).decisions,
					)
					.map((provider) => ({
						modelId: model.id,
						provider: provider as ProviderModelMapping,
					}))
			: [],
	);

	it("has the gpt-5.6 and gpt-6 mappings to validate", () => {
		expect(gpt56Entries.map((e) => e.modelId).sort()).toEqual([
			"gpt-5.6-luna",
			"gpt-5.6-sol",
			"gpt-5.6-terra",
			"gpt-6-astra",
			"gpt-6-luna",
			"gpt-6-sol",
		]);
	});

	it.each(gpt56Entries)(
		"$modelId bills cache writes at 1.25x the input rate (30m-only TTL)",
		({ modelId, provider }) => {
			expectRatio(
				`${modelId} cacheWriteInputPrice`,
				provider.cacheWriteInputPrice,
				provider.inputPrice,
				CACHE_WRITE_MULTIPLIER,
			);
			// OpenAI has a single 30m TTL — the Anthropic-style 1h rate must not be set.
			expect(provider.cacheWriteInputPrice1h).toBeUndefined();
			for (const tier of provider.pricingTiers ?? []) {
				expectRatio(
					`${modelId} tier "${tier.name}" cacheWriteInputPrice`,
					tier.cacheWriteInputPrice,
					tier.inputPrice,
					CACHE_WRITE_MULTIPLIER,
				);
				expect(tier.cacheWriteInputPrice1h).toBeUndefined();
			}
		},
	);

	it.each(gpt56Entries)(
		"$modelId defines the 272K short/long context pricing tiers",
		({ modelId, provider }) => {
			const tiers = provider.pricingTiers ?? [];
			expect(tiers, `${modelId}: pricingTiers must be defined`).toHaveLength(2);
			const [shortTier, longTier] = tiers;

			expect(shortTier.upToTokens).toBe(LONG_CONTEXT_THRESHOLD);
			expect(longTier.upToTokens).toBe(Infinity);

			// The base mapping prices must match the short-context tier.
			expect(shortTier.inputPrice).toBe(provider.inputPrice);
			expect(shortTier.outputPrice).toBe(provider.outputPrice);
			expect(shortTier.cachedInputPrice).toBe(provider.cachedInputPrice);
			expect(shortTier.cacheWriteInputPrice).toBe(
				provider.cacheWriteInputPrice,
			);

			// Long context: 2x input-side rates, 1.5x output rate.
			expectRatio(
				`${modelId} long-context inputPrice`,
				longTier.inputPrice,
				shortTier.inputPrice,
				LONG_INPUT_MULTIPLIER,
			);
			expectRatio(
				`${modelId} long-context cachedInputPrice`,
				longTier.cachedInputPrice,
				shortTier.cachedInputPrice,
				LONG_INPUT_MULTIPLIER,
			);
			expectRatio(
				`${modelId} long-context cacheWriteInputPrice`,
				longTier.cacheWriteInputPrice,
				shortTier.cacheWriteInputPrice,
				LONG_INPUT_MULTIPLIER,
			);
			expectRatio(
				`${modelId} long-context outputPrice`,
				longTier.outputPrice,
				shortTier.outputPrice,
				LONG_OUTPUT_MULTIPLIER,
			);
		},
	);
});

// Azure resells these at OpenAI's own rates on Standard Global deployments,
// Sol's promotional rates included — Azure runs that promo on its own window
// (2026-09-01 through at least 2026-11-30). The rates come from the
// `5.6 <model> … Std Gl` / `6-<model> … Std Gl` meters in the Azure retail
// prices API, which bill
// lower than the pricing page still publishes. Data Zone (+10%) is a separate
// deployment type the catalogue does not map, so nothing here should track it;
// Priority Processing is mapped as a service tier at a flat 2x premium (the
// `… PP Gl` meters), which the standard rates below must stay independent of.
describe("GPT-5.6 and GPT-6 on Azure", () => {
	const azureEntries = models.flatMap((model) =>
		model.id.startsWith("gpt-5.6") || model.id.startsWith("gpt-6-")
			? model.providers
					.filter((provider) => provider.providerId === "azure")
					.map((provider) => ({
						modelId: model.id,
						provider: provider as ProviderModelMapping,
						firstParty: model.providers.find(
							(candidate) => candidate.providerId === "openai",
						) as ProviderModelMapping | undefined,
					}))
			: [],
	);

	it("has the azure mappings to validate", () => {
		expect(azureEntries.map((e) => e.modelId).sort()).toEqual([
			"gpt-5.6-luna",
			"gpt-5.6-sol",
			"gpt-5.6-terra",
			"gpt-6-astra",
			"gpt-6-luna",
			"gpt-6-sol",
		]);
	});

	it.each(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-sol"])(
		"%s sells Priority processing at 2x the standard rate",
		(modelId) => {
			const tiers = getSupportedServiceTiers(modelId, "azure");
			expect(tiers.map((tier) => tier.id)).toEqual(["priority"]);
			expect(tiers[0].multiplier).toBe(2);
		},
	);

	// The `… PP …` meters only exist for the models Microsoft's
	// priority-processing docs list. The rest downgrade a priority request to
	// standard, so their mappings must stay tier-less.
	it.each(["gpt-5.6-luna", "gpt-6-luna", "gpt-6-astra"])(
		"%s sells no service tier on azure",
		(modelId) => {
			expect(getSupportedServiceTiers(modelId, "azure")).toEqual([]);
		},
	);

	it.each(azureEntries)(
		"$modelId bills Standard Global at the first-party rate",
		({ modelId, provider, firstParty }) => {
			expect(
				firstParty,
				`${modelId}: openai mapping must be defined`,
			).toBeDefined();
			for (const field of [
				"inputPrice",
				"outputPrice",
				"cachedInputPrice",
				"cacheWriteInputPrice",
			] as const) {
				expect(provider[field], `${modelId} azure ${field}`).toBe(
					firstParty?.[field],
				);
			}
			expect(provider.cacheWriteInputPrice1h).toBeUndefined();

			const tiers = provider.pricingTiers ?? [];
			const firstPartyTiers = firstParty?.pricingTiers ?? [];
			expect(tiers, `${modelId} azure pricingTiers`).toHaveLength(
				firstPartyTiers.length,
			);
			tiers.forEach((tier, index) => {
				const firstPartyTier = firstPartyTiers[index];
				expect(tier.upToTokens, `${modelId} azure tier ${index}`).toBe(
					firstPartyTier.upToTokens,
				);
				for (const field of [
					"inputPrice",
					"outputPrice",
					"cachedInputPrice",
					"cacheWriteInputPrice",
				] as const) {
					expect(
						tier[field],
						`${modelId} azure tier "${tier.name}" ${field}`,
					).toBe(firstPartyTier[field]);
				}
			});
		},
	);
});

// AWS serves OpenAI's models two ways: cross-region profiles on the Runtime
// endpoint and in-region Mantle deployments. Global cross-region bills
// OpenAI's own rates; in-region and US cross-region bill a flat 10% premium.
// Every route caps the prompt at the same measured window, well below AWS's
// documented 1.05M.
const BEDROCK_PREMIUM = 1.1;
const BEDROCK_CONTEXT_SIZE = 921600;

// GPT-5.4 and GPT-5.5 have cross-region profiles, but AWS publishes no rate
// for them, so only their in-region deployments are mapped. Sol 5.6 is not
// deployed to us-west-2, and the GPT-6 family is in-region only in us-east-1
// (Astra also in us-west-2).
const EXPECTED_REGIONS: Record<string, string[]> = {
	"gpt-5.4": ["us-east-1", "us-east-2", "us-west-2"],
	"gpt-5.5": ["us-east-1", "us-east-2"],
	"gpt-5.6-sol": ["global", "us", "us-east-1", "us-east-2"],
	"gpt-5.6-terra": ["global", "us", "us-east-1", "us-east-2", "us-west-2"],
	"gpt-5.6-luna": ["global", "us", "us-east-1", "us-east-2", "us-west-2"],
	"gpt-6-astra": ["global", "us", "us-east-1", "us-west-2"],
	"gpt-6-sol": ["global", "us", "us-east-1"],
	"gpt-6-luna": ["global", "us", "us-east-1"],
	"gpt-6.1-sol": ["global", "us", "us-east-1"],
};

describe("OpenAI models on AWS Bedrock", () => {
	// gpt-oss runs on Mantle's chat completions route at its own per-region
	// SKUs, outside the GPT-5/6 pricing scheme checked here.
	const mantleEntries = models.flatMap((model) =>
		model.providers
			.filter(
				(provider) =>
					provider.providerId === "aws-mantle" &&
					(provider as ProviderModelMapping).apiFormat === undefined,
			)
			.map((provider) => ({
				modelId: model.id,
				provider: provider as ProviderModelMapping,
				firstParty: model.providers.find(
					(candidate) => candidate.providerId === "openai",
				) as ProviderModelMapping | undefined,
				global: (provider as ProviderModelMapping).regions?.find(
					(region) => region.id === "global",
				),
			})),
	);
	const crossRegionEntries = mantleEntries.filter((e) => e.global);
	const inRegionOnlyEntries = mantleEntries.filter((e) => !e.global);

	it("has the aws-mantle mappings to validate", () => {
		expect(mantleEntries.map((e) => e.modelId).sort()).toEqual(
			Object.keys(EXPECTED_REGIONS).sort(),
		);
		expect(inRegionOnlyEntries.map((e) => e.modelId).sort()).toEqual([
			"gpt-5.4",
			"gpt-5.5",
		]);
	});

	it.each(crossRegionEntries)(
		"$modelId bills global cross-region at the first-party rate",
		({ modelId, firstParty, global }) => {
			for (const field of [
				"inputPrice",
				"outputPrice",
				"cachedInputPrice",
				"cacheWriteInputPrice",
			] as const) {
				expect(global?.[field], `${modelId} global ${field}`).toBe(
					firstParty?.[field],
				);
			}
		},
	);

	it.each(crossRegionEntries)(
		"$modelId bills in-region at a 10% premium over global cross-region",
		({ modelId, provider, global }) => {
			for (const field of [
				"inputPrice",
				"outputPrice",
				"cachedInputPrice",
				"cacheWriteInputPrice",
			] as const) {
				expectRatio(
					`${modelId} aws-mantle in-region ${field}`,
					provider[field],
					global?.[field],
					BEDROCK_PREMIUM,
				);
			}
			// The 1.25x cache-write relationship survives the premium.
			for (const [label, mapping] of [
				["in-region", provider],
				["global", global],
			] as const) {
				expectRatio(
					`${modelId} aws-mantle ${label} cacheWriteInputPrice vs inputPrice`,
					mapping?.cacheWriteInputPrice,
					mapping?.inputPrice,
					CACHE_WRITE_MULTIPLIER,
				);
			}
		},
	);

	it.each(inRegionOnlyEntries)(
		"$modelId bills in-region at a 10% premium over the first-party rate",
		({ modelId, provider, firstParty }) => {
			for (const field of [
				"inputPrice",
				"outputPrice",
				"cachedInputPrice",
			] as const) {
				expectRatio(
					`${modelId} aws-mantle in-region ${field}`,
					provider[field],
					firstParty?.[field],
					BEDROCK_PREMIUM,
				);
			}
			// AWS charges nothing for cache writes on these models.
			expect(provider.cacheWriteInputPrice).toBeUndefined();
		},
	);

	it.each(mantleEntries)(
		"$modelId prices the 272K long-context tier on every route",
		({ modelId, provider, global }) => {
			const routes = global
				? ([
						["in-region", provider],
						["global", global],
					] as const)
				: ([["in-region", provider]] as const);
			for (const [label, mapping] of routes) {
				const tiers = mapping?.pricingTiers ?? [];
				expect(tiers, `${modelId} ${label}: pricingTiers`).toHaveLength(2);
				const [shortTier, longTier] = tiers;

				expect(shortTier.upToTokens).toBe(LONG_CONTEXT_THRESHOLD);
				expect(longTier.upToTokens).toBe(Infinity);
				expect(shortTier.inputPrice).toBe(mapping?.inputPrice);
				expect(shortTier.outputPrice).toBe(mapping?.outputPrice);
				expect(shortTier.cachedInputPrice).toBe(mapping?.cachedInputPrice);
				expect(shortTier.cacheWriteInputPrice).toBe(
					mapping?.cacheWriteInputPrice,
				);

				for (const field of ["inputPrice", "cachedInputPrice"] as const) {
					expectRatio(
						`${modelId} ${label} long-context ${field}`,
						longTier[field],
						shortTier[field],
						LONG_INPUT_MULTIPLIER,
					);
				}
				if (shortTier.cacheWriteInputPrice !== undefined) {
					expectRatio(
						`${modelId} ${label} long-context cacheWriteInputPrice`,
						longTier.cacheWriteInputPrice,
						shortTier.cacheWriteInputPrice,
						LONG_INPUT_MULTIPLIER,
					);
				}
				expectRatio(
					`${modelId} ${label} long-context outputPrice`,
					longTier.outputPrice,
					shortTier.outputPrice,
					LONG_OUTPUT_MULTIPLIER,
				);
			}
		},
	);

	it.each(mantleEntries)(
		"$modelId caps every route at the measured prompt window",
		({ modelId, provider }) => {
			expect(provider.contextSize, `${modelId}: aws-mantle context size`).toBe(
				BEDROCK_CONTEXT_SIZE,
			);
			for (const region of provider.regions ?? []) {
				expect(
					region.contextSize,
					`${modelId} ${region.id}: context size`,
				).toBeUndefined();
			}
		},
	);

	it.each(mantleEntries)(
		"$modelId declares exactly the regions AWS deploys it to",
		({ modelId, provider }) => {
			expect(provider.regions?.map((r) => r.id)).toEqual(
				EXPECTED_REGIONS[modelId],
			);
		},
	);

	it("routes cross-region profiles through Runtime and the rest through Mantle", () => {
		const def = providers.find((p) => p.id === "aws-mantle");
		const configured = def?.regionConfig?.regions.map((r) => r.id) ?? [];
		const usedRegions = new Set(
			mantleEntries.flatMap((e) => e.provider.regions?.map((r) => r.id) ?? []),
		);

		expect([...usedRegions].sort()).toEqual([
			"global",
			"us",
			"us-east-1",
			"us-east-2",
			"us-west-2",
		]);
		expect(def?.regionConfig?.pinDefaultRegion).toBeUndefined();
		for (const region of usedRegions) {
			expect(configured).toContain(region);
			if (region === "global" || region === "us") {
				// Cross-region profiles live on Runtime and name the model with a
				// profile prefix; Mantle has no cross-region profile at all.
				expect(def?.regionConfig?.endpointMap[region]).toBe(
					"https://bedrock-runtime.us-east-1.amazonaws.com",
				);
				expect(def?.regionConfig?.modelPrefixMap?.[region]).toBe(`${region}.`);
				continue;
			}
			expect(def?.regionConfig?.endpointMap[region]).toBe(
				`https://bedrock-mantle.${region}.api.aws`,
			);
			expect(def?.regionConfig?.modelPrefixMap?.[region]).toBeUndefined();
		}
	});

	it("expands each region, overriding pricing only for global", () => {
		for (const { modelId, provider, global } of mantleEntries) {
			const expanded = expandProviderRegions(provider);
			// The synthetic root carries no region and must come first, followed by
			// exactly the declared regions — a count check alone would pass if a
			// region were duplicated or mislabelled.
			expect(expanded.map((entry) => entry.region)).toEqual([
				undefined,
				...EXPECTED_REGIONS[modelId],
			]);
			for (const entry of expanded) {
				const expected = entry.region === "global" ? global : provider;
				expect(entry.inputPrice, `${modelId} ${entry.region}`).toBe(
					expected?.inputPrice,
				);
				expect(entry.outputPrice, `${modelId} ${entry.region}`).toBe(
					expected?.outputPrice,
				);
				expect(entry.contextSize, `${modelId} ${entry.region}`).toBe(
					provider.contextSize,
				);
			}
		}
	});

	// Bedrock Web Search is served only by Mantle's Responses API in the
	// commercial US regions; Runtime's cross-region profiles lack it.
	it("offers web search only on in-region US Mantle routes", () => {
		// Web search requests hang on these, though plain requests complete.
		const hangs = new Set(["gpt-5.4:us-east-1", "gpt-5.5:us-east-1"]);
		for (const { modelId, provider } of mantleEntries) {
			for (const entry of expandProviderRegions(provider)) {
				if (entry.region === undefined) {
					continue;
				}
				const inRegionUs = ["us-east-1", "us-east-2", "us-west-2"].includes(
					entry.region,
				);
				expect(entry.webSearch, `${modelId} ${entry.region}`).toBe(
					inRegionUs && !hangs.has(`${modelId}:${entry.region}`),
				);
				expect(entry.webSearchPrice, `${modelId} ${entry.region}`).toBe(
					"0.012",
				);
			}
		}
	});
});

describe("gpt-oss on AWS Bedrock (OpenAI)", () => {
	const ossEntries = models.flatMap((model) =>
		model.providers
			.filter(
				(provider) =>
					provider.providerId === "aws-mantle" &&
					model.id.startsWith("gpt-oss"),
			)
			.map((provider) => ({
				modelId: model.id,
				provider: provider as ProviderModelMapping,
			})),
	);

	it("maps both gpt-oss sizes", () => {
		expect(ossEntries.map((e) => e.modelId).sort()).toEqual([
			"gpt-oss-120b",
			"gpt-oss-20b",
		]);
	});

	it.each(ossEntries)(
		"$modelId uses chat completions in configured in-region deployments",
		({ provider }) => {
			expect(provider.apiFormat).toBe("openai-chat-completions");
			expect(provider.webSearch).toBeUndefined();
			const def = providers.find((p) => p.id === "aws-mantle");
			for (const region of provider.regions ?? []) {
				// Mantle has no cross-region profile for gpt-oss.
				expect(def?.regionConfig?.modelPrefixMap?.[region.id]).toBeUndefined();
				expect(def?.regionConfig?.endpointMap[region.id]).toBe(
					`https://bedrock-mantle.${region.id}.api.aws`,
				);
			}
		},
	);
});
