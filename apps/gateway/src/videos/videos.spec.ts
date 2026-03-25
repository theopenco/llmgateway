import { beforeAll, describe, expect, test } from "vitest";
import {
	processPendingVideoJobs,
	processPendingWebhookDeliveries,
} from "worker";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import {
	getMockVideo,
	getMockWebhookDeliveries,
	setMockVideoStatus,
	setMockWebhookStatus,
} from "@/test-utils/mock-openai-server.js";

import { db, eq, tables } from "@llmgateway/db";

describe.skip("videos", () => {
	const harness = createGatewayApiTestHarness({
		mockServerPort: 3002,
	});
	let mockServerUrl: string;

	beforeAll(() => {
		mockServerUrl = harness.mockServerUrl;
	});

	async function setRoutingMetrics(
		modelId: string,
		providerId: string,
		metrics: {
			uptime: number;
			latency?: number;
			throughput?: number;
			totalRequests?: number;
		},
	) {
		await harness.setRoutingMetrics(modelId, providerId, metrics);
	}

	function expectSignedVideoLogContentUrl(url: string, logId: string) {
		return harness.expectSignedVideoLogContentUrl(url, logId);
	}

	test("/v1/videos creates an async video job", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "veo-3.1-generate-preview",
				prompt: "A robot dancing in the rain",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.object).toBe("video");
		expect(json.model).toBe("veo-3.1-generate-preview");
		expect(json.status).toBe("queued");

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: json.id } },
		});
		expect(videoJob).toBeTruthy();
		expect(videoJob?.upstreamId).toBe("video_1");
		expect(videoJob?.usedModel).toBe("veo-3.1-landscape");
		expect(
			(videoJob?.upstreamCreateResponse as { size?: string } | null)?.size,
		).toBe("1280x720");
	});

	test("/v1/videos supports openai sora-2 jobs", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-openai",
			token: "sk-openai-key",
			provider: "openai",
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
				model: "sora-2",
				prompt: "A paper airplane gliding over a calm city skyline",
				size: "1280x720",
				seconds: 4,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("openai");
		expect(videoJob?.usedModel).toBe("sora-2");
		expect(videoJob?.upstreamId).toMatch(/^video_/);

		setMockVideoStatus(videoJob!.upstreamId, "completed", {
			content: [],
		});
		await processPendingVideoJobs();

		const getRes = await app.request(`/v1/videos/${created.id}`, {
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(getRes.status).toBe(200);
		const jobJson = await getRes.json();
		expect(jobJson.status).toBe("completed");

		const contentRes = await app.request(`/v1/videos/${created.id}/content`, {
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(contentRes.status).toBe(200);
		expect(contentRes.headers.get("content-type")).toContain("video/mp4");
		expect(await contentRes.text()).toBe(`mock-video-${videoJob!.upstreamId}`);

		const logs = await db.query.log.findMany({
			where: { usedModel: { eq: "openai/sora-2" } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].usedModelMapping).toBe("sora-2");
		expect(logs[0].videoOutputCost).toBe(0.4);
	});

	test("/v1/videos supports obsidian sora-2 jobs", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-obsidian",
			token: "sk-obsidian-key",
			provider: "obsidian",
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
				model: "sora-2",
				prompt: "A paper lantern floating over a river at dusk",
				size: "1280x720",
				seconds: 10,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("obsidian");
		expect(videoJob?.usedModel).toBe("sora-2");
		expect(videoJob?.status).toBe("queued");

		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.model).toBe("sora-2");
		expect(mockVideo?.duration).toBe(10);

		setMockVideoStatus(videoJob!.upstreamId, "completed", {
			content: [],
		});
		await processPendingVideoJobs();

		const logs = await db.query.log.findMany({
			where: { usedModel: { eq: "obsidian/sora-2" } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].usedModelMapping).toBe("sora-2");
		expect(logs[0].videoOutputCost).toBe(0.8);
	});

	test("/v1/videos bills openai sora-2-pro by resolution tier", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-openai",
			token: "sk-openai-key",
			provider: "openai",
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
				model: "openai/sora-2-pro",
				prompt: "A cinematic product fly-through with crisp studio lighting",
				size: "1920x1080",
				seconds: 4,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("openai");
		expect(videoJob?.usedModel).toBe("sora-2-pro");

		setMockVideoStatus(videoJob!.upstreamId, "completed", {
			content: [],
		});
		await processPendingVideoJobs();

		const logs = await db.query.log.findMany({
			where: { usedModel: { eq: "openai/sora-2-pro" } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].usedModelMapping).toBe("sora-2-pro");
		expect(logs[0].videoOutputCost).toBe(2.8);
		expect(logs[0].cost).toBe(2.8);
	});

	test("/v1/videos supports obsidian sora-2-pro image jobs", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-obsidian",
			token: "sk-obsidian-key",
			provider: "obsidian",
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
				model: "sora-2-pro",
				prompt: "Animate this product still into a premium studio reveal",
				size: "1280x720",
				seconds: 15,
				input_reference: {
					image_url: "data:image/png;base64,aGVsbG8=",
				},
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("obsidian");
		expect(videoJob?.usedModel).toBe("sora-2-pro");

		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.model).toBe("sora-2-pro");
		expect(mockVideo?.duration).toBe(15);
		expect(mockVideo?.firstFrame).toEqual({
			bytesBase64Encoded: "aGVsbG8=",
			mimeType: "image/png",
		});

		setMockVideoStatus(videoJob!.upstreamId, "completed", {
			content: [],
		});
		await processPendingVideoJobs();

		const logs = await db.query.log.findMany({
			where: { usedModel: { eq: "obsidian/sora-2-pro" } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].usedModelMapping).toBe("sora-2-pro");
		expect(logs[0].videoOutputCost).toBe(3.6);
	});

	test("/v1/videos rewrites obsidian sora-2-pro channel errors", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-obsidian",
			token: "sk-obsidian-key",
			provider: "obsidian",
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
				model: "obsidian/sora-2-pro",
				prompt: "TRIGGER_OBSIDIAN_NO_CHANNEL",
				size: "1280x720",
				seconds: 15,
			}),
		});

		expect(createRes.status).toBe(503);
		const body = await createRes.json();
		expect(JSON.stringify(body)).toContain("LLM_OBSIDIAN_SORA_ASYNC_API_KEY");
		expect(JSON.stringify(body)).toContain("async-api token");
	});

	test("/v1/videos uses obsidian async env overrides for sora models", async () => {
		const originalSoraApiKey = process.env.LLM_OBSIDIAN_SORA_ASYNC_API_KEY;
		const originalSoraBaseUrl = process.env.LLM_OBSIDIAN_SORA_ASYNC_BASE_URL;

		process.env.LLM_OBSIDIAN_SORA_ASYNC_API_KEY = "sk-obsidian-sora-async";
		process.env.LLM_OBSIDIAN_SORA_ASYNC_BASE_URL = mockServerUrl;

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-obsidian",
				token: "sk-obsidian-key",
				provider: "obsidian",
				organizationId: "org-id",
				baseUrl: "https://invalid-obsidian-base-url.example",
			});

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "obsidian/sora-2",
					prompt: "A paper airplane gliding through a bright studio",
					size: "1280x720",
					seconds: 10,
				}),
			});

			expect(createRes.status).toBe(200);
			const created = await createRes.json();

			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(videoJob?.usedProvider).toBe("obsidian");
			expect(videoJob?.usedModel).toBe("sora-2");

			const mockVideo = getMockVideo(videoJob!.upstreamId);
			expect(mockVideo?.model).toBe("sora-2");
		} finally {
			if (originalSoraApiKey !== undefined) {
				process.env.LLM_OBSIDIAN_SORA_ASYNC_API_KEY = originalSoraApiKey;
			} else {
				delete process.env.LLM_OBSIDIAN_SORA_ASYNC_API_KEY;
			}

			if (originalSoraBaseUrl !== undefined) {
				process.env.LLM_OBSIDIAN_SORA_ASYNC_BASE_URL = originalSoraBaseUrl;
			} else {
				delete process.env.LLM_OBSIDIAN_SORA_ASYNC_BASE_URL;
			}
		}
	});

	test("/v1/videos rejects sizes that obsidian does not support", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "veo-3.1-fast-generate-preview",
				prompt: "A race car on a mountain road",
				size: "1920x1080",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("1920x1080");
		expect(JSON.stringify(json)).toContain("obsidian");
	});

	test("/v1/videos rejects unsupported obsidian sora-2-pro durations", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "obsidian/sora-2-pro",
				prompt: "A race car on a mountain road",
				size: "1280x720",
				seconds: 10,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("10s");
		expect(JSON.stringify(json)).toContain("15s");
		expect(JSON.stringify(json)).toContain("obsidian");
	});

	test("/v1/videos explains avalanche constraint failures clearly", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "avalanche",
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
				model: "avalanche/veo-3.1-fast-generate-preview",
				prompt: "A race car on a mountain road",
				size: "1280x720",
				seconds: 6,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("size 1280x720");
		expect(JSON.stringify(json)).toContain("duration 6s");
		expect(JSON.stringify(json)).toContain("aspect_ratio");
		expect(JSON.stringify(json)).toContain("fixed 8s clips");
	});

	test("/v1/videos explains avalanche reference-image constraints clearly", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "avalanche",
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
				model: "avalanche/veo-3.1-generate-preview",
				prompt: "Turn these materials into a short ad clip",
				size: "1920x1080",
				seconds: 8,
				reference_images: [
					{
						image_url: "data:image/png;base64,aGVsbG8=",
					},
				],
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"avalanche/veo-3.1-fast-generate-preview",
		);
	});

	test("/v1/videos keeps portrait sizes on the default obsidian model", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "veo-3.1-generate-preview",
				prompt: "A skateboarder landing a trick",
				size: "720x1280",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(200);

		const json = await res.json();
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: json.id } },
		});
		expect(videoJob?.usedModel).toBe("veo-3.1");
		expect(
			(videoJob?.upstreamCreateResponse as { size?: string } | null)?.size,
		).toBe("720x1280");
	});

	test("/v1/videos routes 1080p sizes to avalanche", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values([
			{
				id: "provider-key-obsidian",
				token: "sk-obsidian-key",
				provider: "obsidian",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			},
			{
				id: "provider-key-avalanche",
				token: "sk-avalanche-key",
				provider: "avalanche",
				organizationId: "org-id",
				baseUrl: mockServerUrl,
			},
		]);

		const res = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "veo-3.1-generate-preview",
				prompt: "A motorcycle driving through Tokyo at night",
				size: "1920x1080",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(200);

		const json = await res.json();
		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: json.id } },
		});
		expect(videoJob?.usedProvider).toBe("avalanche");
		expect(videoJob?.usedModel).toBe("veo3");
		expect(videoJob?.upstreamId).toBe("avalanche_task_1");
		expect(
			(videoJob?.upstreamCreateResponse as { size?: string } | null)?.size,
		).toBe("1920x1080");
	});

	test("/v1/videos uses routing metrics to pick the best eligible provider", async () => {
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
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values([
				{
					id: "provider-key-avalanche",
					token: "sk-avalanche-key",
					provider: "avalanche",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
				{
					id: "provider-key-vertex",
					token: "vertex-test-token",
					provider: "google-vertex",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
			]);

			await setRoutingMetrics("veo-3.1-generate-preview", "avalanche", {
				uptime: 70,
				latency: 300,
				throughput: 50,
			});
			await setRoutingMetrics("veo-3.1-generate-preview", "google-vertex", {
				uptime: 99.5,
				latency: 100,
				throughput: 150,
			});

			const res = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "veo-3.1-generate-preview",
					prompt: "A futuristic train arriving at a neon station",
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
			expect(videoJob?.routingMetadata).toMatchObject({
				selectedProvider: "google-vertex",
				selectionReason: "weighted-score",
				availableProviders: ["google-vertex", "avalanche"],
			});
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

	test("/v1/videos falls back to the next provider and persists routing metadata", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values([
				{
					id: "provider-key-avalanche",
					token: "sk-avalanche-key",
					provider: "avalanche",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
				{
					id: "provider-key-vertex",
					token: "vertex-test-token",
					provider: "google-vertex",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
			]);

			await setRoutingMetrics("veo-3.1-generate-preview", "avalanche", {
				uptime: 70,
				latency: 300,
				throughput: 50,
			});
			await setRoutingMetrics("veo-3.1-generate-preview", "google-vertex", {
				uptime: 99.9,
				latency: 80,
				throughput: 180,
			});

			const res = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "veo-3.1-generate-preview",
					prompt: "TRIGGER_VERTEX_ONLY_500 A cinematic city skyline at dusk",
					size: "1920x1080",
					seconds: 8,
				}),
			});

			expect(res.status).toBe(200);

			const json = await res.json();
			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: json.id } },
			});
			expect(videoJob?.usedProvider).toBe("avalanche");
			expect(videoJob?.routingMetadata).toMatchObject({
				selectedProvider: "avalanche",
			});
			expect(
				videoJob?.routingMetadata?.routing?.map((attempt) => ({
					provider: attempt.provider,
					succeeded: attempt.succeeded,
					status_code: attempt.status_code,
				})),
			).toEqual([
				{
					provider: "google-vertex",
					succeeded: false,
					status_code: 500,
				},
				{
					provider: "avalanche",
					succeeded: true,
					status_code: 200,
				},
			]);

			setMockVideoStatus(videoJob!.upstreamId, "completed");
			await processPendingVideoJobs();

			const logs = await db.query.log.findMany({
				where: { usedModel: { eq: "avalanche/veo-3.1-generate-preview" } },
			});
			expect(logs).toHaveLength(1);
			expect(logs[0].routingMetadata).toMatchObject({
				selectedProvider: "avalanche",
			});
			expect(logs[0].routingMetadata?.routing).toHaveLength(2);
			expect(logs[0].routingMetadata?.providerScores).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						providerId: "google-vertex",
						failed: true,
						status_code: 500,
						error_type: "upstream_error",
					}),
				]),
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
		}
	});

	test("/v1/videos supports retrieve and content for completed jobs", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "obsidian/veo-3.1-generate-preview",
				prompt: "A cinematic sunset over mountains",
				seconds: 8,
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
			where: { usedModel: { eq: "obsidian/veo-3.1-generate-preview" } },
		});
		expect(logs).toHaveLength(1);

		const getRes = await app.request(`/v1/videos/${created.id}`, {
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(getRes.status).toBe(200);
		const jobJson = await getRes.json();
		expect(jobJson.status).toBe("completed");
		expect(jobJson.content[0].type).toBe("video");
		const signedContentUrl = expectSignedVideoLogContentUrl(
			jobJson.content[0].url,
			logs[0].id,
		);

		const contentRes = await app.request(`/v1/videos/${created.id}/content`, {
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(contentRes.status).toBe(200);
		expect(contentRes.headers.get("content-type")).toContain("video/mp4");
		expect(await contentRes.text()).toBe(`mock-video-${videoJob!.upstreamId}`);

		const unsignedProxyRes = await app.request(
			`/v1/videos/logs/${logs[0].id}/content`,
		);
		expect(unsignedProxyRes.status).toBe(401);

		const proxyRes = await app.request(
			`${signedContentUrl.pathname}${signedContentUrl.search}`,
		);
		expect(proxyRes.status).toBe(200);
		expect(await proxyRes.text()).toBe(`mock-video-${videoJob!.upstreamId}`);

		expect(logs[0].usedModelMapping).toBe("veo-3.1-landscape");
		expect(logs[0].content).toBe(
			`http://localhost:4001/v1/videos/logs/${logs[0].id}/content`,
		);
		expect(logs[0].requestCost).toBe(0);
		expect(logs[0].videoOutputCost).toBe(3.2);
		expect(logs[0].cost).toBe(3.2);
		expect(logs[0].messages).toEqual([
			{
				role: "user",
				content: "A cinematic sunset over mountains",
			},
		]);
		expect(logs[0].rawRequest).toEqual({
			model: "obsidian/veo-3.1-generate-preview",
			prompt: "A cinematic sunset over mountains",
			seconds: 8,
		});
		expect(logs[0].upstreamRequest).toEqual({
			model: "veo-3.1-landscape",
			prompt: "A cinematic sunset over mountains",
			size: "1280x720",
		});
		const downloadedLog = await db.query.log.findFirst({
			where: { id: { eq: logs[0].id } },
		});
		expect(downloadedLog?.videoDownloadCount).toBe(2);
		expect(downloadedLog?.lastVideoDownloadedAt).toBeTruthy();
	});

	test("/v1/videos supports completed 4k avalanche jobs", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "avalanche",
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
				model: "avalanche/veo-3.1-fast-generate-preview",
				prompt: "A storm above a mountain range",
				size: "3840x2160",
				seconds: 8,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob).toBeTruthy();
		expect(videoJob?.usedProvider).toBe("avalanche");

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
			where: { usedModel: { eq: "avalanche/veo-3.1-fast-generate-preview" } },
		});
		expect(logs).toHaveLength(1);
		expectSignedVideoLogContentUrl(jobJson.content[0].url, logs[0].id);

		const contentRes = await app.request(`/v1/videos/${created.id}/content`, {
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(contentRes.status).toBe(200);
		expect(contentRes.headers.get("content-type")).toContain("video/mp4");
		expect(await contentRes.text()).toBe(
			`mock-video-${videoJob!.upstreamId}-4k`,
		);

		expect(logs[0].usedModelMapping).toBe("veo3_fast");
		expect(logs[0].content).toBe(
			`http://localhost:4001/v1/videos/logs/${logs[0].id}/content`,
		);
		expect(logs[0].requestCost).toBe(0);
		expect(logs[0].videoOutputCost).toBe(2.8);
		expect(logs[0].cost).toBe(2.8);
	});

	test("/v1/videos supports avalanche sora-2 jobs", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-avalanche",
			token: "sk-avalanche-key",
			provider: "avalanche",
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
				model: "sora-2",
				prompt: "A futuristic kitchen ad with glossy reflections",
				size: "1280x720",
				seconds: 10,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("avalanche");
		expect(videoJob?.usedModel).toBe("sora-2");
		expect(videoJob?.status).toBe("queued");
		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.model).toBe("sora-2-text-to-video");
		expect(mockVideo?.imageUrls).toBeUndefined();
		expect(mockVideo?.size).toBe("1280x720");

		setMockVideoStatus(videoJob!.upstreamId, "completed", {
			content: [],
		});
		await processPendingVideoJobs();

		const getRes = await app.request(`/v1/videos/${created.id}`, {
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(getRes.status).toBe(200);
		const jobJson = await getRes.json();
		expect(jobJson.status).toBe("completed");

		const contentRes = await app.request(`/v1/videos/${created.id}/content`, {
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(contentRes.status).toBe(200);
		expect(contentRes.headers.get("content-type")).toContain("video/mp4");
		expect(await contentRes.text()).toBe(`mock-video-${videoJob!.upstreamId}`);

		const logs = await db.query.log.findMany({
			where: { usedModel: { eq: "avalanche/sora-2" } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].usedModelMapping).toBe("sora-2");
		expect(logs[0].videoOutputCost).toBe(0.8);
	});

	test("/v1/videos supports avalanche sora-2-pro image jobs", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-avalanche",
			token: "sk-avalanche-key",
			provider: "avalanche",
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
				model: "sora-2-pro",
				prompt: "Animate this product still into a glossy ad shot",
				size: "1792x1024",
				seconds: 10,
				input_reference: {
					image_url: "data:image/png;base64,aGVsbG8=",
				},
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("avalanche");
		expect(videoJob?.usedModel).toBe("sora-2-pro");
		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.model).toBe("sora-2-pro-image-to-video");
		expect(mockVideo?.size).toBe("1792x1024");
		expect(mockVideo?.imageUrls).toHaveLength(1);
		expect(mockVideo?.imageUrls?.[0]).toContain("/uploads/avalanche-image-");

		setMockVideoStatus(videoJob!.upstreamId, "completed", {
			content: [],
		});
		await processPendingVideoJobs();

		const getRes = await app.request(`/v1/videos/${created.id}`, {
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(getRes.status).toBe(200);
		const jobJson = await getRes.json();
		expect(jobJson.status).toBe("completed");

		const contentRes = await app.request(`/v1/videos/${created.id}/content`, {
			headers: {
				Authorization: "Bearer real-token",
			},
		});
		expect(contentRes.status).toBe(200);
		expect(contentRes.headers.get("content-type")).toContain("video/mp4");
		expect(await contentRes.text()).toBe(`mock-video-${videoJob!.upstreamId}`);

		const logs = await db.query.log.findMany({
			where: { usedModel: { eq: "avalanche/sora-2-pro" } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].usedModelMapping).toBe("sora-2-pro");
		expect(logs[0].videoOutputCost).toBe(4);
	});

	test("/v1/videos surfaces avalanche application-level task errors", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-avalanche",
			token: "sk-avalanche-key",
			provider: "avalanche",
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
				model: "avalanche/sora-2-pro",
				prompt: "TRIGGER_BODY_CODE_402",
				size: "1280x720",
				seconds: 10,
			}),
		});

		expect(createRes.status).toBe(402);
		const body = await createRes.json();
		expect(JSON.stringify(body)).toContain("Credits insufficient");
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
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "vertex-test-token",
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
			expect(videoJob?.usedModel).toBe("veo-3.1-generate-preview");
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

			expect(logs[0].usedModelMapping).toBe("veo-3.1-generate-preview");
			expect(logs[0].content).toBe(
				`http://localhost:4001/v1/videos/logs/${logs[0].id}/content`,
			);
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
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "vertex-test-token",
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
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "vertex-test-token",
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

	test("/v1/videos forwards frame inputs to avalanche", async () => {
		const originalAvalancheFileUploadBaseUrl =
			process.env.LLM_AVALANCHE_FILE_UPLOAD_BASE_URL;
		process.env.LLM_AVALANCHE_FILE_UPLOAD_BASE_URL = mockServerUrl;

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-avalanche-key",
				provider: "avalanche",
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
					model: "avalanche/veo-3.1-generate-preview",
					prompt: "Animate this product shot into a slow reveal",
					size: "1920x1080",
					seconds: 8,
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
			expect(videoJob?.usedProvider).toBe("avalanche");

			const mockVideo = getMockVideo(videoJob!.upstreamId);
			expect(mockVideo?.generationType).toBe("FIRST_AND_LAST_FRAMES_2_VIDEO");
			expect(mockVideo?.imageUrls).toHaveLength(2);
			expect(
				mockVideo?.imageUrls?.every((url) =>
					url.startsWith(`${mockServerUrl}/uploads/avalanche-image-`),
				),
			).toBe(true);
		} finally {
			if (originalAvalancheFileUploadBaseUrl !== undefined) {
				process.env.LLM_AVALANCHE_FILE_UPLOAD_BASE_URL =
					originalAvalancheFileUploadBaseUrl;
			} else {
				delete process.env.LLM_AVALANCHE_FILE_UPLOAD_BASE_URL;
			}
		}
	});

	test("/v1/videos forwards frame inputs to obsidian using -fl models", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-obsidian-key",
			provider: "obsidian",
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
				model: "obsidian/veo-3.1-fast-generate-preview",
				prompt: "Animate this poster frame into a quick reveal",
				size: "1280x720",
				seconds: 8,
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
		expect(videoJob?.usedProvider).toBe("obsidian");
		expect(videoJob?.usedModel).toBe("veo-3.1-landscape-fast-fl");

		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.model).toBe("veo-3.1-landscape-fast-fl");
		expect(mockVideo?.firstFrame).toEqual({
			bytesBase64Encoded: "aGVsbG8=",
			mimeType: "image/png",
		});
		expect(mockVideo?.lastFrame).toEqual({
			bytesBase64Encoded: "d29ybGQ=",
			mimeType: "image/png",
		});
	});

	test("/v1/videos forwards reference images to google-vertex preview", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "vertex-test-token",
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
			expect(videoJob?.usedModel).toBe("veo-3.1-generate-preview");

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

	test("/v1/videos forwards reference images to avalanche fast", async () => {
		const originalAvalancheFileUploadBaseUrl =
			process.env.LLM_AVALANCHE_FILE_UPLOAD_BASE_URL;
		process.env.LLM_AVALANCHE_FILE_UPLOAD_BASE_URL = mockServerUrl;

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "sk-avalanche-key",
				provider: "avalanche",
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
					model: "avalanche/veo-3.1-fast-generate-preview",
					prompt: "Use these materials to create a punchy product clip",
					size: "1920x1080",
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
			expect(videoJob?.usedProvider).toBe("avalanche");
			expect(videoJob?.usedModel).toBe("veo3_fast");

			const mockVideo = getMockVideo(videoJob!.upstreamId);
			expect(mockVideo?.generationType).toBe("REFERENCE_2_VIDEO");
			expect(mockVideo?.imageUrls).toHaveLength(2);
			expect(
				mockVideo?.imageUrls?.every((url) =>
					url.startsWith(`${mockServerUrl}/uploads/avalanche-image-`),
				),
			).toBe(true);
		} finally {
			if (originalAvalancheFileUploadBaseUrl !== undefined) {
				process.env.LLM_AVALANCHE_FILE_UPLOAD_BASE_URL =
					originalAvalancheFileUploadBaseUrl;
			} else {
				delete process.env.LLM_AVALANCHE_FILE_UPLOAD_BASE_URL;
			}
		}
	});

	test("/v1/videos maps a single obsidian fast reference image to image", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-obsidian-key",
			provider: "obsidian",
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
				model: "obsidian/veo-3.1-fast-generate-preview",
				prompt: "Animate this still into a short video",
				size: "1280x720",
				seconds: 8,
				reference_images: [
					{
						image_url: "data:image/png;base64,aGVsbG8=",
					},
				],
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("obsidian");
		expect(videoJob?.usedModel).toBe("veo-3.1-landscape-fast-fl");

		setMockVideoStatus(videoJob!.upstreamId, "completed");
		await processPendingVideoJobs();

		const logs = await db.query.log.findMany({
			where: { requestId: { eq: videoJob!.requestId } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].upstreamRequest).toEqual({
			model: "veo-3.1-landscape-fast-fl",
			prompt: "Animate this still into a short video",
			size: "1280x720",
			input_reference: [
				{
					filename: "input_reference_1.png",
					mimeType: "image/png",
				},
			],
		});

		const mockVideo = getMockVideo(videoJob!.upstreamId);
		expect(mockVideo?.model).toBe("veo-3.1-landscape-fast-fl");
		expect(mockVideo?.firstFrame).toEqual({
			bytesBase64Encoded: "aGVsbG8=",
			mimeType: "image/png",
		});
		expect(mockVideo?.lastFrame).toBeUndefined();
	});

	test("/v1/videos routes root fast single-reference requests to obsidian", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-obsidian-key",
			provider: "obsidian",
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
				model: "veo-3.1-fast-generate-preview",
				prompt: "Animate this still into a short video",
				size: "1280x720",
				seconds: 8,
				reference_images: [
					{
						image_url: "data:image/png;base64,aGVsbG8=",
					},
				],
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob?.usedProvider).toBe("obsidian");
		expect(videoJob?.usedModel).toBe("veo-3.1-landscape-fast-fl");

		setMockVideoStatus(videoJob!.upstreamId, "completed");
		await processPendingVideoJobs();

		const logs = await db.query.log.findMany({
			where: { requestId: { eq: videoJob!.requestId } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].upstreamRequest).toEqual({
			model: "veo-3.1-landscape-fast-fl",
			prompt: "Animate this still into a short video",
			size: "1280x720",
			input_reference: [
				{
					filename: "input_reference_1.png",
					mimeType: "image/png",
				},
			],
		});
	});

	test("/v1/videos rejects multiple obsidian reference images", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-obsidian-key",
			provider: "obsidian",
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
				model: "obsidian/veo-3.1-fast-generate-preview",
				prompt: "Turn these stills into motion",
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

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"obsidian reference-image video generation supports exactly 1 input image",
		);
	});

	test("/v1/videos bills google-vertex fast using audio pricing", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "vertex-test-token",
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

	test("/v1/videos routes silent root veo requests to google-vertex", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values([
				{
					id: "provider-key-vertex",
					token: "vertex-test-token",
					provider: "google-vertex",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
				{
					id: "provider-key-avalanche",
					token: "avalanche-test-token",
					provider: "avalanche",
					organizationId: "org-id",
					baseUrl: mockServerUrl,
				},
			]);

			const createRes = await app.request("/v1/videos", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
				},
				body: JSON.stringify({
					model: "veo-3.1-fast-generate-preview",
					prompt: "A calm fog rolling over a mountain ridge",
					size: "1920x1080",
					seconds: 8,
					audio: false,
				}),
			});

			expect(createRes.status).toBe(200);
			const created = await createRes.json();

			const videoJob = await db.query.videoJob.findFirst({
				where: { id: { eq: created.id } },
			});
			expect(videoJob?.usedProvider).toBe("google-vertex");

			const mockVideo = getMockVideo(videoJob!.upstreamId);
			expect(mockVideo?.generateAudio).toBe(false);
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

	test("/v1/videos rejects silent provider-specific mappings that only support audio", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-avalanche",
			token: "avalanche-test-token",
			provider: "avalanche",
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
				model: "avalanche/veo-3.1-fast-generate-preview",
				prompt: "A bright comet streaking across a moonlit sky",
				size: "1920x1080",
				seconds: 8,
				audio: false,
			}),
		});

		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toMatchObject({
			message: expect.stringContaining(
				"audio=false is unsupported because this provider mapping only supports audio-enabled output",
			),
		});
	});

	test("/v1/videos bills google-vertex fast silent output using silent pricing", async () => {
		const originalGoogleCloudProject = process.env.LLM_GOOGLE_CLOUD_PROJECT;
		const originalGoogleVertexRegion = process.env.LLM_GOOGLE_VERTEX_REGION;
		process.env.LLM_GOOGLE_CLOUD_PROJECT = "test-project";
		process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";

		try {
			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "vertex-test-token",
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
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "vertex-test-token",
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
				token: "real-token",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			await db.insert(tables.providerKey).values({
				id: "provider-key-id",
				token: "vertex-test-token",
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

	test("/v1/videos delivers signed callbacks after completion", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "veo-3.1-fast-generate-preview",
				prompt: "A whale swimming through clouds",
				callback_url: `${mockServerUrl}/mock-callback/video-job`,
				callback_secret: "whsec_test",
				seconds: 8,
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
		await processPendingWebhookDeliveries();

		const logs = await db.query.log.findMany({
			where: { usedModel: { eq: "obsidian/veo-3.1-fast-generate-preview" } },
		});
		expect(logs).toHaveLength(1);
		expect(logs[0].usedModelMapping).toBe("veo-3.1-landscape-fast");
		expect(logs[0].requestCost).toBe(0);
		expect(logs[0].videoOutputCost).toBe(1.2);

		const deliveries = getMockWebhookDeliveries("video-job");
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0].headers["webhook-id"]).toBe(`evt_${created.id}`);
		expect(deliveries[0].headers["webhook-timestamp"]).toBeTruthy();
		expect(deliveries[0].headers["webhook-signature"]).toMatch(/^v1,/);
		expect((deliveries[0].body as { type: string }).type).toBe(
			"video.completed",
		);

		const callbackLogs = await db.query.webhookDeliveryLog.findMany({});
		expect(callbackLogs).toHaveLength(1);
		expect(callbackLogs[0].status).toBe("delivered");
	});

	test("/v1/videos persists callback retries with exponential backoff", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
			organizationId: "org-id",
			baseUrl: mockServerUrl,
		});

		setMockWebhookStatus("retry-video", 500);

		const createRes = await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "veo-3.1-generate-preview",
				prompt: "A spaceship landing on Mars",
				callback_url: `${mockServerUrl}/mock-callback/retry-video`,
				callback_secret: "whsec_retry",
				seconds: 8,
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
		await processPendingWebhookDeliveries();

		const callbackLogs = await db.query.webhookDeliveryLog.findMany({
			orderBy: {
				attempt: "asc",
			},
		});
		expect(callbackLogs).toHaveLength(2);
		expect(callbackLogs[0].status).toBe("retrying");
		expect(callbackLogs[1].status).toBe("pending");
		expect(callbackLogs[1].attempt).toBe(2);
		expect(callbackLogs[1].nextRetryAt.getTime()).toBeGreaterThan(
			callbackLogs[0].createdAt.getTime(),
		);
	});

	test("/v1/videos times out stale jobs and delivers failed callbacks", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "veo-3.1-fast-generate-preview",
				prompt: "A train moving through a snowy forest",
				callback_url: `${mockServerUrl}/mock-callback/video-timeout`,
				callback_secret: "whsec_timeout",
				seconds: 8,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		const staleAgeMs = 2 * 60 * 60 * 1000;
		const staleCreatedAt = new Date(Date.now() - staleAgeMs);
		await db
			.update(tables.videoJob)
			.set({
				createdAt: staleCreatedAt,
				nextPollAt: new Date(),
			})
			.where(eq(tables.videoJob.id, created.id));

		const videoJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(videoJob).toBeTruthy();

		setMockVideoStatus(videoJob!.upstreamId, "in_progress");
		await processPendingVideoJobs();
		await processPendingWebhookDeliveries();

		const updatedJob = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(updatedJob?.status).toBe("failed");
		expect(updatedJob?.error).toMatchObject({
			code: "timeout",
		});

		const deliveries = getMockWebhookDeliveries("video-timeout");
		expect(deliveries).toHaveLength(1);
		expect((deliveries[0].body as { type: string }).type).toBe("video.failed");
		expect(
			(
				deliveries[0].body as {
					data: { status: string; error: { code?: string } | null };
				}
			).data,
		).toMatchObject({
			status: "failed",
			error: {
				code: "timeout",
			},
		});

		const callbackLogs = await db.query.webhookDeliveryLog.findMany({});
		expect(callbackLogs).toHaveLength(1);
		expect(callbackLogs[0].status).toBe("delivered");
	});

	test("/v1/videos backs off polling after repeated status fetch errors", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "veo-3.1-fast-generate-preview",
				prompt: "A surfer riding a massive wave",
				seconds: 8,
			}),
		});

		expect(createRes.status).toBe(200);
		const created = await createRes.json();

		await db
			.update(tables.providerKey)
			.set({
				baseUrl: "http://127.0.0.1:1",
			})
			.where(eq(tables.providerKey.organizationId, "org-id"));

		await db
			.update(tables.videoJob)
			.set({
				nextPollAt: new Date(),
			})
			.where(eq(tables.videoJob.id, created.id));

		await processPendingVideoJobs();

		const firstFailure = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(firstFailure).toBeTruthy();
		expect(firstFailure?.status).toBe("queued");
		expect(firstFailure?.upstreamStatusResponse).toMatchObject({
			llmgateway_poll_error_count: 1,
		});

		const firstDelayMs =
			firstFailure!.nextPollAt.getTime() -
			firstFailure!.lastPolledAt!.getTime();

		await db
			.update(tables.videoJob)
			.set({
				nextPollAt: new Date(),
			})
			.where(eq(tables.videoJob.id, created.id));

		await processPendingVideoJobs();

		const secondFailure = await db.query.videoJob.findFirst({
			where: { id: { eq: created.id } },
		});
		expect(secondFailure).toBeTruthy();
		expect(secondFailure?.upstreamStatusResponse).toMatchObject({
			llmgateway_poll_error_count: 2,
		});

		const secondDelayMs =
			secondFailure!.nextPollAt.getTime() -
			secondFailure!.lastPolledAt!.getTime();
		expect(secondDelayMs).toBeGreaterThan(firstDelayMs);
	});

	test("/v1/videos rejects non-positive duration values", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
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
			token: "real-token",
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
			token: "real-token",
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
			token: "real-token",
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

	test("/v1/videos rejects 4k sizes when only obsidian is available", async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "veo-3.1-generate-preview",
				prompt: "An eagle flying over snowy peaks",
				size: "3840x2160",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("3840x2160");
		expect(JSON.stringify(json)).toContain("obsidian");
	});

	test("/v1/videos does not require $1 in available credits for API key mode", async () => {
		await db
			.update(tables.organization)
			.set({
				credits: "0.50",
			})
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "veo-3.1-generate-preview",
				prompt: "A waterfall in slow motion",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(200);

		const videoJobs = await db.query.videoJob.findMany({});
		expect(videoJobs).toHaveLength(1);
		expect(videoJobs[0]?.usedMode).toBe("api-keys");
	});

	test("/v1/videos requires at least $1 in available credits for credits mode", async () => {
		const originalObsidianApiKey = process.env.LLM_OBSIDIAN_API_KEY;
		const originalObsidianBaseUrl = process.env.LLM_OBSIDIAN_BASE_URL;

		process.env.LLM_OBSIDIAN_API_KEY = "sk-test-env-key";
		process.env.LLM_OBSIDIAN_BASE_URL = mockServerUrl;

		try {
			await db
				.update(tables.organization)
				.set({
					credits: "0.50",
				})
				.where(eq(tables.organization.id, "org-id"));

			await db
				.update(tables.project)
				.set({
					mode: "credits",
				})
				.where(eq(tables.project.id, "project-id"));

			await db.insert(tables.apiKey).values({
				id: "token-id",
				token: "real-token",
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
					prompt: "A waterfall in slow motion",
					seconds: 8,
				}),
			});

			expect(res.status).toBe(402);
			const json = await res.json();
			expect(JSON.stringify(json)).toContain("$1.00");

			const videoJobs = await db.query.videoJob.findMany({});
			expect(videoJobs).toHaveLength(0);
		} finally {
			if (originalObsidianApiKey !== undefined) {
				process.env.LLM_OBSIDIAN_API_KEY = originalObsidianApiKey;
			} else {
				delete process.env.LLM_OBSIDIAN_API_KEY;
			}

			if (originalObsidianBaseUrl !== undefined) {
				process.env.LLM_OBSIDIAN_BASE_URL = originalObsidianBaseUrl;
			} else {
				delete process.env.LLM_OBSIDIAN_BASE_URL;
			}
		}
	});

	test("/v1/videos does not require $1 in available credits for hybrid provider keys", async () => {
		await db
			.update(tables.organization)
			.set({
				credits: "0.50",
			})
			.where(eq(tables.organization.id, "org-id"));

		await db
			.update(tables.project)
			.set({
				mode: "hybrid",
			})
			.where(eq(tables.project.id, "project-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			token: "sk-test-key",
			provider: "obsidian",
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
				model: "veo-3.1-generate-preview",
				prompt: "A waterfall in slow motion",
				seconds: 8,
			}),
		});

		expect(res.status).toBe(200);

		const videoJobs = await db.query.videoJob.findMany({});
		expect(videoJobs).toHaveLength(1);
		expect(videoJobs[0]?.usedMode).toBe("api-keys");
	});
});
