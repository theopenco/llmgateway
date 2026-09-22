import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { processPendingVideoJobs } from "worker";

import { app } from "@/app.js";
import {
	releaseVideoSubmission,
	reserveVideoSubmission,
} from "@/lib/video-submission-reservation.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { setMockVideoStatus } from "@/test-utils/mock-openai-server.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { cdb, db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

// Credits-billed video jobs are gated on their estimated cost, minus what the
// org's still-running jobs already reserve, so a burst of submissions cannot
// overshoot the balance before the worker bills them.
describe("video credit estimate gate", () => {
	const harness = createGatewayApiTestHarness();

	// No LLM_* Vertex credential: the managed credential inserted per test is
	// what makes the provider routable in credits mode.
	beforeAll(() => {
		vi.stubEnv("LLM_GOOGLE_VERTEX_BASE_URL", harness.mockServerUrl);
		vi.stubEnv("LLM_GOOGLE_CLOUD_PROJECT", undefined);
		vi.stubEnv("LLM_GOOGLE_VERTEX_API_KEY", undefined);
		vi.stubEnv("GOOGLE_CLOUD_PROJECT", "gate-video-project");
		vi.stubEnv("LLM_GOOGLE_VERTEX_REGION", "us-central1");
	});

	afterAll(() => {
		vi.unstubAllEnvs();
	});

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await harness.setProjectMode("credits");
		await cdb.insert(tables.providerKey).values({
			id: "managed-vertex-gate",
			provider: "google-vertex",
			...encryptProviderKeyForStorage(
				"vertex-test-token",
				"managed-vertex-gate",
				null,
			),
			managed: true,
			organizationId: null,
			config: {
				baseUrl: harness.mockServerUrl,
				project: "gate-video-project",
				region: "us-central1",
			},
		});
	});

	// Veo 3.1 at 1080p with audio: 8s × $0.40 = $3.20.
	const submit = (body: Record<string, unknown> = {}) =>
		app.request("/v1/videos", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				model: "google-vertex/veo-3.1-generate-preview",
				prompt: "A lighthouse at dusk",
				size: "1920x1080",
				seconds: 8,
				...body,
			}),
		});

	test("rejects a job whose estimated cost exceeds the available credits", async () => {
		await harness.setOrganizationCredits("2.00");

		const res = await submit();
		expect(res.status).toBe(402);
		const message = (await res.json()).error.message as string;
		expect(message).toContain("estimated $3.20");
		expect(message).toContain("$2.00 available");
		expect(await db.query.videoJob.findMany()).toHaveLength(0);
	});

	test("keeps the flat minimum balance for cheap jobs", async () => {
		await harness.setOrganizationCredits("0.50");

		const res = await submit({
			model: "google-vertex/veo-3.1-fast-generate-preview",
			size: "1280x720",
			seconds: 4,
		});
		expect(res.status).toBe(402);
		expect((await res.json()).error.message).toContain("minimum $1.00");
	});

	test("counts reservations of in-flight jobs until the worker finalizes them", async () => {
		await harness.setOrganizationCredits("5.00");

		const first = await submit();
		expect(first.status).toBe(200);
		const firstJob = await db.query.videoJob.findFirst({
			where: { id: { eq: (await first.json()).id } },
		});
		expect(firstJob?.usedMode).toBe("credits");

		const second = await submit({ prompt: "The same lighthouse at dawn" });
		expect(second.status).toBe(402);
		const message = (await second.json()).error.message as string;
		expect(message).toContain("$1.80 available");
		expect(message).toContain("$3.20 reserved for videos still in progress");

		// Finalization moves the job onto a log row and releases its
		// reservation; the balance itself is settled by billing separately.
		setMockVideoStatus(firstJob!.upstreamId, "completed");
		await processPendingVideoJobs();

		const third = await submit({ prompt: "The lighthouse at noon" });
		expect(third.status).toBe(200);
	});

	test("counts submissions still between the gate and their job row", async () => {
		await harness.setOrganizationCredits("5.00");
		const inFlightKey = "video:submitting:org-id";
		await redisClient.del(inFlightKey);

		// Another request of this org has passed the gate but not inserted yet.
		await reserveVideoSubmission("org-id", 3.2);
		const blocked = await submit();
		expect(blocked.status).toBe(402);
		expect((await blocked.json()).error.message).toContain(
			"$3.20 reserved for videos still in progress",
		);
		// A rejected submission leaves only the other request's amount behind.
		expect(Number(await redisClient.get(inFlightKey))).toBeCloseTo(3.2);

		await releaseVideoSubmission("org-id", 3.2);
		const accepted = await submit();
		expect(accepted.status).toBe(200);
		// The job row now carries the reservation, so the in-flight amount is
		// released.
		expect(Number((await redisClient.get(inFlightKey)) ?? 0)).toBe(0);
	});
});
