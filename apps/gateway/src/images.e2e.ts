import { randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";
import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	filteredModels,
	getConcurrentTestOptions,
	getTestOptions,
	hasOnlyModels,
	logMode,
	matchesTestModel,
	specifiedModels,
} from "@/chat-helpers.e2e.js";

import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { readFixtureImageDataUrl } from "./test-utils/image-fixture.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

const IMAGE_PROJECT_ID = "image-test-project-id";
const IMAGE_API_KEY_ID = "image-test-api-key-id";
const IMAGE_API_KEY_TOKEN = "real-token-image";

const imageTestCases = filteredModels
	.filter((model) => {
		if (hasOnlyModels) {
			return model.providers.some(
				(provider: ProviderModelMapping) => provider.test === "only",
			);
		}
		return true;
	})
	.flatMap((model) => {
		const output = (model as ModelDefinition).output;
		const modelHasImageOutput = output?.includes("image") ?? false;

		const cases: {
			model: string;
			provider: ProviderModelMapping;
			originalModel: string;
			usesImageGenerationsFlag: boolean;
		}[] = [];

		for (const provider of model.providers as ProviderModelMapping[]) {
			const providerHasImageGen = provider.imageGenerations === true;
			if (!modelHasImageOutput && !providerHasImageGen) {
				continue;
			}

			if (provider.deactivatedAt && new Date() > provider.deactivatedAt) {
				continue;
			}
			if (provider.deprecatedAt && new Date() > provider.deprecatedAt) {
				continue;
			}

			if (specifiedModels) {
				if (!matchesTestModel(provider.providerId, model.id, provider.region)) {
					continue;
				}
			} else {
				if (provider.test === "skip") {
					continue;
				}
			}

			if (hasOnlyModels && provider.test !== "only") {
				continue;
			}

			cases.push({
				model: `${provider.providerId}/${model.id}${provider.region ? `:${provider.region}` : ""}`,
				provider,
				originalModel: model.id,
				usesImageGenerationsFlag: providerHasImageGen,
			});
		}

		return cases;
	});

// Image cases bill per image, so they run on request or when TEST_MODELS names
// image mappings explicitly (as the e2e workflow's test_models input does).
const testImageMode =
	process.env.TEST_IMAGE_MODE === "true" ||
	(specifiedModels !== null && imageTestCases.length > 0);

const ALLOWED_QUALITIES = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"auto",
] as const;
type ImageQuality = (typeof ALLOWED_QUALITIES)[number];
const rawQualityOverride = process.env.TEST_IMAGE_QUALITY?.trim().toLowerCase();
const qualityOverride: ImageQuality | undefined = (
	ALLOWED_QUALITIES as readonly string[]
).includes(rawQualityOverride ?? "")
	? (rawQualityOverride as ImageQuality)
	: undefined;
if (rawQualityOverride && !qualityOverride) {
	throw new Error(
		`TEST_IMAGE_QUALITY must be one of ${ALLOWED_QUALITIES.join(", ")}, got "${rawQualityOverride}"`,
	);
}

// Always send an explicit size so the test exercises a known shape rather
// than relying on each provider's "auto" default. Override with TEST_IMAGE_SIZE.
const IMAGE_SIZE = (process.env.TEST_IMAGE_SIZE?.trim() || "1024x1024") as
	"1024x1024" | "1024x1536" | "1536x1024";

if (testImageMode) {
	console.log(
		`Testing ${imageTestCases.length} image model(s): ${imageTestCases
			.map((c) => c.model)
			.join(
				", ",
			)} (size=${IMAGE_SIZE}${qualityOverride ? `, quality=${qualityOverride}` : ""})`,
	);
}

function extractImagesFromChatResponse(json: any): string[] {
	const message = json?.choices?.[0]?.message;
	const images = message?.images;
	if (!Array.isArray(images)) {
		return [];
	}
	return images
		.map((img: any) => img?.image_url?.url ?? img?.url)
		.filter((url: unknown): url is string => typeof url === "string");
}

function expectValidImageUrl(url: string) {
	expect(url).toBeTruthy();
	expect(url).toMatch(/^(data:image\/[\w+.-]+;base64,|https?:\/\/)/);
	if (url.startsWith("data:image/")) {
		const b64 = url.split(",", 2)[1] ?? "";
		expect(b64.length).toBeGreaterThan(100);
	}
}

async function imageBeforeAllHook() {
	await beforeAllHook();
	// Use credits mode so the gateway resolves provider keys from env vars,
	// which correctly handles multi-key/multi-region configs (e.g. google-vertex).
	await db
		.insert(tables.project)
		.values({
			id: IMAGE_PROJECT_ID,
			name: "Image E2E Project",
			organizationId: "org-id",
			mode: "credits",
		})
		.onConflictDoUpdate({
			target: tables.project.id,
			set: { mode: "credits", organizationId: "org-id" },
		});
	await db
		.insert(tables.apiKey)
		.values({
			id: IMAGE_API_KEY_ID,
			...hashApiKeyForStorage(IMAGE_API_KEY_TOKEN),
			projectId: IMAGE_PROJECT_ID,
			description: "Image E2E API Key",
			createdBy: "user-id",
		})
		.onConflictDoNothing();
}

