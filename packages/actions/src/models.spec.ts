import { describe, expect, it, vi } from "vitest";

import { metricsKey } from "@llmgateway/db";
import {
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
	type SessionProviderEntry,
	type SessionProviderStore,
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
});

describe("getCheapestFromAvailableProviders", () => {
	it("should return cheapest provider from available providers", async () => {
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
				const cheapestProvider = await getCheapestFromAvailableProviders(
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

		function createMemoryStore(
			initial: SessionProviderEntry | null = null,
		): SessionProviderStore & {
			value: SessionProviderEntry | null;
			setCalls: SessionProviderEntry[];
		} {
			const store = {
				value: initial,
				setCalls: [] as SessionProviderEntry[],
				get: async () => store.value,
				set: async (providerId: string, region?: string) => {
					store.value = { providerId, region };
					store.setCalls.push({ providerId, region });
				},
			};
			return store;
		}

		// openai is priced ~5x cheaper than deepseek, so with equal priority and
		// equal metrics the weighted-score winner is always openai. This lets the
		// tests assert that stickiness keeps a session on a *more expensive*
		// provider once pinned.
		const stickyModel = {
			id: "sticky-routing-model",
			name: "Sticky Routing Model",
			family: "openai" as const,
			providers: [
				{
					providerId: "openai" as const,
					externalId: "sticky-openai",
					inputPrice: "1.0e-6",
					outputPrice: "2.0e-6",
					streaming: true as const,
				},
				{
					providerId: "deepseek" as const,
					externalId: "sticky-deepseek",
					inputPrice: "5.0e-6",
					outputPrice: "10.0e-6",
					streaming: true as const,
				},
			],
		};

		// Neutralize per-provider priority defaults (deepseek ships with priority 2)
		// so these tests isolate price + uptime behavior from priority bias.
		const equalPriority = resolveRoutingConfig(
			{ providerPriorities: { openai: 1, deepseek: 1 } },
			buildProviderPriorityDefaults(),
		);

		function stickyMetrics(openaiUptime: number, deepseekUptime: number) {
			return new Map([
				[
					metricsKey(stickyModel.id, "openai", undefined),
					{
						modelId: stickyModel.id,
						providerId: "openai",
						uptime: openaiUptime,
						averageLatency: 200,
						throughput: 100,
						totalRequests: 100,
					},
				],
				[
					metricsKey(stickyModel.id, "deepseek", undefined),
					{
						modelId: stickyModel.id,
						providerId: "deepseek",
						uptime: deepseekUptime,
						averageLatency: 200,
						throughput: 100,
						totalRequests: 100,
					},
				],
			]);
		}

		it("scores the best provider, pins it, and reuses it on the next request", async () => {
			if (!modelWithMultipleProviders) {
				return;
			}
			const availableProviders = modelWithMultipleProviders.providers.filter(
				(p) => p.inputPrice !== undefined && p.outputPrice !== undefined,
			);
			if (availableProviders.length <= 1) {
				return;
			}

			const store = createMemoryStore();
			const first = await getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
				{ sessionProviderStore: store },
			);
			const second = await getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
				{ sessionProviderStore: store },
			);

			const regionOf = (p: unknown) =>
				(p as { region?: string } | undefined)?.region;

			expect(first?.metadata.selectionReason).toBe("session-sticky");
			// The freshly scored best is persisted to the store.
			expect(store.value?.providerId).toBe(first?.provider.providerId);
			// The next request for the same session reuses the pinned provider.
			expect(second?.provider.providerId).toBe(first?.provider.providerId);
			expect(regionOf(second?.provider)).toBe(regionOf(first?.provider));
		});

		it("pins the same provider the weighted algorithm would pick without a session", async () => {
			if (!modelWithMultipleProviders) {
				return;
			}
			const availableProviders = modelWithMultipleProviders.providers.filter(
				(p) => p.inputPrice !== undefined && p.outputPrice !== undefined,
			);
			if (availableProviders.length <= 1) {
				return;
			}

			const withoutSession = await getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
			);
			const store = createMemoryStore();
			const withSession = await getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
				{ sessionProviderStore: store },
			);

			expect(withSession?.provider.providerId).toBe(
				withoutSession?.provider.providerId,
			);
		});

		it("does not pin a session when session stickiness is disabled", async () => {
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
			const store = createMemoryStore();
			const result = await getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
				{ sessionProviderStore: store, routingConfig: overrides },
			);

			expect(result?.metadata.selectionReason).not.toBe("session-sticky");
			expect(store.value).toBeNull();
		});

		it("re-pins to the current best when the saved provider is gone", async () => {
			if (!modelWithMultipleProviders) {
				return;
			}
			const availableProviders = modelWithMultipleProviders.providers.filter(
				(p) => p.inputPrice !== undefined && p.outputPrice !== undefined,
			);
			if (availableProviders.length <= 1) {
				return;
			}

			// Saved provider is not in the available list (e.g. health-filtered),
			// so the session is re-scored and re-pinned to the current best.
			const store = createMemoryStore({
				providerId: "definitely-not-a-real-provider",
			});
			const result = await getCheapestFromAvailableProviders(
				availableProviders,
				modelWithMultipleProviders,
				{ sessionProviderStore: store },
			);

			expect(result?.metadata.selectionReason).toBe("session-sticky");
			expect(result?.provider.providerId).not.toBe(
				"definitely-not-a-real-provider",
			);
			expect(store.value?.providerId).toBe(result?.provider.providerId);
		});

		it("uses the weighted-score winner for a new session and persists it", async () => {
			const store = createMemoryStore();
			const result = await getCheapestFromAvailableProviders(
				stickyModel.providers,
				stickyModel,
				{
					metricsMap: stickyMetrics(99, 99),
					routingConfig: equalPriority,
					sessionProviderStore: store,
				},
			);

			expect(result?.provider.providerId).toBe("openai");
			expect(result?.metadata.selectionReason).toBe("session-sticky");
			expect(store.value).toEqual({ providerId: "openai", region: undefined });
		});

		it("pins the full weighted-score winner, not merely the cheapest provider", async () => {
			// openai is ~5x cheaper, but its uptime is poor. The full weighted
			// score (price + uptime + throughput + priority, not price alone) makes
			// the more expensive deepseek the winner — and that is what gets pinned.
			const store = createMemoryStore();
			const result = await getCheapestFromAvailableProviders(
				stickyModel.providers,
				stickyModel,
				{
					metricsMap: stickyMetrics(50, 100),
					routingConfig: equalPriority,
					sessionProviderStore: store,
				},
			);

			expect(result?.provider.providerId).toBe("deepseek");
			expect(store.value).toEqual({
				providerId: "deepseek",
				region: undefined,
			});
		});

		it("keeps the session on its pinned provider even when a cheaper one is available", async () => {
			// Previously pinned to the more expensive deepseek.
			const store = createMemoryStore({ providerId: "deepseek" });
			const result = await getCheapestFromAvailableProviders(
				stickyModel.providers,
				stickyModel,
				{
					metricsMap: stickyMetrics(99, 99),
					routingConfig: equalPriority,
					sessionProviderStore: store,
				},
			);

			// Cheaper openai exists, but stickiness keeps the cache warm on deepseek.
			expect(result?.provider.providerId).toBe("deepseek");
			expect(result?.metadata.selectionReason).toBe("session-sticky");
		});

		it("refreshes the pin (its TTL) on reuse", async () => {
			const store = createMemoryStore({ providerId: "deepseek" });
			await getCheapestFromAvailableProviders(
				stickyModel.providers,
				stickyModel,
				{
					metricsMap: stickyMetrics(99, 99),
					routingConfig: equalPriority,
					sessionProviderStore: store,
				},
			);

			expect(store.setCalls).toEqual([
				{ providerId: "deepseek", region: undefined },
			]);
		});

		it("re-pins to the best provider when the pinned one's uptime is too low", async () => {
			// deepseek is pinned but its uptime fell below the 85% session threshold.
			const store = createMemoryStore({ providerId: "deepseek" });
			const result = await getCheapestFromAvailableProviders(
				stickyModel.providers,
				stickyModel,
				{
					metricsMap: stickyMetrics(99, 50),
					routingConfig: equalPriority,
					sessionProviderStore: store,
				},
			);

			expect(result?.provider.providerId).toBe("openai");
			expect(result?.metadata.selectionReason).toBe("session-sticky");
			expect(store.value).toEqual({ providerId: "openai", region: undefined });
		});

		it("keeps the pin when uptime is exactly at the threshold", async () => {
			const store = createMemoryStore({ providerId: "deepseek" });
			const result = await getCheapestFromAvailableProviders(
				stickyModel.providers,
				stickyModel,
				{
					metricsMap: stickyMetrics(99, 85),
					routingConfig: equalPriority,
					sessionProviderStore: store,
				},
			);

			expect(result?.provider.providerId).toBe("deepseek");
		});

		it("honors a custom session uptime threshold", async () => {
			const strictThreshold = resolveRoutingConfig(
				{
					providerPriorities: { openai: 1, deepseek: 1 },
					session: { uptimeThreshold: 95 },
				},
				buildProviderPriorityDefaults(),
			);
			const store = createMemoryStore({ providerId: "deepseek" });
			const result = await getCheapestFromAvailableProviders(
				stickyModel.providers,
				stickyModel,
				{
					metricsMap: stickyMetrics(99, 90), // 90 < 95 → re-pin
					routingConfig: strictThreshold,
					sessionProviderStore: store,
				},
			);

			expect(result?.provider.providerId).toBe("openai");
		});

		it("ignores the saved provider and the store when stickiness is disabled", async () => {
			const disabled = resolveRoutingConfig(
				{
					providerPriorities: { openai: 1, deepseek: 1 },
					session: { enabled: false },
				},
				buildProviderPriorityDefaults(),
			);
			const store = createMemoryStore({ providerId: "deepseek" });
			const result = await getCheapestFromAvailableProviders(
				stickyModel.providers,
				stickyModel,
				{
					metricsMap: stickyMetrics(99, 99),
					routingConfig: disabled,
					sessionProviderStore: store,
				},
			);

			// Falls back to the weighted winner and never touches the store.
			expect(result?.provider.providerId).toBe("openai");
			expect(result?.metadata.selectionReason).not.toBe("session-sticky");
			expect(store.setCalls).toEqual([]);
			expect(store.value).toEqual({ providerId: "deepseek" });
		});

		it("reuses the pinned region and re-pins when the saved region is gone", async () => {
			// Same provider, two regions; r1 is cheaper than r2.
			const regionModel = {
				id: "sticky-region-model",
				name: "Sticky Region Model",
				family: "openai" as const,
				providers: [
					{
						providerId: "openai" as const,
						externalId: "sticky-r1",
						region: "r1",
						inputPrice: "1.0e-6",
						outputPrice: "2.0e-6",
						streaming: true as const,
					},
					{
						providerId: "openai" as const,
						externalId: "sticky-r2",
						region: "r2",
						inputPrice: "5.0e-6",
						outputPrice: "10.0e-6",
						streaming: true as const,
					},
				],
			};
			const regionMetrics = new Map([
				[
					metricsKey(regionModel.id, "openai", "r1"),
					{
						modelId: regionModel.id,
						providerId: "openai",
						region: "r1",
						uptime: 99,
						averageLatency: 200,
						throughput: 100,
						totalRequests: 100,
					},
				],
				[
					metricsKey(regionModel.id, "openai", "r2"),
					{
						modelId: regionModel.id,
						providerId: "openai",
						region: "r2",
						uptime: 99,
						averageLatency: 200,
						throughput: 100,
						totalRequests: 100,
					},
				],
			]);

			// Pinned to the pricier r2 → stays on r2.
			const pinned = createMemoryStore({ providerId: "openai", region: "r2" });
			const reused = await getCheapestFromAvailableProviders(
				regionModel.providers,
				regionModel,
				{
					metricsMap: regionMetrics,
					routingConfig: equalPriority,
					sessionProviderStore: pinned,
				},
			);
			expect(reused?.provider.region).toBe("r2");

			// Saved region no longer offered → re-pin to the best region (r1).
			const stale = createMemoryStore({ providerId: "openai", region: "gone" });
			const repinned = await getCheapestFromAvailableProviders(
				regionModel.providers,
				regionModel,
				{
					metricsMap: regionMetrics,
					routingConfig: equalPriority,
					sessionProviderStore: stale,
				},
			);
			expect(repinned?.provider.region).toBe("r1");
			expect(stale.value).toEqual({ providerId: "openai", region: "r1" });
		});
	});

	it("should use per-second pricing for video providers", async () => {
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

		const cheapestProvider = await getCheapestFromAvailableProviders(
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
		expect(avalancheScore?.price).toBeCloseTo(3.2);
	});

	it("should apply effective discounts before comparing provider prices", async () => {
		const discountRoutingModel = {
			id: "discount-routing-test",
			name: "Discount Routing Test",
			family: "openai" as const,
			providers: [
				{
					providerId: "openai" as const,
					externalId: "discount-routing-test",
					inputPrice: "2",
					outputPrice: "2",
					streaming: true as const,
				},
				{
					providerId: "anthropic" as const,
					externalId: "discount-routing-test",
					inputPrice: "1",
					outputPrice: "1",
					streaming: true as const,
				},
			],
		};
		const equalPriorityConfig = resolveRoutingConfig(
			{ providerPriorities: { openai: 1, anthropic: 1 } },
			buildProviderPriorityDefaults(),
		);

		const result = await getCheapestFromAvailableProviders(
			discountRoutingModel.providers,
			discountRoutingModel,
			{
				routingConfig: equalPriorityConfig,
				providerDiscountResolver: (provider) =>
					provider.providerId === "openai" ? "0.6" : "0",
			},
		);

		expect(result?.provider.providerId).toBe("openai");
		expect(
			result?.metadata.providerScores.find(
				(score) => score.providerId === "openai",
			)?.price,
		).toBe(0.8);
	});

	it("should disable random exploration for vitest processes", async () => {
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
			const result = await getCheapestFromAvailableProviders(
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

	it("should include provider scores during random exploration", async () => {
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
			const result = await getCheapestFromAvailableProviders(
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

	it("should return null for empty provider list", async () => {
		const testModel = models[0];
		const result = await getCheapestFromAvailableProviders([], testModel);
		expect(result).toBe(null);
	});

	it("should use the default exploration rate when EXPLORATION_RATE is empty", async () => {
		const originalExplorationRate = process.env.EXPLORATION_RATE;
		process.env.EXPLORATION_RATE = "";

		try {
			const testModel = models.find((model) => model.id === "gpt-4o-mini");
			if (!testModel) {
				throw new Error("Missing gpt-4o-mini test fixture");
			}

			const result = await getCheapestFromAvailableProviders(
				[
					{
						providerId: "openai",
						externalId: "gpt-4o-mini",
					},
				],
				testModel,
			);

			expect(result).not.toBeNull();
		} finally {
			if (originalExplorationRate === undefined) {
				delete process.env.EXPLORATION_RATE;
			} else {
				process.env.EXPLORATION_RATE = originalExplorationRate;
			}
		}
	});

	it("should throw when EXPLORATION_RATE is outside the valid range", async () => {
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

			await expect(
				getCheapestFromAvailableProviders(
					[
						{
							providerId: "openai",
							externalId: "gpt-4o-mini",
						},
					],
					testModel,
				),
			).rejects.toThrow(
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

		it("does not factor cache support when prompt is below the threshold", async () => {
			const result = await getCheapestFromAvailableProviders(
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

		it("prefers a cache-supporting provider when prompt is large", async () => {
			const result = await getCheapestFromAvailableProviders(
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

		it("does not override a much cheaper non-cache provider for large prompts", async () => {
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

			const result = await getCheapestFromAvailableProviders(
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
		it("excludes providers whose override priority is 0", async () => {
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
			const result = await getCheapestFromAvailableProviders(
				providersWithOpenAi,
				model,
				{ routingConfig: overrides },
			);

			expect(result).toBe(null);
		});

		it("accepts custom thresholds without failing selection", async () => {
			const model = models.find((m) => m.providers.length >= 2);
			if (!model) {
				return;
			}
			const available = (model.providers as ProviderModelMapping[]).slice(0, 2);

			const overrides = resolveRoutingConfig(
				{ thresholds: { defaultUptime: 50 } },
				buildProviderPriorityDefaults(),
			);
			const result = await getCheapestFromAvailableProviders(available, model, {
				routingConfig: overrides,
				metricsMap: new Map(),
			});
			expect(result).not.toBeNull();
		});

		it("falls back to price-only selection when every scoring weight is zero", async () => {
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

			const result = await getCheapestFromAvailableProviders(available, model, {
				routingConfig: overrides,
				metricsMap,
			});
			expect(result).not.toBeNull();
			expect(result?.metadata.selectionReason).toBe("price-only-no-metrics");
		});
	});
});
