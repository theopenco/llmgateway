import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

import { app } from "./app.js";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

const IMAGE_PROJECT_ID = "image-test-project-id";
const IMAGE_API_KEY_ID = "image-test-api-key-id";
const IMAGE_API_KEY_TOKEN = "real-token-image";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IMAGE_PATH = path.join(
	__dirname,
	"test-fixtures",
	"test-image.png",
);

function readFixtureImageDataUrl(): string {
	const bytes = fs.readFileSync(FIXTURE_IMAGE_PATH);
	return `data:image/png;base64,${bytes.toString("base64")}`;
}

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
				model: `${provider.providerId}/${provider.region ? provider.modelName : model.id}`,
				provider,
				originalModel: model.id,
				usesImageGenerationsFlag: providerHasImageGen,
			});
		}

		return cases;
	});

const testImageMode = process.env.TEST_IMAGE_MODE === "true";

const ALLOWED_QUALITIES = ["low", "medium", "high", "auto"] as const;
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
	| "1024x1024"
	| "1024x1536"
	| "1536x1024";

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
			token: IMAGE_API_KEY_TOKEN,
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

		test.each(imageTestCases)(
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
