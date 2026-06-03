import { describe, expect, it, vi } from "vitest";

import { metricsKey } from "@llmgateway/db";
import {
	getProviderDefinition,
	models,
	type ProviderModelMapping,
	type BaseMessage,
	type OpenAIRequestBody,
} from "@llmgateway/models";
import {
	buildProviderPriorityDefaults,
	resolveRoutingConfig,
} from "@llmgateway/shared/routing-config";

import {
	getCheapestFromAvailableProviders,
	getProviderSelectionPrice,
} from "./get-cheapest-from-available-providers.js";
import { getCheapestModelForProvider } from "./get-cheapest-model-for-provider.js";
import { prepareRequestBody } from "./prepare-request-body.js";

describe("Models", () => {
	it("should not have duplicate model IDs", () => {
		const modelIds = models.map((model) => model.id);

		const uniqueModelIds = new Set(modelIds);

		expect(uniqueModelIds.size).toBe(modelIds.length);

		if (uniqueModelIds.size !== modelIds.length) {
			const duplicates = modelIds.filter(
				(id, index) => modelIds.indexOf(id) !== index,
			);
			throw new Error(`Duplicate model IDs found: ${duplicates.join(", ")}`);
		}
	});

	it("should include o1-mini model", () => {
		const o1MiniModel = models.find((model) => model.id === "o1-mini");
		expect(o1MiniModel).toBeDefined();
		expect(o1MiniModel?.supportsSystemRole).toBe(false);
		expect(o1MiniModel?.family).toBe("openai");
	});

	it("should mark Claude Sonnet 4.6 provider mappings as vision-capable", () => {
		const sonnet46 = models.find((model) => model.id === "claude-sonnet-4-6");

		expect(sonnet46).toBeDefined();
		expect(sonnet46?.providers.map((provider) => provider.vision)).toEqual([
			true,
			true,
			true,
			true,
		]);
	});

	it("should have free: true when provider mapping has zero pricing", () => {
		// Image-output models like gpt-image-2 explicitly set outputPrice=0
		// because the model never returns text output, but still bill via
		// imageOutputPrice. Treat them as priced.
		const hasImagePricing = (provider: ProviderModelMapping) =>
			!!provider.imageInputPrice || !!provider.imageOutputPrice;

		// Embedding models bill only on input tokens and set outputPrice=0
		// because they don't produce text output.
		const isEmbeddingProvider = (provider: ProviderModelMapping) =>
			provider.embeddings === true;

		const isZero = (p: string | undefined) =>
			p !== undefined && Number(p) === 0;

		// Filter models that have zero input/output pricing AND no request or per-second price
		const modelsWithZeroPricing = models.filter((model) =>
			model.providers.some(
				(provider) =>
					(isZero(provider.inputPrice) || isZero(provider.outputPrice)) &&
					!(provider as ProviderModelMapping).requestPrice &&
					!Object.values(
						(provider as ProviderModelMapping).perSecondPrice ?? {},
					).some((price) => Number(price) > 0) &&
					!hasImagePricing(provider as ProviderModelMapping) &&
					!isEmbeddingProvider(provider as ProviderModelMapping),
			),
		);

		const modelsWithoutFreeFlag = modelsWithZeroPricing.filter(
			(model) => (model as { free?: boolean }).free !== true,
		);

		if (modelsWithoutFreeFlag.length > 0) {
			const errorDetails = modelsWithoutFreeFlag.map((model) => {
				const zeroPricedProviders = model.providers.filter(
					(p) =>
						(isZero(p.inputPrice) || isZero(p.outputPrice)) &&
						!(p as ProviderModelMapping).requestPrice &&
						!Object.values(
							(p as ProviderModelMapping).perSecondPrice ?? {},
						).some((price) => Number(price) > 0) &&
						!hasImagePricing(p as ProviderModelMapping) &&
						!isEmbeddingProvider(p as ProviderModelMapping),
				);
				return `${model.id}: providers ${zeroPricedProviders.map((p) => `${p.providerId}/${p.externalId} (input: ${p.inputPrice}, output: ${p.outputPrice})`).join(", ")}`;
			});
			throw new Error(
				`Models with zero pricing must have free: true:\n${errorDetails.join("\n")}`,
			);
		}

		expect(modelsWithoutFreeFlag.length).toBe(0);
	});
});

