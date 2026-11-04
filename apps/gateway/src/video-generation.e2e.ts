import { setTimeout } from "node:timers/promises";

import { Decimal } from "decimal.js";
import "dotenv/config";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";
import { processPendingVideoJobs } from "worker";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	matchesTestModel,
	specifiedModels,
} from "@/chat-helpers.e2e.js";
import { waitForPendingWork } from "@/lib/pending-work.js";

import { db, tables } from "@llmgateway/db";
import { models } from "@llmgateway/models";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import {
	getVideoOrientation,
	getVideoResolution,
	isVideoSize,
} from "@llmgateway/shared/video-generation-config";
import { getVideoOutputTokenPrice } from "@llmgateway/shared/video-token-pricing";

import type { ProviderModelMapping } from "@llmgateway/models";

const VIDEO_PROJECT_ID = "video-e2e-project";
const VIDEO_API_KEY_ID = "video-e2e-api-key";
const VIDEO_API_KEY_TOKEN = "video-e2e-token";

// Paid video tests require explicit mappings; unscoped e2e never submits jobs.
const videoCases = specifiedModels
	? models.flatMap((model) =>
			(model.providers as ProviderModelMapping[]).flatMap((mapping) => {
				if (
					mapping.providerId !== "bytedance" ||
					!mapping.videoGenerations ||
					!matchesTestModel(mapping.providerId, model.id, mapping.region) ||
					(mapping.deactivatedAt && mapping.deactivatedAt <= new Date())
				) {
					return [];
				}
				const sizes = (mapping.supportedVideoSizes ?? []).filter(isVideoSize);
				const seenResolutions = new Set<string>();
				const representativeSizes = sizes.filter((size) => {
					const resolution = getVideoResolution(size);
					if (
						getVideoOrientation(size) !== "landscape" ||
						seenResolutions.has(resolution)
					) {
						return false;
					}
					seenResolutions.add(resolution);
					return true;
				});
				const seconds = Math.min(
					...(mapping.supportedVideoDurationsSeconds ?? []),
				);
				if (!representativeSizes.length || !Number.isFinite(seconds)) {
					throw new Error(`Video e2e settings missing for ${model.id}`);
				}
				return representativeSizes.flatMap((size) =>
					[true, false]
						.filter((audio) =>
							audio
								? mapping.supportsVideoAudio
								: mapping.supportsVideoWithoutAudio,
						)
						.map((audio) => ({
							model: `${mapping.providerId}/${model.id}`,
							mapping,
							size,
							resolution: getVideoResolution(size),
							seconds,
							audio,
						})),
				);
			}),
		)
	: [];

function record(value: unknown): Record<string, unknown> {
	expect(value).not.toBeNull();
	expect(typeof value).toBe("object");
	expect(Array.isArray(value)).toBe(false);
	return value as Record<string, unknown>;
}

async function waitForCompletedVideo(id: string) {
	const pollTimeoutMs = 10 * 60_000;
	const deadline = Date.now() + pollTimeoutMs;
	while (Date.now() < deadline) {
		await processPendingVideoJobs();
		const job = await db.query.videoJob.findFirst({
			where: { id: { eq: id } },
		});
		if (!job) {
			throw new Error("Submitted video job disappeared");
		}
		if (
			job.status === "failed" ||
			job.status === "canceled" ||
			job.status === "expired"
		) {
			throw new Error(`Video generation ended with ${job.status}`);
		}
		if (job.status === "completed" && job.resultLoggedAt) {
			return job;
		}
		await setTimeout(5_000);
	}
	throw new Error(
		"Video generation or token billing did not complete within 10 minutes",
	);
}

async function prepareVideoTests() {
	await beforeAllHook();
	await db
		.insert(tables.project)
		.values({
			id: VIDEO_PROJECT_ID,
			name: "Video E2E Project",
			organizationId: "org-id",
			mode: "credits",
		})
		.onConflictDoUpdate({
			target: tables.project.id,
			set: { mode: "credits" },
		});
	await db
		.insert(tables.apiKey)
		.values({
			id: VIDEO_API_KEY_ID,
			...hashApiKeyForStorage(VIDEO_API_KEY_TOKEN),
			projectId: VIDEO_PROJECT_ID,
			description: "Video E2E API Key",
			createdBy: "user-id",
		})
		.onConflictDoNothing();
}

function videoGenerationTests() {
	if (!videoCases.length) {
		test.skip("requires explicit ByteDance video TEST_MODELS", () => {});
		return;
	}
	let attempts = 0;
	let accepted = 0;
	let completed = 0;
	beforeAll(prepareVideoTests);
	beforeEach(beforeEachHook);
	afterAll(async () => {
		await waitForPendingWork(60_000);
		console.log("Video e2e submissions", { attempts, accepted, completed });
	});

	test.each(videoCases)(
		"video $model $resolution audio=$audio bills actual completion tokens",
		{ timeout: 11 * 60_000, retry: 0 },
		async ({ model, mapping, size, resolution, seconds, audio }) => {
			const startedAt = new Date();
			const requestId = generateTestRequestId();
			attempts++;
			// Never retry a paid submission, including a lost create response.
			const response = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${VIDEO_API_KEY_TOKEN}`,
					"x-request-id": requestId,
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model,
					prompt:
						"A colorful paper boat floating slowly on a quiet pond, gentle ripples and birdsong.",
					size,
					seconds,
					audio,
				}),
			});
			expect(response.status).toBe(200);
			const created = record(await response.json());
			expect(typeof created.id).toBe("string");
			accepted++;
			const job = await waitForCompletedVideo(created.id as string);
			completed++;
			expect(job.usedProvider).toBe("bytedance");
			expect(
				record(job.upstreamCreateResponse).llmgateway_video_token_pricing,
			).toEqual({
				resolution,
				includeAudio: audio,
				hasVideoInput: false,
			});
			const raw = record(
				record(job.upstreamStatusResponse).bytedance_raw_response,
			);
			const status = raw.data === undefined ? raw : record(raw.data);
			expect(status.resolution).toBe(resolution);
			const usage = record(status.usage);
			const tokens = usage.completion_tokens;
			expect(typeof tokens).toBe("number");
			expect(Number.isSafeInteger(tokens)).toBe(true);
			expect(tokens).toBeGreaterThan(0);
			const price = getVideoOutputTokenPrice(mapping.videoOutputPrice, {
				resolution,
				includeAudio: audio,
				hasVideoInput: false,
			});
			expect(price).toBeDefined();
			const expectedCost = new Decimal(tokens as number)
				.mul(price!)
				.toDecimalPlaces(6)
				.toNumber();
			expect(job.videoOutputCost).toBeCloseTo(expectedCost, 6);
			expect(job.cost).toBeCloseTo(expectedCost, 6);
			// Inspect this fixture's individual bill, not an aggregate usage total.
			const log = await db.query.log.findFirst({
				where: {
					projectId: { eq: VIDEO_PROJECT_ID },
					requestId: { eq: requestId },
					createdAt: { gte: startedAt, lte: new Date() },
				},
				columns: {
					completionTokens: true,
					videoOutputCost: true,
					cost: true,
					estimatedCost: true,
				},
			});
			expect(Number(log?.completionTokens)).toBe(tokens);
			expect(log?.videoOutputCost).toBeCloseTo(expectedCost, 6);
			expect(log?.cost).toBeCloseTo(expectedCost, 6);
			expect(log?.estimatedCost).toBe(false);
		},
	);
}

describe("e2e video generation", { concurrent: false }, videoGenerationTests);