describe("e2e image generation", getConcurrentTestOptions(), () => {
	beforeAll(imageBeforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	if (testImageMode) {
		test.each(imageTestCases)(
			"/v1/chat/completions returns image for $model",
			{ ...getTestOptions(), timeout: 300_000 },
			async ({ model }) => {
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${IMAGE_API_KEY_TOKEN}`,
						"x-no-fallback": "true",
					},
					body: JSON.stringify({
						model,
						messages: [
							{
								role: "user",
								content:
									"Generate an image of a smiling orange cat wearing a tiny hat.",
							},
						],
						image_config: {
							image_size: IMAGE_SIZE,
							...(qualityOverride && { image_quality: qualityOverride }),
						},
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log(
						"chat.completions response",
						model,
						JSON.stringify(json).slice(0, 500),
					);
				}
				expect(res.status).toBe(200);

				const images = extractImagesFromChatResponse(json);
				expect(images.length).toBeGreaterThan(0);
				expectValidImageUrl(images[0]);
			},
		);

		test.each(imageTestCases)(
			"/v1/images/generations returns image for $model",
			{ ...getTestOptions(), timeout: 300_000 },
			async ({ model }) => {
				const res = await app.request("/v1/images/generations", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${IMAGE_API_KEY_TOKEN}`,
						"x-no-fallback": "true",
					},
					body: JSON.stringify({
						model,
						prompt: "A smiling orange cat wearing a tiny hat, photorealistic.",
						size: IMAGE_SIZE,
						n: 1,
						...(qualityOverride && { quality: qualityOverride }),
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log(
						"images.generations response",
						model,
						JSON.stringify(json).slice(0, 500),
					);
				}
				expect(res.status).toBe(200);

				expect(Array.isArray(json.data)).toBe(true);
				expect(json.data.length).toBeGreaterThan(0);
				const first = json.data[0];
				const url = first.b64_json
					? `data:image/png;base64,${first.b64_json}`
					: first.url;
				expectValidImageUrl(url);
			},
		);

		test.each(imageTestCases.filter(({ provider }) => provider.svgOutput))(
			"/v1/images/generations returns SVG for $model",
			{ ...getTestOptions(), timeout: 300_000 },
			async ({ model }) => {
				const requestId = randomUUID();
				const res = await app.request("/v1/images/generations", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${IMAGE_API_KEY_TOKEN}`,
						"x-no-fallback": "true",
						"x-request-id": requestId,
					},
					body: JSON.stringify({
						model,
						prompt: "A flat icon of an orange cat face, two colors.",
						output_format: "svg",
						svg: { model: "gpt-5.4-mini", reasoning: { effort: "low" } },
						quality: qualityOverride ?? "low",
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log(
						"images.generations SVG response",
						model,
						JSON.stringify({ ...json, data: undefined }),
					);
				}
				expect(res.status, JSON.stringify(json)).toBe(200);
				expect(json.output_format).toBe("svg");
				expect(json.data).toHaveLength(1);
				const svg = Buffer.from(json.data[0].b64_json, "base64").toString(
					"utf8",
				);
				expect(svg).toContain("<svg");
				expect(svg.trimEnd()).toMatch(/<\/svg>$/);
				expect(json.usage.cost).toBeGreaterThan(0);
				const log = await waitForLogByRequestId(requestId);
				const upstream = log.upstreamResponse as {
					usage: { input_tokens: number; output_tokens: number };
					svg_usage: {
						model: string;
						input_tokens: number;
						output_tokens: number;
						reasoning_tokens: number;
						total_tokens: number;
					};
				};
				const author = upstream.svg_usage;
				expect(author.model).toMatch(/^gpt-5\.4-mini(?:-\d{4}-\d{2}-\d{2})?$/);
				expect(author.total_tokens).toBe(
					author.input_tokens + author.output_tokens,
				);
				expect(author.reasoning_tokens).toBeLessThanOrEqual(
					author.output_tokens,
				);
				const inputCost = new Decimal(upstream.usage.input_tokens)
					.times("5e-6")
					.plus(new Decimal(author.input_tokens).times("0.75e-6"));
				const outputCost = new Decimal(upstream.usage.output_tokens)
					.times("30e-6")
					.plus(new Decimal(author.output_tokens).times("4.5e-6"));
				expect(Number(log.inputCost)).toBeCloseTo(inputCost.toNumber(), 6);
				expect(Number(log.outputCost)).toBeCloseTo(outputCost.toNumber(), 6);
				expect(Number(log.cost)).toBeCloseTo(
					inputCost.plus(outputCost).toNumber(),
					6,
				);
				expect(json.usage.cost).toBeCloseTo(Number(log.cost), 6);
			},
		);

		// Text-to-image mappings reject input images by design.
		test.each(imageTestCases.filter(({ provider }) => provider.vision))(
			"/v1/images/edits returns image for $model",
			{ ...getTestOptions(), timeout: 300_000 },
			async ({ model, provider }) => {
				const dataUrl = readFixtureImageDataUrl();
				// Azure's gpt-image-2 high-quality edits exceed the 122s synchronous
				// timeout. Default to quality=low for Azure gpt-image so the e2e
				// exercises the real pipeline. TEST_IMAGE_QUALITY overrides this.
				const azureLowQualityDefault =
					provider.providerId === "azure" && provider.imageGenerations === true
						? "low"
						: undefined;
				const effectiveQuality = qualityOverride ?? azureLowQualityDefault;
				const res = await app.request("/v1/images/edits", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${IMAGE_API_KEY_TOKEN}`,
						"x-no-fallback": "true",
					},
					body: JSON.stringify({
						model,
						prompt:
							"Edit this image: add a small bright sun in the upper-right corner.",
						images: [{ image_url: dataUrl }],
						size: IMAGE_SIZE,
						n: 1,
						...(effectiveQuality && { quality: effectiveQuality }),
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log(
						"images.edits response",
						model,
						JSON.stringify(json).slice(0, 500),
					);
				}
				expect(res.status).toBe(200);

				expect(Array.isArray(json.data)).toBe(true);
				expect(json.data.length).toBeGreaterThan(0);
				const first = json.data[0];
				const url = first.b64_json
					? `data:image/png;base64,${first.b64_json}`
					: first.url;
				expectValidImageUrl(url);
			},
		);
	}
});