describe("System Role Handling", () => {
	it("should transform system messages to user messages for o1-mini", async () => {
		const messages: BaseMessage[] = [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Hello" },
		];

		const requestBody = await prepareRequestBody(
			"openai",
			"o1-mini",
			null,
			"o1-mini",
			messages,
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			undefined, // reasoning_effort
			true, // supportsReasoning
			false, // isProd
		);

		const openAIBody = requestBody as OpenAIRequestBody;
		expect(openAIBody.messages).toHaveLength(2);
		expect(openAIBody.messages[0].role).toBe("user");
		expect(openAIBody.messages[0].content).toBe("You are a helpful assistant.");
		expect(openAIBody.messages[1].role).toBe("user");
		expect(openAIBody.messages[1].content).toBe("Hello");
	});

	it("should preserve system messages for models that support them", async () => {
		const messages: BaseMessage[] = [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Hello" },
		];

		const requestBody = await prepareRequestBody(
			"openai",
			"gpt-4o-mini",
			null,
			"gpt-4o-mini",
			messages,
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			undefined, // reasoning_effort
			false, // supportsReasoning
			false, // isProd
		);

		const openAIBody2 = requestBody as OpenAIRequestBody;
		expect(openAIBody2.messages).toHaveLength(2);
		expect(openAIBody2.messages[0].role).toBe("system");
		expect(openAIBody2.messages[0].content).toBe(
			"You are a helpful assistant.",
		);
		expect(openAIBody2.messages[1].role).toBe("user");
		expect(openAIBody2.messages[1].content).toBe("Hello");
	});

	it("should handle array content in system messages", async () => {
		const messages: BaseMessage[] = [
			{
				role: "system",
				content: [
					{ type: "text", text: "You are a helpful" },
					{ type: "text", text: "assistant." },
				],
			},
			{ role: "user", content: "Hello" },
		];

		const requestBody = await prepareRequestBody(
			"openai",
			"o1-mini",
			null,
			"o1-mini",
			messages,
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			undefined, // reasoning_effort
			true, // supportsReasoning
			false, // isProd
		);

		const openAIBody3 = requestBody as OpenAIRequestBody;
		expect(openAIBody3.messages).toHaveLength(2);
		expect(openAIBody3.messages[0].role).toBe("user");
		expect(openAIBody3.messages[0].content).toEqual([
			{ type: "text", text: "You are a helpful" },
			{ type: "text", text: "assistant." },
		]);
	});
});

describe("prepareRequestBody", () => {
	const messages: BaseMessage[] = [{ role: "user", content: "Hello" }];

	describe("OpenAI provider", () => {
		it("should override temperature to 1 for gpt-5 models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5",
				null,
				"gpt-5",
				messages,
				false, // stream
				0.7, // temperature - should be overridden to 1
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect((body as OpenAIRequestBody).temperature).toBe(1);
		});

		it("should override temperature to 1 for gpt-5-mini models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5-mini",
				null,
				"gpt-5-mini",
				messages,
				false, // stream
				0.3, // temperature - should be overridden to 1
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect((body as OpenAIRequestBody).temperature).toBe(1);
		});

		it("should override temperature to 1 for gpt-5-nano models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5-nano",
				null,
				"gpt-5-nano",
				messages,
				false, // stream
				0.9, // temperature - should be overridden to 1
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect((body as OpenAIRequestBody).temperature).toBe(1);
		});

		it("should override temperature to 1 for gpt-5-chat-latest models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5-chat-latest",
				null,
				"gpt-5-chat-latest",
				messages,
				false, // stream
				0.5, // temperature - should be overridden to 1
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect((body as OpenAIRequestBody).temperature).toBe(1);
		});

		it("should not override temperature for non-gpt-5 models", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-4o-mini",
				null,
				"gpt-4o-mini",
				messages,
				false, // stream
				0.7, // temperature - should remain as-is
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				undefined, // reasoning_effort
				false, // supportsReasoning
				false, // isProd
			);

			expect((body as OpenAIRequestBody).temperature).toBe(0.7);
		});

		it("should override temperature to 1 for gpt-5 models with reasoning enabled", async () => {
			const body = await prepareRequestBody(
				"openai",
				"gpt-5",
				null,
				"gpt-5",
				messages,
				false, // stream
				0.8, // temperature - should be overridden to 1
				undefined, // max_tokens
				undefined, // top_p
				undefined, // frequency_penalty
				undefined, // presence_penalty
				undefined, // response_format
				undefined, // tools
				undefined, // tool_choice
				"medium", // reasoning_effort
				true, // supportsReasoning
				false, // isProd
			);

			expect((body as OpenAIRequestBody).temperature).toBe(1);
		});
	});
});

