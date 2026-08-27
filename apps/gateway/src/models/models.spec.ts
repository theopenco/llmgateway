import { beforeAll, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";

import { cdb, tables } from "@llmgateway/db";
import { models as modelsList, providers } from "@llmgateway/models";

import type { ProviderModelMapping } from "@llmgateway/models";

describe("Models API", () => {
	beforeAll(async () => {
		// These tests derive expectations from the static catalogue alone, so
		// Airside listings leaked by an interrupted spec would skew them.
		// cdb: the gateway reads listings through the Redis query cache, so the
		// cleanup must invalidate it too.
		await cdb.delete(tables.providerPriceFiling);
		await cdb.delete(tables.providerDraftModel);
	});

	test("GET /v1/models should return a list of models", async () => {
		const res = await app.request("/v1/models");

		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("data");
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.data.length).toBeGreaterThan(0);

		// Check the structure of the first model
		const firstModel = json.data[0];
		expect(firstModel).toHaveProperty("id");
		expect(firstModel).toHaveProperty("name");
		expect(firstModel).toHaveProperty("created");
		expect(firstModel).toHaveProperty("architecture");
		expect(firstModel.architecture).toHaveProperty("input_modalities");
		expect(firstModel.architecture).toHaveProperty("output_modalities");
		expect(firstModel).toHaveProperty("top_provider");

		expect(firstModel).toHaveProperty("providers");
		expect(Array.isArray(firstModel.providers)).toBe(true);
		expect(firstModel.providers.length).toBeGreaterThan(0);

		// Check the structure of the first provider
		const firstProvider = firstModel.providers[0];
		expect(firstProvider).toHaveProperty("providerId");
		expect(firstProvider).toHaveProperty("externalId");
		if (firstProvider.pricing) {
			expect(firstProvider.pricing).toHaveProperty("prompt");
			expect(firstProvider.pricing).toHaveProperty("completion");
		}

		expect(firstModel).toHaveProperty("pricing");
		expect(firstModel.pricing).toHaveProperty("prompt");
		expect(firstModel.pricing).toHaveProperty("completion");

		expect(firstModel).toHaveProperty("family");
		expect(firstModel).toHaveProperty("json_output");
		expect(firstModel).toHaveProperty("structured_outputs");
	});

	// Claude Code populates its /model picker from GET /v1/models?limit=1000 when
	// CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1. It reads `id` and the optional
	// `display_name` off each `data` entry and drops ids that don't start with
	// "claude"/"anthropic", so our Claude models must keep carrying a label.
	test("GET /v1/models serves the Claude Code gateway discovery contract", async () => {
		const res = await app.request("/v1/models?limit=1000");
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(Array.isArray(json.data)).toBe(true);

		for (const model of json.data) {
			expect(typeof model.id).toBe("string");
			expect(typeof model.display_name).toBe("string");
			expect(model.display_name.length).toBeGreaterThan(0);
		}

		const discoverable = json.data.filter(
			(m: { id: string }) =>
				m.id.startsWith("claude") || m.id.startsWith("anthropic"),
		);
		expect(discoverable.length).toBeGreaterThan(0);

		const sonnet = discoverable.find(
			(m: { id: string }) => m.id === "claude-sonnet-5",
		);
		expect(sonnet?.display_name).toBe("Claude Sonnet 5");
	});

	test("GET /v1/models?mapped=true returns one provider-prefixed entry per mapping", async () => {
		const [mappedRes, canonicalRes] = await Promise.all([
			app.request("/v1/models?mapped=true"),
			app.request("/v1/models"),
		]);
		expect(mappedRes.status).toBe(200);
		const mapped = await mappedRes.json();
		const canonical = await canonicalRes.json();

		expect(Array.isArray(mapped.data)).toBe(true);
		// The mapped view expands multi-provider models, so it must be strictly
		// larger than the aggregated catalogue.
		expect(mapped.data.length).toBeGreaterThan(canonical.data.length);

		// Ids are `provider/model-id`, unique, and each entry carries exactly the
		// one mapping named by its prefix.
		const ids = mapped.data.map((m: { id: string }) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const model of mapped.data) {
			expect(model.providers).toHaveLength(1);
			expect(model.id).toBe(
				`${model.providers[0].providerId}/${model.id.split("/").slice(1).join("/")}`,
			);
		}

		// Entry-level pricing/context come from that specific mapping, not the
		// cheapest mapping across providers.
		const sonnet = mapped.data.find(
			(m: { id: string }) => m.id === "anthropic/claude-sonnet-5",
		);
		expect(sonnet).toBeDefined();
		expect(sonnet.display_name).toBe("Claude Sonnet 5 (Anthropic)");
		expect(sonnet.pricing.prompt).toBe(sonnet.providers[0].pricing.prompt);
	});

	test("GET /v1/models exposes min_cacheable_tokens on provider mappings that define it", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);
		const json = await res.json();

		const haiku = json.data.find(
			(m: { id: string }) => m.id === "claude-haiku-4-5",
		);
		expect(haiku).toBeDefined();
		const anthropicMapping = haiku.providers.find(
			(p: { providerId: string }) => p.providerId === "anthropic",
		);
		expect(anthropicMapping.min_cacheable_tokens).toBe(4096);

		// Models without a defined threshold must omit the field entirely.
		const gpt4o = json.data.find((m: { id: string }) => m.id === "gpt-4o");
		if (gpt4o) {
			for (const p of gpt4o.providers) {
				expect(p.min_cacheable_tokens).toBeUndefined();
			}
		}
	});

	test("GET /v1/models exposes max_output per provider mapping and as the safe model-level minimum", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);
		const json = await res.json();

		const haiku = json.data.find(
			(m: { id: string }) => m.id === "claude-haiku-4-5",
		);
		expect(haiku).toBeDefined();
		const anthropicMapping = haiku.providers.find(
			(p: { providerId: string }) => p.providerId === "anthropic",
		);
		expect(anthropicMapping.max_output).toBe(64000);
		expect(haiku.max_output).toBe(64000);

		// The model-level value must be the minimum across still-servable
		// mappings that declare a limit (requests are validated against the
		// serving mapping's maxOutput, and deactivated mappings can no longer
		// serve), and omitted entirely when no such mapping declares one.
		const now = new Date();
		const definitionById = new Map(modelsList.map((m) => [m.id, m]));
		for (const model of json.data) {
			const definition = definitionById.get(model.id);
			expect(definition).toBeDefined();
			const limits = (definition!.providers as ProviderModelMapping[])
				.filter((p) => !(p.deactivatedAt && now > p.deactivatedAt))
				.map((p) => p.maxOutput)
				.filter((limit): limit is number => limit !== undefined);

			expect(model.max_output).toBe(
				limits.length > 0 ? Math.min(...limits) : undefined,
			);
		}

		// kimi-k2 has a deactivated mapping declaring 8192; the advertised bound
		// must come from the mappings that can still serve (131072), not from
		// limits that no longer apply. deepseek-v3.2 used to pin this case, but
		// Qianfan serves it with a genuine 32768 output cap, which matches the
		// deactivated Nebius limit and left the assertion unable to tell the two
		// apart.
		const kimi = json.data.find((m: { id: string }) => m.id === "kimi-k2");
		expect(kimi).toBeDefined();
		expect(kimi.max_output).toBe(131072);
	});

	test("GET /v1/models exposes reasoning_efforts on provider mappings that define them", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);
		const json = await res.json();

		const sol = json.data.find((m: { id: string }) => m.id === "gpt-5.6-sol");
		expect(sol).toBeDefined();
		const openaiMapping = sol.providers.find(
			(p: { providerId: string }) => p.providerId === "openai",
		);
		expect(openaiMapping.reasoning_efforts).toEqual([
			"none",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);

		const opus = json.data.find(
			(m: { id: string }) => m.id === "claude-opus-4-7",
		);
		expect(opus).toBeDefined();
		const anthropicMapping = opus.providers.find(
			(p: { providerId: string }) => p.providerId === "anthropic",
		);
		expect(anthropicMapping.reasoning_efforts).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);

		// Mappings without declared effort values must omit the field entirely.
		const gpt4o = json.data.find((m: { id: string }) => m.id === "gpt-4o");
		if (gpt4o) {
			for (const p of gpt4o.providers) {
				expect(p.reasoning_efforts).toBeUndefined();
			}
		}
	});

	test("GET /v1/models should exclude deactivated models by default", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const json = await res.json();

		// The model-level deactivated_at field is only set once EVERY provider
		// mapping has a deactivation date, and then reports the latest of them
		// (when the model becomes fully unavailable). A model is only excluded once
		// all providers are deactivated, so partially deactivated models still
		// appear and a present deactivated_at may be in the past.

		// Verify we got some models back
		expect(json.data.length).toBeGreaterThan(0);

		// The deactivated_at field should be a valid ISO date string if present
		for (const model of json.data) {
			if (model.deactivated_at) {
				const deactivatedAt = new Date(model.deactivated_at);
				expect(deactivatedAt instanceof Date).toBe(true);
				expect(isNaN(deactivatedAt.getTime())).toBe(false);
			}
		}
	});

	test("GET /v1/models reports model-level deprecated_at/deactivated_at as the latest date across all mappings, set only when every mapping has one", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.data.length).toBeGreaterThan(0);

		const definitionById = new Map(modelsList.map((m) => [m.id, m]));

		const expectedDate = (dates: (Date | undefined)[]) => {
			if (dates.length === 0 || dates.some((d) => d === undefined)) {
				return undefined;
			}
			return (dates as Date[])
				.reduce((latest, d) => (d.getTime() > latest.getTime() ? d : latest))
				.toISOString();
		};

		for (const model of json.data) {
			const definition = definitionById.get(model.id);
			expect(definition).toBeDefined();
			const mappings = definition!.providers as ProviderModelMapping[];

			expect(model.deactivated_at).toBe(
				expectedDate(mappings.map((p) => p.deactivatedAt)),
			);
			expect(model.deprecated_at).toBe(
				expectedDate(mappings.map((p) => p.deprecatedAt)),
			);
		}
	});

	test("GET /v1/models?include_deactivated=true should include deactivated models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("data");
		expect(Array.isArray(json.data)).toBe(true);

		// The response should include all models (including deactivated ones)
		// We can't easily test this without knowing specific deactivated models,
		// but we can at least verify the endpoint works with the parameter
		expect(json.data.length).toBeGreaterThan(0);
	});

	test("GET /v1/models?exclude_deprecated=true should exclude deprecated models", async () => {
		const res = await app.request("/v1/models?exclude_deprecated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		// The model-level deprecated_at field is only set once EVERY provider
		// mapping has a deprecation date, and then reports the latest of them.
		// A model is only excluded when ALL its providers are deprecated (have past
		// dates), so models with some deprecated providers but other active
		// providers are correctly included, and deprecated_at may be undefined.

		// Verify we got some models back and the response is valid
		expect(json.data.length).toBeGreaterThan(0);

		// Verify deprecated_at field is a valid ISO date string if present
		for (const model of json.data) {
			if (model.deprecated_at) {
				const deprecatedAt = new Date(model.deprecated_at);
				expect(deprecatedAt instanceof Date).toBe(true);
				expect(isNaN(deprecatedAt.getTime())).toBe(false);
			}
		}
	});

	test("GET /v1/models should handle both parameters together", async () => {
		const res = await app.request(
			"/v1/models?include_deactivated=true&exclude_deprecated=true",
		);
		expect(res.status).toBe(200);

		const json = await res.json();

		// Should include deactivated models but exclude models where ALL providers are deprecated.
		// Models with some deprecated providers but other active providers are included,
		// so deprecated_at may be in the past for partially deprecated models.

		// Verify we got some models back and the response is valid
		expect(json.data.length).toBeGreaterThan(0);

		// Verify deprecated_at field is a valid ISO date string if present
		for (const model of json.data) {
			if (model.deprecated_at) {
				const deprecatedAt = new Date(model.deprecated_at);
				expect(deprecatedAt instanceof Date).toBe(true);
				expect(isNaN(deprecatedAt.getTime())).toBe(false);
			}
		}
	});

	test("GET /v1/models?no_training=true should only return providers without API training", async () => {
		const res = await app.request("/v1/models?no_training=true");
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.data.length).toBeGreaterThan(0);

		const noTrainingProviderIds = new Set(
			providers
				.filter((p) => p.dataPolicy?.apiTraining === false)
				.map((p) => p.id),
		);

		for (const model of json.data) {
			expect(model.providers.length).toBeGreaterThan(0);
			for (const provider of model.providers) {
				expect(noTrainingProviderIds.has(provider.providerId)).toBe(true);
			}
		}
	});

	test("GET /v1/models?no_training=true should return fewer providers than unfiltered", async () => {
		const filteredRes = await app.request("/v1/models?no_training=true");
		const unfilteredRes = await app.request("/v1/models");
		expect(filteredRes.status).toBe(200);
		expect(unfilteredRes.status).toBe(200);

		const filtered = await filteredRes.json();
		const unfiltered = await unfilteredRes.json();

		const countProviders = (json: any) =>
			json.data.reduce(
				(sum: number, model: any) => sum + model.providers.length,
				0,
			);

		expect(countProviders(filtered)).toBeLessThan(countProviders(unfiltered));
	});

	test("GET /v1/models should include proper output modalities for gemini-2.5-flash-image-preview", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		// Find the gemini-2.5-flash-image-preview model
		const imageModel = json.data.find(
			(model: any) => model.id === "gemini-2.5-flash-image-preview",
		);

		expect(imageModel).toBeDefined();
		expect(imageModel.architecture.output_modalities).toContain("text");
		expect(imageModel.architecture.output_modalities).toContain("image");
		expect(imageModel.architecture.output_modalities).toEqual([
			"text",
			"image",
		]);
	});

	test("GET /v1/models should derive model-level pricing from the cheapest active provider mapping", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const json = await res.json();
		const now = new Date();

		const isActive = (p: ProviderModelMapping) =>
			!(p.deactivatedAt && now > p.deactivatedAt) &&
			!(p.deprecatedAt && now > p.deprecatedAt);
		const hasPricing = (p: ProviderModelMapping) =>
			p.inputPrice !== undefined ||
			p.outputPrice !== undefined ||
			p.imageInputPrice !== undefined ||
			p.perSecondPrice !== undefined ||
			p.ocrPagePrice !== undefined;
		const score = (p: ProviderModelMapping) => {
			const input =
				p.inputPrice !== undefined ? Number(p.inputPrice) : undefined;
			const output =
				p.outputPrice !== undefined ? Number(p.outputPrice) : undefined;
			if (input !== undefined || output !== undefined) {
				return (input ?? 0) + (output ?? 0);
			}
			if (p.ocrPagePrice !== undefined) {
				return Number(p.ocrPagePrice);
			}
			if (p.perSecondPrice) {
				const values = Object.values(p.perSecondPrice).map(Number);
				return values.length > 0 ? Math.min(...values) : Infinity;
			}
			if (p.requestPrice !== undefined) {
				return Number(p.requestPrice);
			}
			if (p.imageInputPrice !== undefined) {
				return Number(p.imageInputPrice);
			}
			return Infinity;
		};
		const cheapest = (candidates: ProviderModelMapping[]) =>
			candidates.reduce<ProviderModelMapping | undefined>(
				(best, p) => (best === undefined || score(p) < score(best) ? p : best),
				undefined,
			);

		const definitionById = new Map(modelsList.map((m) => [m.id, m]));

		for (const model of json.data) {
			const definition = definitionById.get(model.id);
			expect(definition).toBeDefined();
			const mappings = definition!.providers as ProviderModelMapping[];

			const active = mappings.filter((p) => isActive(p) && hasPricing(p));
			const expected =
				active.length > 0
					? cheapest(active)
					: cheapest(mappings.filter((p) => hasPricing(p)));

			expect(model.pricing.prompt).toBe(
				expected?.inputPrice?.toString() ?? "0",
			);
			expect(model.pricing.input_cache_read).toBe(
				expected?.cachedInputPrice?.toString() ?? "0",
			);
		}

		// deepseek-v3.2: deepinfra is the cheapest active mapping
		// (0.26e-6 + 0.38e-6), so the root pricing must come from it and not the
		// deactivated DeepSeek mapping (whose cache read is 0.028e-6).
		const deepseek = json.data.find(
			(model: any) => model.id === "deepseek-v3.2",
		);
		expect(deepseek).toBeDefined();
		expect(deepseek.pricing.prompt).toBe("0.26e-6");
		expect(deepseek.pricing.completion).toBe("0.38e-6");
		expect(deepseek.pricing.input_cache_read).toBe("0.13e-6");
	});

	test("GET /v1/models reports JSON capabilities only from servable provider mappings", async () => {
		// Freeze the clock: the handler captures `new Date()` during the
		// request, so the test must evaluate servability at the same instant
		// (otherwise a mapping whose deactivatedAt lies between the request
		// and the assertion could flake).
		const frozenNow = new Date("2026-08-11T00:00:00Z");
		// Fake only Date: the handler now reads Airside listings from the DB,
		// and faking setTimeout would strand that network IO (and leak frozen
		// timers into every later test when this one times out).
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(frozenNow);
		try {
			const res = await app.request("/v1/models");
			expect(res.status).toBe(200);

			const json = await res.json();
			const isServable = (p: ProviderModelMapping) =>
				!(p.deactivatedAt && frozenNow > p.deactivatedAt);
			const definitionById = new Map(modelsList.map((m) => [m.id, m]));

			// json_output / structured_outputs must reflect mappings that can
			// actually serve requests: a deactivated mapping can no longer be
			// routed to, so it must not advertise a JSON capability (mirrors the
			// deactivation filter used for pricing and max_output). Deprecated
			// mappings remain servable (isServable only filters deactivatedAt);
			// no deprecated-only mapping with a JSON flag exists in the catalog
			// today, so that branch is covered by this loop's semantics.
			for (const model of json.data) {
				const definition = definitionById.get(model.id);
				expect(definition).toBeDefined();
				const servable = (
					definition!.providers as ProviderModelMapping[]
				).filter(isServable);
				expect(model.json_output, `json_output for ${model.id}`).toBe(
					servable.some((p) => p.jsonOutput === true),
				);
				expect(
					model.structured_outputs,
					`structured_outputs for ${model.id}`,
				).toBe(servable.some((p) => p.jsonOutputSchema === true));
			}

			// Focused branches: qwen3-235b-a22b-thinking-2507 has its only soft
			// mapping (nebius) deactivated, so json_output must be false even
			// though a jsonOutput mapping exists. minimax-m2.7 has a deactivated
			// soft mapping (together-ai) alongside servable soft mappings, so
			// json_output stays true and structured_outputs stays false.
			const byId = (id: string) =>
				json.data.find((m: { id: string }) => m.id === id);
			const qwen = byId("qwen3-235b-a22b-thinking-2507");
			expect(qwen).toBeDefined();
			expect(qwen!.json_output).toBe(false);
			const m27 = byId("minimax-m2.7");
			expect(m27).toBeDefined();
			expect(m27!.json_output).toBe(true);
			expect(m27!.structured_outputs).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	test("GET /v1/models exposes cache pricing detail per provider mapping", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();
		const definitionById = new Map(modelsList.map((m) => [m.id, m]));

		const deepseek = json.data.find(
			(model: any) => model.id === "deepseek-v3.2",
		);
		expect(deepseek).toBeDefined();

		const definition = definitionById.get("deepseek-v3.2")!;
		for (const provider of deepseek.providers) {
			const mapping = (definition.providers as ProviderModelMapping[]).find(
				(p) => p.providerId === provider.providerId,
			);
			expect(mapping).toBeDefined();
			if (mapping!.cachedInputPrice !== undefined) {
				expect(provider.pricing?.input_cache_read).toBe(
					mapping!.cachedInputPrice.toString(),
				);
			}
		}
	});

	test("GET /v1/models should expose per-page OCR pricing for mistral-ocr-latest", async () => {
		const res = await app.request("/v1/models");
		expect(res.status).toBe(200);

		const json = await res.json();
		const ocrModel = json.data.find(
			(model: any) => model.id === "mistral-ocr-latest",
		);

		expect(ocrModel).toBeDefined();
		// OCR surfaces as its own output modality so third-party clients can
		// reference the same taxonomy as the model catalog.
		expect(ocrModel.architecture.output_modalities).toEqual(["ocr"]);
		// $4 per 1,000 pages.
		expect(ocrModel.pricing.ocr_page).toBe("0.004");
		const mistralProvider = ocrModel.providers.find(
			(p: any) => p.providerId === "mistral",
		);
		expect(mistralProvider.pricing.ocr_page).toBe("0.004");
	});

	test("GET /v1/models should include proper output modalities for gemini-3.1-flash-image-preview", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		const imageModel = json.data.find(
			(model: any) => model.id === "gemini-3.1-flash-image-preview",
		);

		expect(imageModel).toBeDefined();
		expect(imageModel.architecture.output_modalities).toContain("text");
		expect(imageModel.architecture.output_modalities).toContain("image");
		expect(imageModel.architecture.output_modalities).toEqual([
			"text",
			"image",
		]);
	});

	test("GET /v1/models should include proper output modalities for gemini-3-pro-image-preview", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		const imageModel = json.data.find(
			(model: any) => model.id === "gemini-3-pro-image-preview",
		);

		expect(imageModel).toBeDefined();
		expect(imageModel.architecture.output_modalities).toContain("text");
		expect(imageModel.architecture.output_modalities).toContain("image");
		expect(imageModel.architecture.output_modalities).toEqual([
			"text",
			"image",
		]);
	});

	test("GET /v1/models should include proper output modalities for Veo 3.1 preview models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		for (const modelId of [
			"veo-3.1-generate-preview",
			"veo-3.1-fast-generate-preview",
		]) {
			const videoModel = json.data.find((model: any) => model.id === modelId);

			expect(videoModel).toBeDefined();
			expect(videoModel.architecture.input_modalities).toEqual(["text"]);
			expect(videoModel.architecture.output_modalities).toEqual(["video"]);
			expect(videoModel.pricing.per_second).toBeDefined();
			expect(videoModel.per_request_limits).toEqual({
				max_video_duration_seconds: "10",
			});
			const avalancheProvider = videoModel.providers.find(
				(provider: any) => provider.providerId === "avalanche",
			);
			const googleVertexProvider = videoModel.providers.find(
				(provider: any) => provider.providerId === "google-vertex",
			);
			expect(googleVertexProvider?.pricing.per_second).toBeDefined();
			expect(googleVertexProvider?.supportedVideoSizes).toEqual([
				"1280x720",
				"720x1280",
				"1920x1080",
				"1080x1920",
				"3840x2160",
				"2160x3840",
			]);
			expect(googleVertexProvider?.supportsVideoAudio).toBe(true);
			expect(googleVertexProvider?.supportsVideoWithoutAudio).toBe(true);
			expect(avalancheProvider?.pricing.per_second).toBeDefined();
			expect(avalancheProvider?.supportedVideoSizes).toEqual([
				"1920x1080",
				"1080x1920",
				"3840x2160",
				"2160x3840",
			]);
			expect(avalancheProvider?.supportsVideoAudio).toBe(true);
			expect(avalancheProvider?.supportsVideoWithoutAudio).toBe(false);
		}
	});

	test("GET /v1/models should only expose quartz for supported models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		for (const modelId of [
			"gemini-3.1-flash-image-preview",
			"gemini-3.1-pro-preview",
			"gemini-3-pro-image-preview",
		]) {
			const model = json.data.find((item: any) => item.id === modelId);
			expect(model).toBeDefined();
			expect(
				model.providers.some(
					(provider: any) => provider.providerId === "quartz",
				),
			).toBe(true);
		}

		for (const modelId of [
			"gemini-2.5-flash-image-preview",
			"veo-3.1-generate-preview",
			"veo-3.1-fast-generate-preview",
		]) {
			const model = json.data.find((item: any) => item.id === modelId);
			expect(model).toBeDefined();
			expect(
				model.providers.some(
					(provider: any) => provider.providerId === "quartz",
				),
			).toBe(false);
		}
	});

	test("GET /v1/models should only expose glacier for supported models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		const glacierModelIds = json.data
			.filter((model: any) =>
				model.providers.some(
					(provider: any) => provider.providerId === "glacier",
				),
			)
			.map((model: any) => model.id)
			.sort();

		expect(glacierModelIds).toEqual([
			"gemini-2.5-flash-image",
			"gemini-3-pro-image-preview",
			"gemini-3.1-flash-image-preview",
		]);
	});

	test("GET /v1/models should include stability information for models", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		// Check that the stability field exists in the model schema (models may or may not have it set)
		const modelsWithStability = json.data.filter(
			(model: any) => model.stability !== undefined,
		);
		// At least one model should have stability information (our DeepSeek models)
		expect(modelsWithStability.length).toBeGreaterThan(0);

		// Find DeepSeek models to test specific stability flags
		const deepSeekR1Distill = json.data.find(
			(model: any) => model.id === "deepseek-r1-distill-llama-70b",
		);
		const deepSeekV31 = json.data.find(
			(model: any) => model.id === "deepseek-v3.1",
		);

		if (deepSeekR1Distill) {
			expect(deepSeekR1Distill.stability).toBe("beta");
		}

		// DeepSeek v3.1 should default to stable (undefined in response means stable)
		if (deepSeekV31) {
			expect(
				deepSeekV31.stability === undefined ||
					deepSeekV31.stability === "stable",
			).toBe(true);
		}
	});

	test("GET /v1/models should handle stability field values correctly", async () => {
		const res = await app.request("/v1/models?include_deactivated=true");
		expect(res.status).toBe(200);

		const json = await res.json();

		// Validate that stability field contains only valid values
		const validStabilityValues = [
			"stable",
			"beta",
			"unstable",
			"experimental",
			undefined,
		];

		for (const model of json.data) {
			if (model.stability !== undefined) {
				expect(validStabilityValues).toContain(model.stability);
			}
		}
	});
});
