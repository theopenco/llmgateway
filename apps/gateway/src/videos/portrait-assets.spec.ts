import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { getMockVideo } from "@/test-utils/mock-openai-server.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const IMAGE_DATA_URL = "data:image/png;base64,aGVsbG8=";

describe("videos with portrait assets", () => {
	const harness = createGatewayApiTestHarness();

	async function seedApiKey() {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
	}

	async function seedByokKey(id = "provider-key-bytedance") {
		await db.insert(tables.providerKey).values({
			id,
			...encryptProviderKeyForStorage("sk-bytedance-key", id, "org-id"),
			provider: "bytedance",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	async function seedPortrait(options: {
		groupId?: string;
		assetId?: string;
		organizationId?: string;
		credentialSource?: "platform" | "byok";
		providerKeyId?: string | null;
		groupStatus?: "pending_verification" | "active";
		assetStatus?: "processing" | "active";
		assetType?: "image" | "video" | "audio";
		upstreamAssetId?: string;
	}) {
		const groupId = options.groupId ?? "portrait-group";
		const organizationId = options.organizationId ?? "org-id";
		await db.insert(tables.portraitGroup).values({
			id: groupId,
			organizationId,
			name: "Test person",
			credentialSource: options.credentialSource ?? "byok",
			providerKeyId:
				options.providerKeyId === undefined
					? "provider-key-bytedance"
					: options.providerKeyId,
			status: options.groupStatus ?? "active",
			upstreamGroupId: "group-20260101000000-abcde",
		});
		await db.insert(tables.portraitAsset).values({
			id: options.assetId ?? "portraitasset1",
			organizationId,
			groupId,
			assetType: options.assetType ?? "image",
			upstreamAssetId: options.upstreamAssetId ?? "asset-20260101000000-face1",
			status: options.assetStatus ?? "active",
		});
	}

	async function createVideo(body: Record<string, unknown>) {
		return await app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "seedance-2-0",
				prompt: "The person in Image 1 waves at the camera",
				size: "1280x720",
				seconds: 5,
				...body,
			}),
		});
	}

	async function upstreamContent(videoId: string) {
		const job = await db.query.videoJob.findFirst({
			where: { id: { eq: videoId } },
		});
		const body = getMockVideo(job!.upstreamId)?.requestBody as {
			content: Array<Record<string, unknown>>;
		};
		return { job: job!, content: body.content };
	}

	test("rewrites a BYOK portrait asset to its BytePlus asset on the owning key", async () => {
		await seedApiKey();
		await seedByokKey();
		await seedByokKey("provider-key-bytedance-other");
		await seedPortrait({});

		const res = await createVideo({
			reference_images: ["asset://portraitasset1", IMAGE_DATA_URL],
		});
		expect(res.status).toBe(200);
		const created = await res.json();

		const { job, content } = await upstreamContent(created.id);
		expect(job.providerKeyId).toBe("provider-key-bytedance");
		const images = content.filter((item) => item.role === "reference_image");
		expect(images.map((item) => item.image_url)).toEqual([
			{ url: "asset://asset-20260101000000-face1" },
			{ url: IMAGE_DATA_URL },
		]);
	});

	test("passes raw BytePlus asset ids through on the organization's own key", async () => {
		await seedApiKey();
		await seedByokKey();

		const res = await createVideo({
			reference_images: ["asset://asset-20260101000000-raw01"],
			reference_audios: ["asset://asset-20260101000000-voice"],
		});
		expect(res.status).toBe(200);
		const { content } = await upstreamContent((await res.json()).id);
		expect(content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "reference_image",
					image_url: { url: "asset://asset-20260101000000-raw01" },
				}),
				expect.objectContaining({
					role: "reference_audio",
					audio_url: { url: "asset://asset-20260101000000-voice" },
				}),
			]),
		);
	});

	test("rejects raw BytePlus asset ids in credits mode", async () => {
		await seedApiKey();
		await harness.setProjectMode("credits");

		const res = await createVideo({
			reference_images: ["asset://asset-20260101000000-raw01"],
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("your own BytePlus account");
	});

	test("rejects another organization's portrait asset", async () => {
		await seedApiKey();
		await seedByokKey();
		await db.insert(tables.organization).values({
			id: "other-org",
			name: "Other Organization",
			billingEmail: "other@example.com",
		});
		await seedPortrait({ organizationId: "other-org", providerKeyId: null });

		const res = await createVideo({
			reference_images: ["asset://portraitasset1"],
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("Unknown portrait asset");
		expect(await db.query.videoJob.findMany()).toHaveLength(0);
	});

	test("rejects assets that are still processing or unverified", async () => {
		await seedApiKey();
		await seedByokKey();
		await seedPortrait({ assetStatus: "processing" });

		const processing = await createVideo({
			reference_images: ["asset://portraitasset1"],
		});
		expect(processing.status).toBe(400);
		expect(await processing.text()).toContain("still being processed");

		await seedPortrait({
			groupId: "pending-group",
			assetId: "pendingasset",
			groupStatus: "pending_verification",
			upstreamAssetId: "asset-20260101000000-face2",
		});
		const unverified = await createVideo({
			reference_images: ["asset://pendingasset"],
		});
		expect(unverified.status).toBe(400);
		expect(await unverified.text()).toContain("has not finished verification");
	});

	test("rejects an asset used in the wrong reference field", async () => {
		await seedApiKey();
		await seedByokKey();
		await seedPortrait({ assetType: "audio" });

		const res = await createVideo({
			reference_images: ["asset://portraitasset1"],
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("cannot be used in reference_images");
	});

	test("rejects assets outside reference inputs and on other models", async () => {
		await seedApiKey();
		await seedByokKey();
		await seedPortrait({});

		const firstFrame = await createVideo({
			image: { image_url: "asset://portraitasset1" },
		});
		expect(firstFrame.status).toBe(400);
		expect(await firstFrame.text()).toContain(
			"can only be passed in reference_images",
		);

		const otherModel = await createVideo({
			model: "veo-3.1-generate-preview",
			size: "1920x1080",
			seconds: 8,
			reference_images: ["asset://portraitasset1"],
		});
		expect(otherModel.status).toBe(400);
		expect(await otherModel.text()).toContain(
			"only supported on ByteDance Seedance 2.x",
		);
	});

	test("pins a platform portrait to the managed credential holding it", async () => {
		await seedApiKey();
		await harness.setProjectMode("credits");
		await db.insert(tables.providerKey).values({
			id: "managed-bytedance",
			...encryptProviderKeyForStorage(
				"sk-managed-bytedance",
				"managed-bytedance",
				null,
			),
			provider: "bytedance",
			organizationId: null,
			managed: true,
			config: { baseUrl: harness.mockServerUrl },
		});
		await seedPortrait({
			credentialSource: "platform",
			providerKeyId: "managed-bytedance",
		});

		const res = await createVideo({
			reference_images: ["asset://portraitasset1"],
		});
		expect(res.status).toBe(200);
		const { job, content } = await upstreamContent((await res.json()).id);
		expect(job.managedProviderKeyId).toBe("managed-bytedance");
		expect(content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					image_url: { url: "asset://asset-20260101000000-face1" },
				}),
			]),
		);
	});

	test("rejects a platform portrait in an api-keys project", async () => {
		await seedApiKey();
		await seedByokKey();
		await seedPortrait({ credentialSource: "platform", providerKeyId: null });

		const res = await createVideo({
			reference_images: ["asset://portraitasset1"],
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("verified on LLM Gateway credits");
	});
});