describe("getCheapestModelForProvider", () => {
	it("should return cheapest model for openai provider", () => {
		const cheapestModel = getCheapestModelForProvider("openai");
		expect(cheapestModel).toBeDefined();
		expect(typeof cheapestModel).toBe("string");
	});

	it("should return cheapest model for anthropic provider", () => {
		const cheapestModel = getCheapestModelForProvider("anthropic");
		expect(cheapestModel).toBeDefined();
		expect(typeof cheapestModel).toBe("string");
	});

	it("should return null for non-existent provider", () => {
		const cheapestModel = getCheapestModelForProvider("non-existent" as any);
		expect(cheapestModel).toBe(null);
	});

	it("should only consider models with pricing information", () => {
		// Test that the function filters out models without pricing
		const cheapestModel = getCheapestModelForProvider("openai");
		expect(cheapestModel).toBeDefined();

		// Verify the cheapest model has pricing information
		if (cheapestModel) {
			const modelWithProvider = models.find((model) =>
				model.providers.some(
					(p) =>
						p.providerId === "openai" &&
						p.externalId === cheapestModel &&
						p.inputPrice !== undefined &&
						p.outputPrice !== undefined,
				),
			);
			expect(modelWithProvider).toBeDefined();
		}
	});

	it("should exclude deprecated models", () => {
		// This test verifies that deprecated models are not returned
		const cheapestModel = getCheapestModelForProvider("openai");

		if (cheapestModel) {
			const modelWithProvider = models.find((model) =>
				model.providers.some(
					(p) => p.providerId === "openai" && p.externalId === cheapestModel,
				),
			);

			if (modelWithProvider) {
				// Check if any provider mapping has a deprecatedAt date
				const providerMapping = modelWithProvider.providers.find(
					(p) => p.providerId === "openai" && p.externalId === cheapestModel,
				) as ProviderModelMapping | undefined;
				if (providerMapping?.deprecatedAt) {
					// If the provider mapping has a deprecatedAt date, it should be in the future
					expect(new Date() <= providerMapping.deprecatedAt).toBe(true);
				}
			}
		}
	});

	it("should account for discount when calculating cheapest model", () => {
		const discountOf = (p: ProviderModelMapping): number | undefined =>
			p.discount !== undefined ? Number(p.discount) : undefined;
		// Test that discounts are properly applied in the cheapest model calculation
		// Look for models with discount providers
		const modelsWithDiscountProviders = models.filter((model) =>
			model.providers.some((p) => {
				const d = discountOf(p as ProviderModelMapping);
				return d !== undefined && d < 1;
			}),
		);

		if (modelsWithDiscountProviders.length > 0) {
			// Find a model that has both regular and discount providers
			const testModel = modelsWithDiscountProviders.find((model) => {
				const regularProvider = model.providers.find((p) => {
					const d = discountOf(p as ProviderModelMapping);
					return d === undefined || d === 1;
				});
				const discountProvider = model.providers.find((p) => {
					const d = discountOf(p as ProviderModelMapping);
					return d !== undefined && d < 1;
				});
				return regularProvider && discountProvider;
			});

			if (testModel) {
				const regularProvider = testModel.providers.find((p) => {
					const d = discountOf(p as ProviderModelMapping);
					return d === undefined || d === 1;
				});
				const discountProvider = testModel.providers.find((p) => {
					const d = discountOf(p as ProviderModelMapping);
					return d !== undefined && d < 1;
				});

				if (
					regularProvider &&
					discountProvider &&
					regularProvider.inputPrice &&
					discountProvider.inputPrice
				) {
					// Calculate expected prices
					const regularPrice =
						(Number(regularProvider.inputPrice) +
							Number(regularProvider.outputPrice ?? "0")) /
						2;
					const discountPrice =
						((Number(discountProvider.inputPrice) +
							Number(discountProvider.outputPrice ?? "0")) /
							2) *
						(1 - discountOf(discountProvider as ProviderModelMapping)!);

					// The discount provider should be cheaper than the regular provider
					expect(discountPrice).toBeLessThan(regularPrice);

					// Test both provider functions handle discounts
					const cheapestForDiscountProvider = getCheapestModelForProvider(
						discountProvider.providerId,
					);
					const cheapestForRegularProvider = getCheapestModelForProvider(
						regularProvider.providerId,
					);

					expect(cheapestForDiscountProvider).toBeDefined();
					expect(cheapestForRegularProvider).toBeDefined();
				}
			}
		}
	});
});

