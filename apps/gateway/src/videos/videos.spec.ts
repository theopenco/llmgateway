import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { processPendingVideoJobs } from "worker";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import {
	getMockVideo,
	setMockVideoStatus,
	setMockVideoStatusResponse,
} from "@/test-utils/mock-openai-server.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { buildGatewayVideoLogContentUrl } from "@llmgateway/shared";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("videos", () => {
	const harness = createGatewayApiTestHarness();
	let mockServerUrl: string;
	let originalGoogleVertexBaseUrl: string | undefined;

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
		originalGoogleVertexBaseUrl = process.env.LLM_GOOGLE_VERTEX_BASE_URL;
		process.env.LLM_GOOGLE_VERTEX_BASE_URL = mockServerUrl;
	});

	afterAll(() => {
		if (originalGoogleVertexBaseUrl !== undefined) {
			process.env.LLM_GOOGLE_VERTEX_BASE_URL = originalGoogleVertexBaseUrl;
		} else {
			delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;
		}
	});

	function expectSignedVideoLogContentUrl(url: string, logId: string) {
		return harness.expectSignedVideoLogContentUrl(url, logId);
	}

	test("/v1/videos rejects dev-plan personal orgs with 403", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await harness.setDevPlan({ devPlan: "pro" });

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "veo-3.1-generate-preview",
				prompt: "A neon city at night",
				size: "1920x1080",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(403);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"Video generation is not available for coding plans",
		);

		// Existing video status/content endpoints must still be reachable.
		// We don't have a job, but the endpoint should reach the project lookup
		// (which is independent of devPlan) and return 404 rather than 403.
		const statusRes = await app.request("/v1/videos/nonexistent", {
			method: "GET",
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(statusRes.status).toBe(404);
	});

	test("/v1/videos rejects jobs while ZDR is active", async () => {
		await db
			.update(tables.organization)
			.set({
				plan: "enterprise",
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			})
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id-zdr-video-block",
			...hashApiKeyForStorage("real-token-zdr-video-block"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const response = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-zdr-video-block",
			},
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0",
				prompt: "Do not retain this video",
				size: "1280x720",
				seconds: 5,
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.text()).toContain(
			"video jobs require temporary output storage",
		);
		expect(await db.query.videoJob.findMany()).toHaveLength(0);
	});

	test("/v1/videos rejects non-https reference videos", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "seedance-2-0",
				prompt: "Reproduce the camera move from the reference clip",
				size: "1280x720",
				seconds: 5,
				reference_videos: ["http://example.com/reference-motion.mp4"],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("reference_videos");
	});

	test("/v1/videos rejects combining frames with reference videos", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "seedance-2-0",
				prompt: "Blend these inputs",
				size: "1280x720",
				seconds: 5,
				image: { image_url: "data:image/png;base64,aGVsbG8=" },
				reference_videos: ["https://example.com/reference-motion.mp4"],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("Frame inputs");
	});

	test("/v1/videos logs oversized reference image client errors", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id-video-oversized-image",
			...hashApiKeyForStorage("real-token-video-oversized-image"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-video-oversized-image",
			...encryptProviderKeyForStorage(
				"sk-bytedance-key",
				"provider-key-video-oversized-image",
				"org-id",
			),
			provider: "bytedance",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const requestId = "video-oversized-reference-image-request";
		const oversizedImageDataUrl = `data:image/png;base64,${"A".repeat(28 * 1024 * 1024)}`;

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-video-oversized-image",
				"x-request-id": requestId,
			},
			body: JSON.stringify({
				model: "seedance-2-0",
				prompt: "Animate this product reference image",
				size: "1280x720",
				seconds: 5,
				reference_images: [
					{
						image_url: oversizedImageDataUrl,
					},
				],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.message).toContain("Invalid image input");
		expect(json.error.message).toContain("Image size");
		expect(json.error.message).toContain(
			"exceeds the 20MB limit for image inputs",
		);

		const logs = await db.query.log.findMany({
			where: { requestId: { eq: requestId } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].finishReason).toBe("client_error");
		expect(logs[0].unifiedFinishReason).toBe("client_error");
		expect(logs[0].hasError).toBe(true);
		expect(logs[0].errorDetails?.statusCode).toBe(400);
		expect(logs[0].errorDetails?.responseText).toContain("Image size");
		expect(logs[0].usedProvider).toBe("bytedance");
	});

	test("/v1/videos rejects non-https reference audios", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "seedance-2-0",
				prompt: "Align the motion to the reference track",
				size: "1280x720",
				seconds: 5,
				reference_audios: ["http://example.com/reference-track.mp3"],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("reference_audios");
	});

	test("/v1/videos forwards AtlasCloud text-to-video requests", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-atlascloud",
			...encryptProviderKeyForStorage(
				"atlascloud-test-token",
				"provider-key-atlascloud",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0",
				prompt: "A city street reflected in rain at night",
				size: "1280x720",
				seconds: 5,
				audio: false,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		expect(created.model).toBe("atlascloud/kling-v3-0");
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("atlascloud");
		expect(videoJob?.usedModel).toBe("kwaivgi/kling-v3.0-std/text-to-video");

		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.requestBody).toMatchObject({
			model: "kwaivgi/kling-v3.0-std/text-to-video",
			prompt: "A city street reflected in rain at night",
			duration: 5,
			aspect_ratio: "16:9",
			sound: false,
		});
	});

	test("/v1/videos does not persist prompts when retention is off", async () => {
		await db
			.update(tables.organization)
			.set({
				retentionLevel: "none",
			})
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id-zdr-video",
			...hashApiKeyForStorage("real-token-zdr-video"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-atlascloud-zdr",
			...encryptProviderKeyForStorage(
				"atlascloud-test-token",
				"provider-key-atlascloud-zdr",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-zdr-video",
			},
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0",
				prompt: "Do not persist this video prompt",
				size: "1280x720",
				seconds: 5,
				audio: false,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.prompt).toBe("");
		expect(videoJob?.upstreamCreateResponse).not.toHaveProperty(
			"llmgateway_raw_request",
		);
		expect(videoJob?.upstreamCreateResponse).not.toHaveProperty(
			"llmgateway_upstream_request",
		);
	});

	test("/v1/videos uploads AtlasCloud image-to-video frame inputs", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-atlascloud",
			...encryptProviderKeyForStorage(
				"atlascloud-test-token",
				"provider-key-atlascloud",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0-turbo",
				prompt: "Animate this product shot with a slow camera push",
				size: "720x1280",
				seconds: 10,
				image: { image_url: "data:image/png;base64,aGVsbG8=" },
				last_frame: { image_url: "data:image/png;base64,d29ybGQ=" },
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.imageUrls).toHaveLength(2);
		expect(mockVideo?.imageUrls?.[0]).toContain("/uploads/atlascloud-media-");
		expect(mockVideo?.requestBody).toMatchObject({
			model: "kwaivgi/kling-v3.0-turbo/image-to-video",
			aspect_ratio: "9:16",
		});
		expect(mockVideo?.requestBody).toHaveProperty("image");
		expect(mockVideo?.requestBody).toHaveProperty("end_image");
		expect(mockVideo?.requestBody).not.toHaveProperty("sound");
		expect(mockVideo?.requestBody).not.toHaveProperty("image_url");
		expect(mockVideo?.requestBody).not.toHaveProperty("end_image_url");
	});

	test("/v1/videos routes AtlasCloud 4K requests to the 4K upstream model", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-atlascloud",
			...encryptProviderKeyForStorage(
				"atlascloud-test-token",
				"provider-key-atlascloud",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0",
				prompt: "A cinematic wide shot in 4K",
				size: "3840x2160",
				seconds: 5,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.requestBody).toMatchObject({
			model: "kwaivgi/kling-v3.0-4k/text-to-video",
			aspect_ratio: "16:9",
		});
	});

	test("/v1/videos rejects AtlasCloud Turbo 4K requests", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-atlascloud",
			...encryptProviderKeyForStorage(
				"atlascloud-test-token",
				"provider-key-atlascloud",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0-turbo",
				prompt: "A cinematic wide shot in 4K",
				size: "3840x2160",
				seconds: 5,
			}),
		});

		expect(createRes.status).toBe(400);
		await expect(createRes.json()).resolves.toMatchObject({
			error: {
				message: expect.stringContaining("size 3840x2160 is unsupported"),
			},
		});
	});

	test("/v1/videos rejects AtlasCloud Turbo silent requests", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-atlascloud",
			...encryptProviderKeyForStorage(
				"atlascloud-test-token",
				"provider-key-atlascloud",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0-turbo",
				prompt: "A silent product turntable",
				size: "1280x720",
				seconds: 5,
				audio: false,
			}),
		});

		expect(createRes.status).toBe(400);
		await expect(createRes.json()).resolves.toMatchObject({
			error: {
				message: expect.stringContaining("audio=false is unsupported"),
			},
		});
	});

	test("/v1/videos rejects AtlasCloud reference inputs", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-atlascloud",
			...encryptProviderKeyForStorage(
				"atlascloud-test-token",
				"provider-key-atlascloud",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0",
				prompt: "Use these references for character and motion",
				size: "1280x720",
				seconds: 5,
				reference_images: [
					{ image_url: "https://example.com/character.png" },
					{ image_url: "data:image/png;base64,aGVsbG8=" },
				],
				reference_videos: ["https://example.com/motion.mp4"],
			}),
		});

		expect(createRes.status).toBe(400);
		await expect(createRes.json()).resolves.toMatchObject({
			error: {
				message: expect.stringContaining(
					"reference inputs are unsupported on AtlasCloud KLING v3.0 models",
				),
			},
		});
	});

	test("/v1/videos rejects AtlasCloud reference audio", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-atlascloud",
			...encryptProviderKeyForStorage(
				"atlascloud-test-token",
				"provider-key-atlascloud",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "atlascloud/kling-v3-0-turbo",
				prompt: "Use the reference track",
				size: "1280x720",
				seconds: 5,
				reference_audios: ["https://example.com/reference.mp3"],
			}),
		});

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toMatchObject({
			error: {
				message: expect.stringContaining(
					"reference inputs are unsupported on AtlasCloud KLING v3.0 models",
				),
			},
		});
	});

	test("/v1/videos bills AtlasCloud 4K audio and silent output at the same rate", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-atlascloud",
			...encryptProviderKeyForStorage(
				"atlascloud-test-token",
				"provider-key-atlascloud",
				"org-id",
			),
			provider: "atlascloud",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const seconds = 5;
		const fourKPerSecondPrice = 0.42;
		const expectedCost = fourKPerSecondPrice * seconds;

		for (const [requestId, audio] of [
			["atlascloud-audio-request", true],
			["atlascloud-silent-request", false],
		] as const) {
			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-request-id": requestId,
				},
				body: JSON.stringify({
					model: "atlascloud/kling-v3-0",
					prompt: `A precise product turntable, audio=${audio}`,
					size: "3840x2160",
					seconds,
					audio,
				}),
			});
			expect(createRes.status).toBe(200);
			const created = await createRes.json();
			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			const mockVideo = getMockVideo(videoJob!.upstreamId);
			expect(mockVideo?.requestBody).toMatchObject({
				model: "kwaivgi/kling-v3.0-4k/text-to-video",
				sound: audio,
			});
			setMockVideoStatus(videoJob!.upstreamId, "completed");
		}

		await processPendingVideoJobs();

		const logs = await db.query.log.findMany({
			where: {
				usedModel: { eq: "atlascloud/kling-v3-0" },
			},
		});
		expect(logs).toHaveLength(2);
		const videoOutputCosts = logs.map((log) => log.videoOutputCost ?? 0).sort();
		const totalCosts = logs.map((log) => log.cost ?? 0).sort();
		expect(videoOutputCosts[0]).toBeCloseTo(expectedCost, 6);
		expect(videoOutputCosts[1]).toBeCloseTo(expectedCost, 6);
		expect(totalCosts[0]).toBeCloseTo(expectedCost, 6);
		expect(totalCosts[1]).toBeCloseTo(expectedCost, 6);
	});

	test("/v1/videos restricts reference inputs to Seedance 2.x models", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "bytedance/seedance-1-5-pro",
				prompt: "Reproduce this motion",
				size: "1280x720",
				seconds: 5,
				reference_videos: ["https://example.com/reference-motion.mp4"],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("Seedance 2.x");
	});

	test("/v1/videos forwards up to nine reference images to Seedance 2.0 Fast", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-bytedance-key",
				"provider-key-id",
				"org-id",
			),
			provider: "bytedance",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const referenceImages = Array.from({ length: 9 }, (_, index) => ({
			image_url: `data:image/png;base64,${Buffer.from(`ref-${index}`).toString("base64")}`,
		}));

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "seedance-2-0-fast",
				prompt: "Combine these references into one clip",
				size: "1280x720",
				seconds: 5,
				reference_images: referenceImages,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("bytedance");

		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.referenceImages).toHaveLength(9);
	});

	test("/v1/videos routes Seedance 2.5 with its own resolution and duration range", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-bytedance-key",
				"provider-key-id",
				"org-id",
			),
			provider: "bytedance",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "seedance-2-5",
				prompt: "A long single-shot walk through a night market",
				size: "848x480",
				seconds: 30,
				audio: false,
				reference_videos: ["https://example.com/reference-motion.mp4"],
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("bytedance");
		expect(videoJob?.usedModel).toBe("dreamina-seedance-2-5-260628");

		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.resolution).toBe("480p");
		expect(mockVideo?.duration).toBe(30);
		expect(mockVideo?.ratio).toBe("16:9");
		expect(mockVideo?.referenceVideoUrls).toEqual([
			"https://example.com/reference-motion.mp4",
		]);
	});

	test("/v1/videos rejects 4K and over-30s durations on Seedance 2.5", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-bytedance-key",
				"provider-key-id",
				"org-id",
			),
			provider: "bytedance",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const fourKRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "bytedance/seedance-2-5",
				prompt: "A night market",
				size: "3840x2160",
				seconds: 4,
			}),
		});
		expect(fourKRes.status).toBe(400);

		const tooLongRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "bytedance/seedance-2-5",
				prompt: "A night market",
				size: "1280x720",
				seconds: 31,
			}),
		});
		expect(tooLongRes.status).toBe(400);
	});

	test("/v1/videos rejects more than nine reference images on Seedance 2.0 Fast", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const referenceImages = Array.from({ length: 10 }, (_, index) => ({
			image_url: `data:image/png;base64,${Buffer.from(`ref-${index}`).toString("base64")}`,
		}));

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "seedance-2-0-fast",
				prompt: "Too many references",
				size: "1280x720",
				seconds: 5,
				reference_images: referenceImages,
			}),
		});

		expect(res.status).toBe(400);
	});

	test("/v1/videos rejects more than three reference images on veo", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-google-vertex-key",
				"provider-key-id",
				"org-id",
			),
			provider: "google-vertex",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const referenceImages = Array.from({ length: 4 }, (_, index) => ({
			image_url: `data:image/png;base64,${Buffer.from(`ref-${index}`).toString("base64")}`,
		}));

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "google-vertex/veo-3.1-generate-preview",
				prompt: "Too many references for veo",
				size: "1280x720",
				seconds: 8,
				reference_images: referenceImages,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("at most 3 reference images");
	});

	test("/v1/videos serves credits mode from a managed credential and pins it to the job", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalRuntimeGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		const originalGoogleVertexApiKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
		// No LLM_* credential for the provider: the managed credential alone must
		// make it routable and carry every setting video generation needs.
		delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
		delete process.env.LLM_GOOGLE_VERTEX_API_KEY;
		process.env.GOOGLE_CLOUD_PROJECT = "managed-video-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});
			await harness.setProjectMode("credits");

			await cdb.insert(tables.providerKey).values({
				id: "managed-vertex-video",
				provider: "google-vertex",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"managed-vertex-video",
					null,
				),
				managed: true,
				organizationId: null,
				config: {
					baseUrl: mockServerUrl,
					project: "managed-video-project",
					region: "us-central1",
				},
			});

			const res = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-generate-preview",
					prompt: "A managed credential rendering a sunrise",
					size: "1920x1080",
					seconds: 8,
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: json.id } },
			});
			expect(videoJob?.usedProvider).toBe("google-vertex");
			expect(videoJob?.usedMode).toBe("credits");
			// Polling happens later, possibly from the worker, so the exact
			// credential that created the job is recorded on it.
			expect(videoJob?.managedProviderKeyId).toBe("managed-vertex-video");

			// And the job stays pollable through that same credential — both from
			// the gateway and from the worker, which runs long after the request
			// with no env var to fall back on.
			const statusRes = await app.request(`/v1/videos/${json.id}`, {
				headers: { Authorization: "Bearer real-token" },
			});
			expect(statusRes.status).toBe(200);
			expect((await statusRes.json()).model).toBe(
				"google-vertex/veo-3.1-generate-preview",
			);

			setMockVideoStatus(videoJob!.upstreamId, "completed");
			await processPendingVideoJobs();

			const completedRes = await app.request(`/v1/videos/${json.id}`, {
				headers: { Authorization: "Bearer real-token" },
			});
			expect(completedRes.status).toBe(200);
			expect((await completedRes.json()).status).toBe("completed");
		} finally {
			await harness.setProjectMode("api-keys");
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			}
			if (originalRuntimeGoogleCloudProject !== undefined) {
				process.env.GOOGLE_CLOUD_PROJECT = originalRuntimeGoogleCloudProject;
			} else {
				delete process.env.GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
			if (originalGoogleVertexApiKey !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_API_KEY = originalGoogleVertexApiKey;
			}
		}
	});

	test("/v1/videos excludes a projectless managed Vertex API key", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		const originalGoogleVertexApiKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "env-video-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "env-vertex-test-token";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});
			await harness.setProjectMode("credits");

			await cdb.insert(tables.providerKey).values({
				id: "managed-vertex-video-projectless",
				provider: "google-vertex",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"managed-vertex-video-projectless",
					null,
				),
				managed: true,
				organizationId: null,
				config: {
					baseUrl: mockServerUrl,
					region: "us-central1",
				},
			});

			const res = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-no-fallback": "true",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-generate-preview",
					prompt: "A projectless credential must not reach Veo",
					size: "1920x1080",
					seconds: 8,
				}),
			});

			expect(res.status).toBe(400);
		} finally {
			await harness.setProjectMode("api-keys");
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
			if (originalGoogleVertexApiKey !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_API_KEY = originalGoogleVertexApiKey;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_API_KEY;
			}
		}
	});

	test("/v1/videos bills xAI 480p video and image input separately", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"xai-test-token",
				"provider-key-id",
				"org-id",
			),
			provider: "xai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "xai/grok-imagine-video-1-5-preview",
				prompt: "A cat walking through a neon alley",
				size: "848x480",
				seconds: 6,
				image: { image_url: "data:image/png;base64,aGVsbG8=" },
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob).toBeTruthy();

		setMockVideoStatus(videoJob!.upstreamId, "completed");
		await processPendingVideoJobs();

		const logs = await db.query.log.findMany({
			where: { usedModel: { eq: "xai/grok-imagine-video-1-5-preview" } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].imageInputCost).toBe(0.01);
		expect(logs[0].videoOutputCost).toBe(0.48);
		expect(logs[0].cost).toBe(0.49);
	});

	test("/v1/videos bills xAI 720p at the 720p rate", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"xai-test-token",
				"provider-key-id",
				"org-id",
			),
			provider: "xai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "xai/grok-imagine-video-1-5-preview",
				prompt: "A cat walking across a rooftop at sunset",
				size: "1280x720",
				seconds: 6,
				image: { image_url: "data:image/png;base64,aGVsbG8=" },
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob).toBeTruthy();

		setMockVideoStatus(videoJob!.upstreamId, "completed");
		await processPendingVideoJobs();

		const logs = await db.query.log.findMany({
			where: { usedModel: { eq: "xai/grok-imagine-video-1-5-preview" } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].imageInputCost).toBe(0.01);
		expect(logs[0].videoOutputCost).toBe(0.84);
		expect(logs[0].cost).toBe(0.85);
	});

	test("/v1/videos caps logged xAI polling error response contents", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"xai-test-token",
				"provider-key-id",
				"org-id",
			),
			provider: "xai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "xai/grok-imagine-video-1-5",
				prompt: "A cat walking across a rooftop at sunset",
				size: "1280x720",
				seconds: 6,
				image: { image_url: "data:image/png;base64,aGVsbG8=" },
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob).toBeTruthy();

		const upstreamError = {
			detail: `The input image could not be processed: ${"x".repeat(5000)}discarded-suffix`,
			request_id: "upstream-request-id",
		};
		setMockVideoStatusResponse(videoJob!.upstreamId, 400, upstreamError);
		await db
			.update(tables.videoJob)
			.set({
				upstreamStatusResponse: {
					llmgateway_poll_error_count: 4,
				},
			})
			.where(eq(tables.videoJob.id, videoJob!.id));

		await processPendingVideoJobs();

		const persistedJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		const log = await db.query.log.findFirst({
			where: { requestId: { eq: videoJob!.requestId } },
		});
		const expectedError = `Upstream status request failed with status 400: ${JSON.stringify(upstreamError).slice(0, 4000)}`;
		const statusResponse = persistedJob?.upstreamStatusResponse as Record<
			string,
			unknown
		>;
		expect(persistedJob?.status).toBe("failed");
		expect(persistedJob?.error?.message).toContain(expectedError);
		expect(statusResponse.llmgateway_last_poll_error).toBe(expectedError);
		expect(log?.errorDetails?.responseText).toContain(expectedError);
		expect(JSON.stringify(persistedJob)).not.toContain("discarded-suffix");
		expect(JSON.stringify(log)).not.toContain("discarded-suffix");
	});

	test("/v1/videos maps xAI poll moderation to content_filter", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"xai-test-token",
				"provider-key-id",
				"org-id",
			),
			provider: "xai",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "xai/grok-imagine-video-1-5",
				prompt: "A cat walking across a rooftop at sunset",
				size: "1280x720",
				seconds: 6,
				image: { image_url: "data:image/png;base64,aGVsbG8=" },
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob).toBeTruthy();

		const upstreamError = {
			code: "imagine:content-moderated",
			error: "Generated video rejected by content moderation.",
			usage: { cost_in_usd_ticks: 0 },
		};
		setMockVideoStatusResponse(videoJob!.upstreamId, 400, upstreamError);

		await processPendingVideoJobs();

		const persistedJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		const log = await db.query.log.findFirst({
			where: { requestId: { eq: videoJob!.requestId } },
		});
		expect(persistedJob?.status).toBe("failed");
		expect(persistedJob?.pollAttemptCount).toBe(1);
		expect(persistedJob?.error).toMatchObject({
			code: "imagine:content-moderated",
			message: "Generated video rejected by content moderation.",
		});
		expect(log?.finishReason).toBe("content_filter");
		expect(log?.unifiedFinishReason).toBe("content_filter");
	});

	test("/v1/videos supports completed google-vertex jobs", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalRuntimeGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		const originalGoogleVertexVideoOutputBucket =
			process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;
		const originalGoogleVertexSignedUrlBaseUrl =
			process.env.LLM_GOOGLE_VERTEX_TEST_SIGNED_URL_BASE_URL;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "provider-project";
		process.env.GOOGLE_CLOUD_PROJECT = "runtime-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";
		process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET = "vertex-test-bucket";
		process.env.LLM_GOOGLE_VERTEX_TEST_SIGNED_URL_BASE_URL = `${mockServerUrl}/mock-gcs`;

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"provider-key-id",
					"org-id",
				),
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-generate-preview",
					prompt: "A cinematic waterfall in the mountains",
					size: "3840x2160",
					seconds: 8,
				}),
			});

			expect(createRes.status).toBe(200);
			const created = await createRes.json();
			expect(created.content).toBeUndefined();

			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(videoJob).toBeTruthy();
			expect(videoJob?.usedProvider).toBe("google-vertex");
			expect(videoJob?.usedModel).toBe("veo-3.1-generate-001");
			expect(videoJob?.upstreamId).toContain("projects/runtime-project/");
			expect(
				(
					videoJob?.upstreamStatusResponse as {
						google_vertex_project_id?: string;
					} | null
				)?.google_vertex_project_id,
			).toBe("runtime-project");

			setMockVideoStatus(videoJob!.upstreamId, "completed");
			await processPendingVideoJobs();

			const getRes = await app.request(`/v1/videos/${created.id}`, {
				headers: {
					Authorization: "Bearer real-token",
				},
			});
			expect(getRes.status).toBe(200);
			const jobJson = await getRes.json();
			expect(jobJson.status).toBe("completed");
			const logs = await db.query.log.findMany({
				where: {
					usedModel: { eq: "google-vertex/veo-3.1-generate-preview" },
				},
			});
			expect(logs).toHaveLength(1);
			expectSignedVideoLogContentUrl(jobJson.content?.[0]?.url, logs[0].id);

			const contentRes = await app.request(`/v1/videos/${created.id}/content`, {
				headers: {
					Authorization: "Bearer real-token",
				},
			});
			expect(contentRes.status).toBe(200);
			expect(contentRes.headers.get("content-type")).toContain("video/mp4");
			expect(await contentRes.text()).toBe(
				`mock-video-${videoJob!.upstreamId}`,
			);

			expect(logs[0].usedModelMapping).toBe("veo-3.1-generate-001");
			expect(logs[0].content).toBe(buildGatewayVideoLogContentUrl(logs[0].id));
			expect(logs[0].videoOutputCost).toBe(4.8);
			expect(logs[0].cost).toBe(4.8);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
			if (originalRuntimeGoogleCloudProject !== undefined) {
				process.env.GOOGLE_CLOUD_PROJECT = originalRuntimeGoogleCloudProject;
			} else {
				delete process.env.GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
			if (originalGoogleVertexVideoOutputBucket !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET =
					originalGoogleVertexVideoOutputBucket;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;
			}
			if (originalGoogleVertexSignedUrlBaseUrl !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_TEST_SIGNED_URL_BASE_URL =
					originalGoogleVertexSignedUrlBaseUrl;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_TEST_SIGNED_URL_BASE_URL;
			}
		}
	});

	test("/v1/videos accepts 10 second google-vertex jobs", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalRuntimeGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		const originalGoogleVertexVideoOutputBucket =
			process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "provider-project";
		process.env.GOOGLE_CLOUD_PROJECT = "runtime-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";
		process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET = "vertex-test-bucket";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"provider-key-id",
					"org-id",
				),
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-generate-preview",
					prompt: "A slow aerial shot above an alpine lake at sunrise",
					seconds: 10,
				}),
			});

			expect(createRes.status).toBe(200);
			const created = await createRes.json();

			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(videoJob?.usedProvider).toBe("google-vertex");

			const mockVideo = getMockVideo(videoJob!.upstreamId);
			expect(mockVideo?.duration).toBe(10);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
			if (originalRuntimeGoogleCloudProject !== undefined) {
				process.env.GOOGLE_CLOUD_PROJECT = originalRuntimeGoogleCloudProject;
			} else {
				delete process.env.GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
			if (originalGoogleVertexVideoOutputBucket !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET =
					originalGoogleVertexVideoOutputBucket;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;
			}
		}
	});

	test("/v1/videos forwards frame inputs to google-vertex", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"provider-key-id",
					"org-id",
				),
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-generate-preview",
					prompt: "Animate this product shot into a subtle turntable reveal",
					size: "1280x720",
					seconds: 4,
					image: {
						image_url: "data:image/png;base64,aGVsbG8=",
					},
					last_frame: {
						image_url: "data:image/png;base64,d29ybGQ=",
					},
				}),
			});

			expect(createRes.status).toBe(200);
			const created = await createRes.json();

			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(videoJob?.usedProvider).toBe("google-vertex");

			const mockVideo = getMockVideo(videoJob!.upstreamId);
			expect(mockVideo?.firstFrame).toEqual({
				bytesBase64Encoded: "aGVsbG8=",
				mimeType: "image/png",
			});
			expect(mockVideo?.lastFrame).toEqual({
				bytesBase64Encoded: "d29ybGQ=",
				mimeType: "image/png",
			});
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
		}
	});

	test("/v1/videos forwards frame inputs to bytedance Seedance 2.0", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-bytedance-key",
				"provider-key-id",
				"org-id",
			),
			provider: "bytedance",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "seedance-2-0",
				prompt: "Morph from the first frame into the last frame",
				size: "1280x720",
				seconds: 5,
				image: {
					image_url: "data:image/png;base64,aGVsbG8=",
				},
				last_frame: {
					image_url: "data:image/png;base64,d29ybGQ=",
				},
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("bytedance");

		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.firstFrame).toEqual({
			bytesBase64Encoded: "aGVsbG8=",
			mimeType: "image/png",
		});
		expect(mockVideo?.lastFrame).toEqual({
			bytesBase64Encoded: "d29ybGQ=",
			mimeType: "image/png",
		});
		expect(mockVideo?.ratio).toBe("16:9");
	});

	test("/v1/videos forwards portrait size as ratio 9:16 to bytedance", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-bytedance-key",
				"provider-key-id",
				"org-id",
			),
			provider: "bytedance",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "seedance-2-0",
				prompt: "A vertical clip of a waterfall",
				size: "1080x1920",
				seconds: 15,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("bytedance");

		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.ratio).toBe("9:16");
		expect(mockVideo?.resolution).toBe("1080p");
		expect(mockVideo?.duration).toBe(15);
	});

	test("/v1/videos rejects frame inputs on non-Seedance-2.0 bytedance models", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-bytedance-key",
				"provider-key-id",
				"org-id",
			),
			provider: "bytedance",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "bytedance/seedance-1-5-pro",
				prompt: "Morph from the first frame into the last frame",
				size: "1280x720",
				seconds: 5,
				image: {
					image_url: "data:image/png;base64,aGVsbG8=",
				},
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"frame inputs are currently only supported on bytedance Seedance 2.x",
		);
	});

	test("/v1/videos forwards reference images to google-vertex preview", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"provider-key-id",
					"org-id",
				),
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-generate-preview",
					prompt: "Keep the same product and lighting language in motion",
					size: "1280x720",
					seconds: 8,
					reference_images: [
						{
							image_url: "data:image/png;base64,aGVsbG8=",
						},
						{
							image_url: "data:image/png;base64,d29ybGQ=",
						},
					],
				}),
			});

			expect(createRes.status).toBe(200);
			const created = await createRes.json();

			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(videoJob?.usedProvider).toBe("google-vertex");
			expect(videoJob?.usedModel).toBe("veo-3.1-generate-001");

			const mockVideo = getMockVideo(videoJob!.upstreamId);
			expect(mockVideo?.referenceImages).toEqual([
				{
					bytesBase64Encoded: "aGVsbG8=",
					mimeType: "image/png",
					referenceType: "asset",
				},
				{
					bytesBase64Encoded: "d29ybGQ=",
					mimeType: "image/png",
					referenceType: "asset",
				},
			]);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
		}
	});

	test("/v1/videos bills google-vertex fast using audio pricing", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"provider-key-id",
					"org-id",
				),
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-fast-generate-preview",
					prompt: "A stylish coffee pour in a modern cafe",
					size: "1920x1080",
					seconds: 4,
				}),
			});

			expect(createRes.status).toBe(200);
			const created = await createRes.json();

			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(videoJob).toBeTruthy();

			setMockVideoStatus(videoJob!.upstreamId, "completed");
			await processPendingVideoJobs();

			const logs = await db.query.log.findMany({
				where: {
					usedModel: { eq: "google-vertex/veo-3.1-fast-generate-preview" },
				},
			});
			expect(logs).toHaveLength(1);
			expect(logs[0].videoOutputCost).toBe(0.6);
			expect(logs[0].cost).toBe(0.6);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
		}
	});

	test("/v1/videos bills google-vertex fast silent output using silent pricing", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"provider-key-id",
					"org-id",
				),
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-fast-generate-preview",
					prompt: "A paper airplane gliding through a sunlit office",
					size: "1920x1080",
					seconds: 4,
					audio: false,
				}),
			});

			expect(createRes.status).toBe(200);
			const created = await createRes.json();

			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(videoJob).toBeTruthy();

			setMockVideoStatus(videoJob!.upstreamId, "completed");
			await processPendingVideoJobs();

			const logs = await db.query.log.findMany({
				where: {
					usedModel: { eq: "google-vertex/veo-3.1-fast-generate-preview" },
				},
			});
			expect(logs).toHaveLength(1);
			expect(logs[0].videoOutputCost).toBe(0.4);
			expect(logs[0].cost).toBe(0.4);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
		}
	});

	test("/v1/videos keeps inline vertex output when no GCS bucket is configured", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalRuntimeGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		const originalGoogleVertexVideoOutputBucket =
			process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;
		const originalGoogleVertexSignedUrlBaseUrl =
			process.env.LLM_GOOGLE_VERTEX_TEST_SIGNED_URL_BASE_URL;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "provider-project";
		process.env.GOOGLE_CLOUD_PROJECT = "runtime-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";
		delete process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;
		delete process.env.LLM_GOOGLE_VERTEX_TEST_SIGNED_URL_BASE_URL;

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"provider-key-id",
					"org-id",
				),
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-generate-preview",
					prompt: "A cinematic waterfall in the mountains",
					size: "1920x1080",
					seconds: 8,
				}),
			});

			expect(createRes.status).toBe(200);
			const created = await createRes.json();

			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(videoJob?.storageUri).toBeNull();
			expect(videoJob?.upstreamId).toContain("projects/provider-project/");
			expect(
				(
					videoJob?.upstreamStatusResponse as {
						google_vertex_project_id?: string;
					} | null
				)?.google_vertex_project_id,
			).toBe("provider-project");

			setMockVideoStatus(videoJob!.upstreamId, "completed");
			await processPendingVideoJobs();

			const getRes = await app.request(`/v1/videos/${created.id}`, {
				headers: {
					Authorization: "Bearer real-token",
				},
			});
			expect(getRes.status).toBe(200);
			const jobJson = await getRes.json();
			const logs = await db.query.log.findMany({
				where: {
					usedModel: { eq: "google-vertex/veo-3.1-generate-preview" },
				},
			});
			expect(logs).toHaveLength(1);
			expectSignedVideoLogContentUrl(jobJson.content?.[0]?.url, logs[0].id);

			const contentRes = await app.request(`/v1/videos/${created.id}/content`, {
				headers: {
					Authorization: "Bearer real-token",
				},
			});
			expect(contentRes.status).toBe(200);
			expect(contentRes.headers.get("content-type")).toContain("video/mp4");
			expect(await contentRes.text()).toBe(
				`mock-video-${videoJob!.upstreamId}`,
			);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
			if (originalRuntimeGoogleCloudProject !== undefined) {
				process.env.GOOGLE_CLOUD_PROJECT = originalRuntimeGoogleCloudProject;
			} else {
				delete process.env.GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
			if (originalGoogleVertexVideoOutputBucket !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET =
					originalGoogleVertexVideoOutputBucket;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;
			}
			if (originalGoogleVertexSignedUrlBaseUrl !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_TEST_SIGNED_URL_BASE_URL =
					originalGoogleVertexSignedUrlBaseUrl;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_TEST_SIGNED_URL_BASE_URL;
			}
		}
	});

	test("/v1/videos rejects inline vertex output when retention is off", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		const originalGoogleVertexVideoOutputBucket =
			process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";
		delete process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;

		try {
			await db
				.update(tables.organization)
				.set({
					retentionLevel: "none",
				})
				.where(eq(tables.organization.id, "org-id"));

			await db.insert(tables.apiKey).values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				...encryptProviderKeyForStorage(
					"vertex-test-token",
					"provider-key-id",
					"org-id",
				),
				provider: "google-vertex",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			});

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "google-vertex/veo-3.1-generate-preview",
					prompt: "A cinematic waterfall in the mountains",
					size: "1920x1080",
					seconds: 8,
				}),
			});

			expect(createRes.status).toBe(400);
			expect(await createRes.text()).toContain(
				"GCS output storage or data retention",
			);
		} finally {
			if (originalGoogleCloudProject !== undefined) {
				process.env.LLM_GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
			} else {
				delete process.env.LLM_GOOGLE_CLOUD_PROJECT;
			}
			if (originalGoogleVertexRegion !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalGoogleVertexRegion;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			}
			if (originalGoogleVertexVideoOutputBucket !== undefined) {
				process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET =
					originalGoogleVertexVideoOutputBucket;
			} else {
				delete process.env.LLM_GOOGLE_VERTEX_VIDEO_OUTPUT_BUCKET;
			}
		}
	});

	test("/v1/videos rejects non-positive duration values", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "veo-3.1-generate-preview",
				prompt: "A fast moving train in the desert",
				seconds: 0,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("seconds");
	});

	test("/v1/videos rejects durations above the model maximum", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "veo-3.1-generate-preview",
				prompt: "A fast moving train in the desert",
				seconds: 11,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("11s");
		expect(JSON.stringify(json)).toContain("10s");
	});

	test("/v1/videos requires seconds", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "veo-3.1-generate-preview",
				prompt: "A fast moving train in the desert",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("seconds");
	});

	test("/v1/videos rejects unsupported size values", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "veo-3.1-generate-preview",
				prompt: "A quiet forest at dawn",
				size: "1080x1080",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("size");
		expect(JSON.stringify(json)).toContain("1280x720");
	});
});
