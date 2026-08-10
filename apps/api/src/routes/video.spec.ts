import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const SECRET_ENV = "LLM_VIDEO_CONTENT_JWT_SECRET";
const ALLOW_DEV_ENV = "VIDEO_CONTENT_TOKEN_ALLOW_DEV";

async function seedCompletedVideoJob() {
	await db.insert(tables.organization).values({
		id: "org-id",
		name: "Test Organization",
		billingEmail: "user",
	});
	await db.insert(tables.userOrganization).values({
		id: "user-org-id",
		userId: "test-user-id",
		organizationId: "org-id",
	});
	await db.insert(tables.project).values({
		id: "project-id",
		name: "Test Project",
		organizationId: "org-id",
		mode: "credits",
	});
	await db.insert(tables.apiKey).values({
		id: "api-key-id",
		token: "real-token",
		projectId: "project-id",
		description: "Test API Key",
		createdBy: "test-user-id",
	});
	await db.insert(tables.log).values({
		id: "log-id",
		requestId: "request-id",
		organizationId: "org-id",
		projectId: "project-id",
		apiKeyId: "api-key-id",
		duration: 1000,
		requestedModel: "seedance-2-5",
		usedModel: "dreamina-seedance-2-5-260628",
		usedProvider: "bytedance",
		responseSize: 0,
		mode: "credits",
		usedMode: "credits",
	});
	await db.insert(tables.videoJob).values({
		id: "video-id",
		requestId: "request-id",
		logId: "log-id",
		organizationId: "org-id",
		projectId: "project-id",
		apiKeyId: "api-key-id",
		mode: "credits",
		usedMode: "credits",
		model: "seedance-2-5",
		usedProvider: "bytedance",
		usedModel: "dreamina-seedance-2-5-260628",
		upstreamId: "upstream-id",
		prompt: "a paper boat drifting down a rain puddle",
		status: "completed",
		progress: 100,
	});
}

describe("GET /video/{videoId}", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await seedCompletedVideoJob();
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	test("returns a signed playback url for a completed job", async () => {
		vi.stubEnv(SECRET_ENV, "video-content-secret");

		const res = await app.request("/video/video-id", {
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.status).toBe("completed");
		expect(json.content[0].url).toContain("/v1/videos/logs/log-id/content");
		expect(json.content[0].url).toContain("token=");
	});

	// A finished job is already generated and billed. Losing the ability to sign
	// the playback url must not hide the terminal status from pollers, or the
	// client spins on "in progress" forever and never persists the result.
	test("still reports completion when the playback url cannot be signed", async () => {
		vi.stubEnv(SECRET_ENV, undefined);
		vi.stubEnv(ALLOW_DEV_ENV, undefined);

		const res = await app.request("/video/video-id", {
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.status).toBe("completed");
		expect(json.progress).toBe(100);
		expect(json.content).toBeUndefined();
	});
});