describe("getCheapestFromAvailableProviders", () => {
	it("should return cheapest provider from available providers", () => {
		// Find a model with multiple providers
		const modelWithMultipleProviders = models.find(
			(model) =>
				model.providers.length > 1 &&
				model.providers.some(
					(p) => p.inputPrice !== undefined && p.outputPrice !== undefined,
				),
		);

		if (modelWithMultipleProviders) {
			const availableProviders = modelWithMultipleProviders.providers.filter(
				(p) => p.inputPrice !== undefined && p.outputPrice !== undefined,
			);

			if (availableProviders.length > 1) {
				const cheapestProvider = getCheapestFromAvailableProviders(
					availableProviders,
					modelWithMultipleProviders,
				);

				expect(cheapestProvider).toBeDefined();
				expect(cheapestProvider?.provider).toMatchObject({
					providerId: expect.any(String),
					externalId: expect.any(String),
				});
			}
		}
	});

	describe("sticky session routing", () => {
		const modelWithMultipleProviders = models.find(
			(model) =>
				model.providers.length > 1 &&
				model.providers.some(
					(p) => p.inputPrice !== undefined && p.outputPrice !== undefined,
				),
		);

		it("pins the same session to the same provider deterministically", () => {
			if (!modelWithMultipleProviders) {
				return;
			}
			const availableProviders = modelWithMultipleProviders.providers.filter(
				(p) => p.inputPrice !== undefined && p.outputPrice !== undefined,
			);
			if (availableProviders.length <= 1) {
				return;
			}

			const first = getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
				{ sessionId: "session_abc-123" },
			);
			const second = getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
				{ sessionId: "session_abc-123" },
			);

			const regionOf = (p: unknown) =>
				(p as { region?: string } | undefined)?.region;

			expect(first?.metadata.selectionReason).toBe("session-sticky");
			expect(second?.provider.providerId).toBe(first?.provider.providerId);
			expect(regionOf(second?.provider)).toBe(regionOf(first?.provider));
		});

		it("does not pin a session when session stickiness is disabled", () => {
			if (!modelWithMultipleProviders) {
				return;
			}
			const availableProviders = modelWithMultipleProviders.providers.filter(
				(p) => p.inputPrice !== undefined && p.outputPrice !== undefined,
			);
			if (availableProviders.length <= 1) {
				return;
			}

			const overrides = resolveRoutingConfig(
				{ session: { enabled: false } },
				buildProviderPriorityDefaults(),
			);
			const result = getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
				{ sessionId: "session_abc-123", routingConfig: overrides },
			);

			expect(result?.metadata.selectionReason).not.toBe("session-sticky");
		});

		it("keeps unrelated sessions on their provider when one provider is removed", () => {
			if (!modelWithMultipleProviders) {
				return;
			}
			const availableProviders = modelWithMultipleProviders.providers.filter(
				(p) => p.inputPrice !== undefined && p.outputPrice !== undefined,
			);
			if (availableProviders.length <= 2) {
				return;
			}

			// Find a session pinned to a provider, then drop a *different* provider
			// and confirm the session stays put (rendezvous hashing property).
			const sessionId = "session_stable";
			const pinned = getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
				{ sessionId },
			);
			const removable = availableProviders.find(
				(p) => p.providerId !== pinned?.provider.providerId,
			);
			const reduced = availableProviders.filter(
				(p) => p.providerId !== removable?.providerId,
			);

			const afterRemoval = getCheapestFromAvailableProviders(
				reduced,
				modelWithMultipleProviders,
				{ sessionId },
			);

			expect(afterRemoval?.provider.providerId).toBe(
				pinned?.provider.providerId,
			);
		});
	});

	it("should account for discounts when selecting cheapest provider", () => {
		const discountOf = (p: ProviderModelMapping): number | undefined =>
			p.discount !== undefined ? Number(p.discount) : undefined;
		// Find a model that has both regular and discount providers
		const modelWithDiscountProvider = models.find((model) => {
			const hasRegularProvider = model.providers.some((p) => {
				const d = discountOf(p as ProviderModelMapping);
				return (
					(d === undefined || d === 1) &&
					p.inputPrice !== undefined &&
					p.outputPrice !== undefined
				);
			});
			const hasDiscountProvider = model.providers.some((p) => {
				const d = discountOf(p as ProviderModelMapping);
				return (
					d !== undefined &&
					d < 1 &&
					p.inputPrice !== undefined &&
					p.outputPrice !== undefined
				);
			});
			return hasRegularProvider && hasDiscountProvider;
		});

		if (modelWithDiscountProvider) {
			const regularProvider = modelWithDiscountProvider.providers.find((p) => {
				const d = discountOf(p as ProviderModelMapping);
				return (
					(d === undefined || d === 1) &&
					(p as ProviderModelMapping).stability !== "experimental" &&
					(p as ProviderModelMapping).stability !== "unstable" &&
					p.inputPrice !== undefined &&
					p.outputPrice !== undefined
				);
			});
			const discountProvider = modelWithDiscountProvider.providers.find((p) => {
				const d = discountOf(p as ProviderModelMapping);
				return (
					d !== undefined &&
					d < 1 &&
					(p as ProviderModelMapping).stability !== "experimental" &&
					(p as ProviderModelMapping).stability !== "unstable" &&
					p.inputPrice !== undefined &&
					p.outputPrice !== undefined
				);
			});

			if (regularProvider && discountProvider) {
				const availableProviders = [regularProvider, discountProvider];

				const cheapestProvider = getCheapestFromAvailableProviders(
					availableProviders,
					modelWithDiscountProvider,
				);

				// Calculate actual effective prices with discount and priority
				// The function uses: discountMultiplier = 1 - discount, effectivePrice = totalPrice / priority
				const regularProviderDef = getProviderDefinition(
					regularProvider.providerId,
				);
				const discountProviderDef = getProviderDefinition(
					discountProvider.providerId,
				);
				const regularPriority = regularProviderDef?.priority ?? 1;
				const discountPriority = discountProviderDef?.priority ?? 1;

				const regularBasePrice =
					(Number(regularProvider.inputPrice!) +
						Number(regularProvider.outputPrice!)) /
					2;
				const regularEffectivePrice =
					regularPriority > 0
						? regularBasePrice / regularPriority
						: regularBasePrice;

				const discount = discountOf(discountProvider as ProviderModelMapping)!;
				const discountMultiplier = 1 - discount;
				const discountBasePrice =
					((Number(discountProvider.inputPrice!) +
						Number(discountProvider.outputPrice!)) /
						2) *
					discountMultiplier;
				const discountEffectivePrice =
					discountPriority > 0
						? discountBasePrice / discountPriority
						: discountBasePrice;

				// The provider with lower effective price should be selected
				if (discountEffectivePrice < regularEffectivePrice) {
					expect(cheapestProvider?.provider.providerId).toBe(
						discountProvider.providerId,
					);
				} else {
					expect(cheapestProvider?.provider.providerId).toBe(
						regularProvider.providerId,
					);
				}
			}
		}
	});

	it("should use per-second pricing for video providers", () => {
		const videoModel = models.find(
			(model) => model.id === "veo-3.1-generate-preview",
		);

		expect(videoModel).toBeDefined();

		const availableProviders =
			videoModel?.providers.filter(
				(provider) =>
					provider.providerId === "google-vertex" ||
					provider.providerId === "avalanche",
			) ?? [];

		const cheapestProvider = getCheapestFromAvailableProviders(
			availableProviders,
			videoModel!,
			{
				videoPricing: {
					durationSeconds: 8,
					includeAudio: true,
					resolution: "default",
				},
			},
		);

		expect(cheapestProvider?.provider.providerId).toBe("avalanche");

		const vertexScore = cheapestProvider?.metadata.providerScores.find(
			(provider) => provider.providerId === "google-vertex",
		);
		const avalancheScore = cheapestProvider?.metadata.providerScores.find(
			(provider) => provider.providerId === "avalanche",
		);

		expect(vertexScore?.price).toBeCloseTo(3.2);
		expect(avalancheScore?.price).toBeCloseTo(2.56);
	});

	it("should disable random exploration for vitest processes", () => {
		const videoModel = models.find(
			(model) => model.id === "veo-3.1-generate-preview",
		);

		expect(videoModel).toBeDefined();

		const avalancheProvider = videoModel?.providers.find(
			(provider) => provider.providerId === "avalanche",
		);
		const vertexProvider = videoModel?.providers.find(
			(provider) => provider.providerId === "google-vertex",
		);

		expect(avalancheProvider).toBeDefined();
		expect(vertexProvider).toBeDefined();
		if (!videoModel || !avalancheProvider || !vertexProvider) {
			throw new Error("Missing Veo provider test fixtures");
		}

		const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
		const originalArgv = process.argv;
		const originalNodeEnv = process.env.NODE_ENV;
		const originalVitest = process.env.VITEST;
		delete process.env.NODE_ENV;
		delete process.env.VITEST;
		process.argv = ["node", "/tmp/vitest.mjs"];

		try {
			const result = getCheapestFromAvailableProviders(
				[avalancheProvider, vertexProvider],
				videoModel,
				{
					metricsMap: new Map([
						[
							metricsKey("veo-3.1-generate-preview", "avalanche", undefined),
							{
								modelId: "veo-3.1-generate-preview",
								providerId: "avalanche",
								uptime: 70,
								averageLatency: 300,
								throughput: 50,
								totalRequests: 100,
							},
						],
						[
							metricsKey(
								"veo-3.1-generate-preview",
								"google-vertex",
								undefined,
							),
							{
								modelId: "veo-3.1-generate-preview",
								providerId: "google-vertex",
								uptime: 99.5,
								averageLatency: 100,
								throughput: 150,
								totalRequests: 100,
							},
						],
					]),
					videoPricing: {
						durationSeconds: 8,
						includeAudio: true,
						resolution: "default",
					},
				},
			);

			expect(result?.provider.providerId).toBe("google-vertex");
			expect(result?.metadata.selectionReason).toBe("weighted-score");
		} finally {
			randomSpy.mockRestore();
			process.argv = originalArgv;
			if (originalNodeEnv !== undefined) {
				process.env.NODE_ENV = originalNodeEnv;
			} else {
				delete process.env.NODE_ENV;
			}
			if (originalVitest !== undefined) {
				process.env.VITEST = originalVitest;
			} else {
				delete process.env.VITEST;
			}
		}
	});

	it("should include provider scores during random exploration", () => {
		const videoModel = models.find(
			(model) => model.id === "veo-3.1-generate-preview",
		);

		expect(videoModel).toBeDefined();

		const avalancheProvider = videoModel?.providers.find(
			(provider) => provider.providerId === "avalanche",
		);
		const vertexProvider = videoModel?.providers.find(
			(provider) => provider.providerId === "google-vertex",
		);

		expect(avalancheProvider).toBeDefined();
		expect(vertexProvider).toBeDefined();
		if (!videoModel || !avalancheProvider || !vertexProvider) {
			throw new Error("Missing Veo provider test fixtures");
		}

		const randomSpy = vi
			.spyOn(Math, "random")
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(0);
		const originalArgv = process.argv;
		const originalNodeEnv = process.env.NODE_ENV;
		const originalVitest = process.env.VITEST;
		delete process.env.NODE_ENV;
		delete process.env.VITEST;
		process.argv = ["node", "/tmp/not-a-test-run.mjs"];

		try {
			const result = getCheapestFromAvailableProviders(
				[avalancheProvider, vertexProvider],
				videoModel,
				{
					metricsMap: new Map([
						[
							metricsKey("veo-3.1-generate-preview", "avalanche", undefined),
							{
								modelId: "veo-3.1-generate-preview",
								providerId: "avalanche",
								uptime: 99,
								averageLatency: 300,
								throughput: 50,
								totalRequests: 100,
							},
						],
						[
							metricsKey(
								"veo-3.1-generate-preview",
								"google-vertex",
								undefined,
							),
							{
								modelId: "veo-3.1-generate-preview",
								providerId: "google-vertex",
								uptime: 99.5,
								averageLatency: 100,
								throughput: 150,
								totalRequests: 100,
							},
						],
					]),
					videoPricing: {
						durationSeconds: 8,
						includeAudio: true,
						resolution: "default",
					},
				},
			);

			expect(result?.metadata.selectionReason).toBe("random-exploration");
			expect(result?.metadata.providerScores).toHaveLength(2);
			expect(result?.metadata.providerScores.map((p) => p.providerId)).toEqual(
				expect.arrayContaining(["avalanche", "google-vertex"]),
			);
		} finally {
			randomSpy.mockRestore();
			process.argv = originalArgv;
			if (originalNodeEnv !== undefined) {
				process.env.NODE_ENV = originalNodeEnv;
			} else {
				delete process.env.NODE_ENV;
			}
			if (originalVitest !== undefined) {
				process.env.VITEST = originalVitest;
			} else {
				delete process.env.VITEST;
			}
		}
	});

	it("should return null for empty provider list", () => {
		const testModel = models[0];
		const result = getCheapestFromAvailableProviders([], testModel);
		expect(result).toBe(null);
	});

	it("should use the default exploration rate when EXPLORATION_RATE is empty", () => {
		const originalExplorationRate = process.env.EXPLORATION_RATE;
		process.env.EXPLORATION_RATE = "";

		try {
			const testModel = models.find((model) => model.id === "gpt-4o-mini");
			if (!testModel) {
				throw new Error("Missing gpt-4o-mini test fixture");
			}

			expect(() =>
				getCheapestFromAvailableProviders(
					[
						{
							providerId: "openai",
							externalId: "gpt-4o-mini",
						},
					],
					testModel,
				),
			).not.toThrow();
		} finally {
			if (originalExplorationRate === undefined) {
				delete process.env.EXPLORATION_RATE;
			} else {
				process.env.EXPLORATION_RATE = originalExplorationRate;
			}
		}
	});

	it("should throw when EXPLORATION_RATE is outside the valid range", () => {
		const originalExplorationRate = process.env.EXPLORATION_RATE;
		const originalArgv = process.argv;
		const originalNodeEnv = process.env.NODE_ENV;
		const originalVitest = process.env.VITEST;
		process.env.EXPLORATION_RATE = "1.5";
		delete process.env.NODE_ENV;
		delete process.env.VITEST;
		process.argv = ["node", "/tmp/not-a-test-run.mjs"];

		try {
			const testModel = models.find((model) => model.id === "gpt-4o-mini");
			if (!testModel) {
				throw new Error("Missing gpt-4o-mini test fixture");
			}

			expect(() =>
				getCheapestFromAvailableProviders(
					[
						{
							providerId: "openai",
							externalId: "gpt-4o-mini",
						},
					],
					testModel,
				),
			).toThrow(
				'Invalid EXPLORATION_RATE: "1.5". Expected a number between 0 and 1.',
			);
		} finally {
			process.argv = originalArgv;
			if (originalNodeEnv !== undefined) {
				process.env.NODE_ENV = originalNodeEnv;
			} else {
				delete process.env.NODE_ENV;
			}
			if (originalVitest !== undefined) {
				process.env.VITEST = originalVitest;
			} else {
				delete process.env.VITEST;
			}
			if (originalExplorationRate === undefined) {
				delete process.env.EXPLORATION_RATE;
			} else {
				process.env.EXPLORATION_RATE = originalExplorationRate;
			}
		}
	});

	it("should prefer request pricing over zero token placeholders", () => {
		expect(
			getProviderSelectionPrice({
				inputPrice: "0",
				outputPrice: "0",
				requestPrice: "0.03",
			}).toNumber(),
		).toBe(0.03);
	});

	it("should compute exact prices without IEEE-754 noise", () => {
		// Raw JS arithmetic on these inputs produces 0.020000000000000004; the
		// Decimal-backed implementation must return exactly 0.02.
		expect(
			getProviderSelectionPrice({
				inputPrice: "0.01",
				outputPrice: "0.03",
			}).toNumber(),
		).toBe(0.02);

		// Per-token rates expressed as USD/1M tokens. Ensure (input + output) / 2
		// lands on a clean decimal even when the inputs already round-tripped
		// through Number division.
		expect(
			getProviderSelectionPrice({
				inputPrice: "0.15e-6",
				outputPrice: "0.6e-6",
			}).toNumber(),
		).toBe(0.375 / 1e6);

		// Discount path: 0.02 * (1 - 0.1) under raw JS gives 0.018000000000000002.
		expect(
			getProviderSelectionPrice({
				inputPrice: "0.01",
				outputPrice: "0.03",
				discount: "0.1",
			}).toNumber(),
		).toBe(0.018);
	});

	describe("cache support weighting", () => {
		const cacheTestModel = {
			id: "cache-test-model",
			name: "Cache Test Model",
			family: "openai" as const,
			providers: [
				{
					providerId: "openai" as const,
					externalId: "cache-test",
					inputPrice: "1.0e-6",
					outputPrice: "2.0e-6",
					cachedInputPrice: "0.1e-6",
					streaming: true as const,
				},
				{
					providerId: "deepseek" as const,
					externalId: "cache-test",
					inputPrice: "1.0e-6",
					outputPrice: "2.0e-6",
					streaming: true as const,
				},
			],
		};

		const equalMetrics = new Map([
			[
				metricsKey("cache-test-model", "openai", undefined),
				{
					modelId: "cache-test-model",
					providerId: "openai",
					uptime: 99.5,
					averageLatency: 200,
					throughput: 100,
					totalRequests: 100,
				},
			],
			[
				metricsKey("cache-test-model", "deepseek", undefined),
				{
					modelId: "cache-test-model",
					providerId: "deepseek",
					uptime: 99.5,
					averageLatency: 200,
					throughput: 100,
					totalRequests: 100,
				},
			],
		]);

		// Neutralize provider priority defaults so these tests isolate cache
		// support weighting from any per-provider priority bias.
		const equalPriorityConfig = resolveRoutingConfig(
			{ providerPriorities: { openai: 1, deepseek: 1 } },
			buildProviderPriorityDefaults(),
		);

		it("does not factor cache support when prompt is below the threshold", () => {
			const result = getCheapestFromAvailableProviders(
				cacheTestModel.providers,
				cacheTestModel,
				{
					metricsMap: equalMetrics,
					promptTokens: 1000,
					routingConfig: equalPriorityConfig,
				},
			);

			const openai = result?.metadata.providerScores.find(
				(p) => p.providerId === "openai",
			);
			const deepseek = result?.metadata.providerScores.find(
				(p) => p.providerId === "deepseek",
			);

			expect(openai?.score).toBe(deepseek?.score);
		});

		it("prefers a cache-supporting provider when prompt is large", () => {
			const result = getCheapestFromAvailableProviders(
				cacheTestModel.providers,
				cacheTestModel,
				{
					metricsMap: equalMetrics,
					promptTokens: 8000,
					routingConfig: equalPriorityConfig,
				},
			);

			expect(result?.provider.providerId).toBe("openai");

			const openai = result?.metadata.providerScores.find(
				(p) => p.providerId === "openai",
			);
			const deepseek = result?.metadata.providerScores.find(
				(p) => p.providerId === "deepseek",
			);

			expect(openai?.cacheSupported).toBe(true);
			expect(deepseek?.cacheSupported).toBe(false);
			expect((openai?.score ?? 0) < (deepseek?.score ?? 0)).toBe(true);
		});

		it("does not override a much cheaper non-cache provider for large prompts", () => {
			const cheapNoCacheModel = {
				...cacheTestModel,
				providers: [
					{
						providerId: "openai" as const,
						externalId: "cache-test",
						inputPrice: "10.0e-6",
						outputPrice: "20.0e-6",
						cachedInputPrice: "1.0e-6",
						streaming: true as const,
					},
					{
						providerId: "deepseek" as const,
						externalId: "cache-test",
						inputPrice: "1.0e-6",
						outputPrice: "2.0e-6",
						streaming: true as const,
					},
				],
			};

			const result = getCheapestFromAvailableProviders(
				cheapNoCacheModel.providers,
				cheapNoCacheModel,
				{
					metricsMap: equalMetrics,
					promptTokens: 10_000,
					routingConfig: equalPriorityConfig,
				},
			);

			expect(result?.provider.providerId).toBe("deepseek");
		});
	});

	describe("routing config overrides", () => {
		it("excludes providers whose override priority is 0", () => {
			const model = models.find((m) => m.id === "gpt-4o-mini");
			if (!model) {
				throw new Error("Missing gpt-4o-mini fixture");
			}
			const providersWithOpenAi = (
				model.providers as ProviderModelMapping[]
			).filter((p) => p.providerId === "openai");
			if (providersWithOpenAi.length === 0) {
				return;
			}

			const overrides = resolveRoutingConfig(
				{ providerPriorities: { openai: 0 } },
				buildProviderPriorityDefaults(),
			);
			const result = getCheapestFromAvailableProviders(
				providersWithOpenAi,
				model,
				{ routingConfig: overrides },
			);

			expect(result).toBe(null);
		});

		it("accepts custom thresholds without failing selection", () => {
			const model = models.find((m) => m.providers.length >= 2);
			if (!model) {
				return;
			}
			const available = (model.providers as ProviderModelMapping[]).slice(0, 2);

			const overrides = resolveRoutingConfig(
				{ thresholds: { defaultUptime: 50 } },
				buildProviderPriorityDefaults(),
			);
			const result = getCheapestFromAvailableProviders(available, model, {
				routingConfig: overrides,
				metricsMap: new Map(),
			});
			expect(result).not.toBeNull();
		});

		it("falls back to price-only selection when every scoring weight is zero", () => {
			const model = models.find((m) => m.id === "gpt-4o-mini");
			if (!model) {
				throw new Error("Missing gpt-4o-mini fixture");
			}
			const available = (model.providers as ProviderModelMapping[]).filter(
				(p) => p.providerId === "openai",
			);
			if (available.length === 0) {
				return;
			}

			const overrides = resolveRoutingConfig(
				{
					weights: {
						price: 0,
						imagePrice: 0,
						uptime: 0,
						throughput: 0,
						latency: 0,
						cache: 0,
					},
				},
				buildProviderPriorityDefaults(),
			);

			// Provide a non-empty metrics map so we follow the weighted-score
			// branch rather than the empty-map shortcut.
			const metricsMap = new Map([
				[
					metricsKey(model.id, available[0].providerId, available[0].region),
					{
						providerId: available[0].providerId,
						modelId: model.id,
						uptime: 99,
						averageLatency: 100,
						throughput: 100,
						totalRequests: 50,
					},
				],
			]);

			expect(() =>
				getCheapestFromAvailableProviders(available, model, {
					routingConfig: overrides,
					metricsMap,
				}),
			).not.toThrow();

			const result = getCheapestFromAvailableProviders(available, model, {
				routingConfig: overrides,
				metricsMap,
			});
			expect(result).not.toBeNull();
			expect(result?.metadata.selectionReason).toBe("price-only-no-metrics");
		});
	});
});
