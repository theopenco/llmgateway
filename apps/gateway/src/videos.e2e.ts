import { setTimeout } from "node:timers/promises";

import { Decimal } from "decimal.js";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { processPendingVideoJobs } from "worker";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	matchesTestModel,
	specifiedModels,
} from "@/chat-helpers.e2e.js";
import { readFixtureImageDataUrl } from "@/test-utils/image-fixture.js";

import { db, tables } from "@llmgateway/db";
import { models } from "@llmgateway/models";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import {
	getVideoResolution,
	supportsVideoFrameInput,
} from "@llmgateway/shared/video-generation-config";

import type { ProviderModelMapping } from "@llmgateway/models";
import type { VideoSize } from "@llmgateway/shared/video-generation-config";

const PROJECT_ID = "video-e2e-project";
const API_KEY_ID = "video-e2e-api-key";
const API_KEY_TOKEN = "real-token-video";
const MODEL = "fal-ai/flux-3-max";
const selected =
	specifiedModels !== null && matchesTestModel("fal-ai", "flux-3-max");
const headers = {
	"Content-Type": "application/json",
	Authorization: `Bearer ${API_KEY_TOKEN}`,
	"x-no-fallback": "true",
};

interface VideoResult {
	id: string;
	model: string;
	status: string;
	error?: { message: string } | null;
}

async function generateVideo(input: {
	size: string;
	reasoning_effort: "low" | "high";
	audio: boolean;
	image?: string;
	last_frame?: string;
}): Promise<void> {
	const response = await app.request("/v1/videos", {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: MODEL,
			prompt: input.image
				? "The colorful light shifts gently across this abstract scene. A slow steady shot."
				: "A blue paper boat floats across a calm pond in a single steady shot. Gentle water sounds. No people or text.",
			seconds: 5,
			...input,
		}),
	});
	const created = (await response.json()) as VideoResult;
	expect(response.status, JSON.stringify(created)).toBe(200);
	expect(created.model).toBe(MODEL);
	expect(created.id).toBeTruthy();

	const deadline = Date.now() + 300_000;
	let completed = false;
	while (Date.now() < deadline) {
		await processPendingVideoJobs();
		const statusResponse = await app.request(`/v1/videos/${created.id}`, {
			headers,
		});
		const status = (await statusResponse.json()) as VideoResult;
		expect(statusResponse.status).toBe(200);
		expect(status.status, JSON.stringify(status.error)).not.toBe("failed");
		if (status.status === "completed") {
			completed = true;
			break;
		}
		await setTimeout(1500);
	}
	expect(completed, "Video did not complete within five minutes").toBe(true);

	const job = await db.query.videoJob.findFirst({
		where: { id: { eq: created.id }, projectId: { eq: PROJECT_ID } },
	});
	expect(job?.usedProvider).toBe("fal-ai");
	expect(job?.logId).toBeTruthy();
	const log = await db.query.log.findFirst({
		where: { id: { eq: job!.logId! }, projectId: { eq: PROJECT_ID } },
		columns: { cost: true, usedProvider: true, usedModel: true },
	});
	const rate = input.size.includes("1080") ? "0.29" : "0.17";
	expect(log?.cost).toBeCloseTo(new Decimal(rate).times(5).toNumber(), 6);
	expect(log?.usedProvider).toBe("fal-ai");
	expect(log?.usedModel).toBe(MODEL);

	const content = await app.request(`/v1/videos/${created.id}/content`, {
		headers: { ...headers, Range: "bytes=0-4095" },
	});
	expect([200, 206]).toContain(content.status);
	expect(content.headers.get("content-type")).toContain("video/mp4");
	const bytes = Buffer.from(await content.arrayBuffer());
	expect(bytes.byteLength).toBeGreaterThan(64);
	expect(bytes.subarray(4, 8).toString()).toBe("ftyp");
}

describe.runIf(selected)("fal FLUX 3 Max live video", () => {
	beforeAll(async () => {
		expect(process.env.LLM_FAL_AI_API_KEY).toBeTruthy();
		await beforeAllHook();
		await db
			.insert(tables.project)
			.values({
				id: PROJECT_ID,
				name: "Video E2E Project",
				organizationId: "org-id",
				mode: "credits",
			})
			.onConflictDoNothing();
		await db
			.insert(tables.apiKey)
			.values({
				id: API_KEY_ID,
				...hashApiKeyForStorage(API_KEY_TOKEN),
				projectId: PROJECT_ID,
				description: "Video E2E API Key",
				createdBy: "user-id",
			})
			.onConflictDoNothing();
	});
	beforeEach(beforeEachHook);

	for (const size of ["1280x720", "1920x1080"]) {
		for (const reasoning_effort of ["low", "high"] as const) {
			test(
				`text video ${size} / ${reasoning_effort}`,
				{ timeout: 360_000 },
				async () => {
					await generateVideo({ size, reasoning_effort, audio: true });
				},
			);
		}
	}

	test("starting image without audio", { timeout: 360_000 }, async () => {
		await generateVideo({
			size: "1280x720",
			reasoning_effort: "low",
			audio: false,
			image: readFixtureImageDataUrl(),
		});
	});

	test(
		"portrait starting and ending images",
		{ timeout: 360_000 },
		async () => {
			const image = readFixtureImageDataUrl();
			await generateVideo({
				size: "720x1280",
				reasoning_effort: "high",
				audio: true,
				image,
				last_frame: image,
			});
		},
	);
});

