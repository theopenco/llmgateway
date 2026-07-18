import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { db, eq, tables } from "@llmgateway/db";
import {
	DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
	getDevPlanPremiumWeeklyLimit,
} from "@llmgateway/shared";

describe("key", () => {
	const harness = createGatewayApiTestHarness();

	async function seedApiKey(token: string, apiKeyId: string) {
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			token,
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
	}

	test("GET /v1/key returns 401 without an API key", async () => {
		const res = await app.request("/v1/key");
		expect(res.status).toBe(401);
	});

	test("GET /v1/key returns 401 for an unknown API key", async () => {
		const res = await app.request("/v1/key", {
			headers: { Authorization: "Bearer unknown-token" },
		});
		expect(res.status).toBe(401);
	});

	test("GET /v1/key returns 401 for an inactive API key", async () => {
		await seedApiKey("inactive-key-token", "inactive-key-id");
		await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(eq(tables.apiKey.id, "inactive-key-id"));

		const res = await app.request("/v1/key", {
			headers: { Authorization: "Bearer inactive-key-token" },
		});
		expect(res.status).toBe(401);
	});

	test("GET /v1/key returns devPlan none for a regular org", async () => {
		await seedApiKey("regular-org-token", "regular-org-key-id");

		const res = await app.request("/v1/key", {
			headers: { Authorization: "Bearer regular-org-token" },
		});
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toEqual({
			devPlan: "none",
			devPlanCreditsUsed: "0",
			devPlanCreditsLimit: "0",
			devPlanCreditsRemaining: "0.00",
			devPlanPremiumWeeklyLimit: "0.00",
			devPlanPremiumCreditsUsed: "0.00",
			devPlanPremiumWeekResetsAt: null,
		});
	});

	test("GET /v1/key returns plan credits and premium usage for a DevPass org", async () => {
		await seedApiKey("devpass-token", "devpass-key-id");
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "42.13",
			creditsLimit: "237",
		});
		const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
		const weekStart = new Date(Date.now() - threeDaysMs);
		await db
			.update(tables.organization)
			.set({
				devPlanPremiumCreditsUsed: "12.5",
				devPlanPremiumWeekStart: weekStart,
			})
			.where(eq(tables.organization.id, "org-id"));

		const res = await app.request("/v1/key", {
			headers: { Authorization: "Bearer devpass-token" },
		});
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.devPlan).toBe("pro");
		expect(json.devPlanCreditsUsed).toBe("42.13");
		expect(json.devPlanCreditsLimit).toBe("237");
		expect(json.devPlanCreditsRemaining).toBe("194.87");
		expect(json.devPlanPremiumWeeklyLimit).toBe(
			getDevPlanPremiumWeeklyLimit("pro").toFixed(2),
		);
		expect(json.devPlanPremiumCreditsUsed).toBe("12.50");
		expect(json.devPlanPremiumWeekResetsAt).toBe(
			new Date(
				weekStart.getTime() + DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
			).toISOString(),
		);

		// The lower-privilege API-key endpoint must never echo billing details
		// or the key itself (session-only fields).
		expect(json).not.toHaveProperty("apiKey");
		expect(json).not.toHaveProperty("regularCredits");
		expect(json).not.toHaveProperty("organizationId");
	});

	test("GET /v1/key reports a fresh premium window when the stored week expired", async () => {
		await seedApiKey("devpass-expired-token", "devpass-expired-key-id");
		await harness.setDevPlan({
			devPlan: "lite",
			creditsUsed: "10",
			creditsLimit: "87",
		});
		await db
			.update(tables.organization)
			.set({
				devPlanPremiumCreditsUsed: "5",
				devPlanPremiumWeekStart: new Date(
					Date.now() - DEV_PLAN_PREMIUM_WEEK_LENGTH_MS - 60_000,
				),
			})
			.where(eq(tables.organization.id, "org-id"));

		const res = await app.request("/v1/key", {
			headers: { Authorization: "Bearer devpass-expired-token" },
		});
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.devPlan).toBe("lite");
		expect(json.devPlanPremiumCreditsUsed).toBe("0.00");
		expect(json.devPlanPremiumWeekResetsAt).toBeNull();
	});

	test("GET /v1/key returns 410 for an archived project", async () => {
		await seedApiKey("archived-project-token", "archived-project-key-id");
		await db
			.update(tables.project)
			.set({ status: "deleted" })
			.where(eq(tables.project.id, "project-id"));

		const res = await app.request("/v1/key", {
			headers: { Authorization: "Bearer archived-project-token" },
		});
		expect(res.status).toBe(410);
	});
});
