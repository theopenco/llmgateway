import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_ID = "test-org-ratings";
const PROJECT_ID = "test-project-ratings";
const MODEL_ID = "gpt-4o";

async function seedOrgAndProject() {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Test User's Workspace",
		billingEmail: "admin@example.com",
		isPersonal: true,
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: ORG_ID,
		role: "owner",
	});
	await db.insert(tables.project).values({
		id: PROJECT_ID,
		name: "Test Project",
		organizationId: ORG_ID,
	});
}

async function seedModelUsage(requestCount: number, usedModel = MODEL_ID) {
	await db.insert(tables.projectHourlyModelStats).values({
		projectId: PROJECT_ID,
		hourTimestamp: new Date("2026-06-01T00:00:00Z"),
		usedModel,
		usedProvider: "openai",
		requestCount,
	});
}

describe("model-ratings", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await seedOrgAndProject();
	});

	afterEach(async () => {
		await db.delete(tables.modelRating);
		await deleteAll();
	});

	test("GET / reports ineligible with no usage", async () => {
		const res = await app.request(`/model-ratings?modelId=${MODEL_ID}`, {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.rating).toBeNull();
		expect(body.eligibility.canRate).toBe(false);
		expect(body.eligibility.requestCount).toBe(0);
		expect(body.eligibility.minimumRequests).toBe(100);
	});

	test("POST / is rejected below the request threshold", async () => {
		await seedModelUsage(99);

		const res = await app.request("/model-ratings", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ modelId: MODEL_ID, rating: 5 }),
		});
		expect(res.status).toBe(403);

		const rows = await db.query.modelRating.findMany({
			where: { userId: { eq: "test-user-id" } },
		});
		expect(rows).toHaveLength(0);
	});

	test("GET / reports eligible once usage reaches the threshold", async () => {
		await seedModelUsage(100);

		const res = await app.request(`/model-ratings?modelId=${MODEL_ID}`, {
			headers: { Cookie: token },
		});
		const body = await res.json();
		expect(body.eligibility.canRate).toBe(true);
		expect(body.eligibility.requestCount).toBe(100);
	});

	test("POST / succeeds at or above the request threshold", async () => {
		await seedModelUsage(100);

		const res = await app.request("/model-ratings", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({
				modelId: MODEL_ID,
				rating: 4,
				comment: "Solid model.",
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.rating.rating).toBe(4);

		const rows = await db.query.modelRating.findMany({
			where: { userId: { eq: "test-user-id" } },
		});
		expect(rows).toHaveLength(1);
	});

	test("POST / counts usage across the provider/model log format", async () => {
		await seedModelUsage(150, "openai/gpt-4o");

		const res = await app.request("/model-ratings", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ modelId: MODEL_ID, rating: 5 }),
		});
		expect(res.status).toBe(200);
	});

	test("POST / requires authentication", async () => {
		const res = await app.request("/model-ratings", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ modelId: MODEL_ID, rating: 5 }),
		});
		expect(res.status).toBe(401);
	});
});