const ALIBABA_PROJECT_ID = "alibaba-video-e2e-project";
const ALIBABA_API_KEY_ID = "alibaba-video-e2e-api-key";
const ALIBABA_API_KEY_TOKEN = "real-token-alibaba-video";
const alibabaHeaders = {
	"Content-Type": "application/json",
	Authorization: `Bearer ${ALIBABA_API_KEY_TOKEN}`,
	"x-no-fallback": "true",
};

// Paid Wan cases run only when TEST_MODELS names the Alibaba video mapping.
const alibabaVideoCases =
	specifiedModels === null
		? []
		: models.flatMap((model) =>
				(model.providers as ProviderModelMapping[]).flatMap((mapping) => {
					const modelId = `alibaba/${model.id}`;
					if (
						mapping.providerId !== "alibaba" ||
						!mapping.videoGenerations ||
						!supportsVideoFrameInput(modelId) ||
						!matchesTestModel("alibaba", model.id, mapping.region)
					) {
						return [];
					}
					return [
						{ model: modelId, mapping, size: "854x480", audio: true },
						{ model: modelId, mapping, size: "480x854", audio: false },
						{ model: modelId, mapping, size: "1280x720", audio: true },
						{ model: modelId, mapping, size: "1920x1080", audio: true },
						{
							model: modelId,
							mapping,
							size: "854x480",
							audio: true,
							image: true,
						},
						{
							model: modelId,
							mapping,
							size: "854x480",
							audio: true,
							image: true,
							last_frame: true,
						},
						{
							model: modelId,
							mapping,
							size: "854x480",
							audio: true,
							reference: true,
						},
					];
				}),
			);

describe.runIf(alibabaVideoCases.length > 0)("Alibaba Wan live video", () => {
	beforeAll(async () => {
		expect(process.env.LLM_ALIBABA_API_KEY).toBeTruthy();
		await beforeAllHook();
		await db
			.insert(tables.project)
			.values({
				id: ALIBABA_PROJECT_ID,
				name: "Alibaba Video E2E Project",
				organizationId: "org-id",
				mode: "credits",
			})
			.onConflictDoNothing();
		await db
			.insert(tables.apiKey)
			.values({
				id: ALIBABA_API_KEY_ID,
				...hashApiKeyForStorage(ALIBABA_API_KEY_TOKEN),
				projectId: ALIBABA_PROJECT_ID,
				description: "Alibaba Video E2E API Key",
				createdBy: "user-id",
			})
			.onConflictDoNothing();
	});
	beforeEach(beforeEachHook);

	test.each(alibabaVideoCases)(
		"$model $size audio=$audio image=$image last_frame=$last_frame reference=$reference",
		{ timeout: 660_000, retry: 0 },
		async ({ model, mapping, size, audio, image, last_frame, reference }) => {
			const fixture = readFixtureImageDataUrl();
			const seconds = 2;
			const response = await app.request("/v1/videos", {
				method: "POST",
				headers: alibabaHeaders,
				body: JSON.stringify({
					model,
					prompt: reference
						? "The object from image 1 slowly rotates on a plain table. A slow steady shot."
						: image
							? "The colorful light shifts gently across this abstract scene. A slow steady shot."
							: "A blue paper boat floats across a calm pond in a single steady shot. No people or text.",
					size,
					seconds,
					audio,
					...(image && { image: fixture }),
					...(last_frame && { last_frame: fixture }),
					...(reference && { reference_images: [fixture] }),
				}),
			});
			const created = (await response.json()) as VideoResult;
			expect(response.status, JSON.stringify(created)).toBe(200);
			expect(created.model).toBe(model);

			const deadline = Date.now() + 600_000;
			let completed = false;
			while (Date.now() < deadline) {
				await processPendingVideoJobs();
				const statusResponse = await app.request(`/v1/videos/${created.id}`, {
					headers: alibabaHeaders,
				});
				const status = (await statusResponse.json()) as VideoResult;
				expect(statusResponse.status).toBe(200);
				expect(status.status, JSON.stringify(status.error)).not.toBe("failed");
				if (status.status === "completed") {
					completed = true;
					break;
				}
				await setTimeout(5_000);
			}
			expect(completed, "Video did not complete within ten minutes").toBe(true);

			const job = await db.query.videoJob.findFirst({
				where: {
					id: { eq: created.id },
					projectId: { eq: ALIBABA_PROJECT_ID },
				},
			});
			expect(job?.usedProvider).toBe("alibaba");
			expect(job?.logId).toBeTruthy();
			const log = await db.query.log.findFirst({
				where: {
					id: { eq: job!.logId! },
					projectId: { eq: ALIBABA_PROJECT_ID },
				},
				columns: { cost: true },
			});
			const rate =
				mapping.perSecondPrice?.[getVideoResolution(size as VideoSize)];
			expect(rate).toBeDefined();
			expect(log?.cost).toBeCloseTo(
				new Decimal(rate!).times(seconds).toNumber(),
				6,
			);

			const content = await app.request(`/v1/videos/${created.id}/content`, {
				headers: { ...alibabaHeaders, Range: "bytes=0-4095" },
			});
			expect([200, 206]).toContain(content.status);
			const bytes = Buffer.from(await content.arrayBuffer());
			expect(bytes.subarray(4, 8).toString()).toBe("ftyp");
		},
	);
});
