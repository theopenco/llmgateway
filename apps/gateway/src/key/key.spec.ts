import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { db, tables } from "@llmgateway/db";
import {
	DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
	getDevPlanPremiumWeeklyLimit,
} from "@llmgateway/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
	const offsetMs = days * DAY_MS;
	return new Date(Date.now() - offsetMs);
}

describe("/v1/key", () => {
	const harness = createGatewayApiTestHarness();

	async function insertApiKey(
		values: Partial<typeof tables.apiKey.$inferInsert> = {},
	) {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
			...values,
		});
	}

	function getKey(token?: string) {
		return app.request("/v1/key", {
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		});
	}

	test("401 without an API key", async () => {
		const res = await getKey();
		expect(res.status).toBe(401);
	});

	test("401 for an unknown token", async () => {
		const res = await getKey("unknown-token");
		expect(res.status).toBe(401);
	});

	test("401 for an inactive key", async () => {
		await insertApiKey({ status: "inactive" });
		const res = await getKey("real-token");
		expect(res.status).toBe(401);
	});

	test("403 for non-user key types", async () => {
		await insertApiKey({ keyType: "platform_publishable" });
		const res = await getKey("real-token");
		expect(res.status).toBe(403);
	});

	test("401 for platform_secret keys, which the gateway treats as nonexistent", async () => {
		// findApiKeyByToken excludes platform_secret on every gateway route, so
		// the response must not acknowledge that the token exists (401, not 403).
		await insertApiKey({ keyType: "platform_secret" });
		const res = await getKey("real-token");
		expect(res.status).toBe(401);
	});

	test("returns key info with devPlan none for PAYG orgs", async () => {
		await insertApiKey({ usage: "12.5", usageLimit: "50" });

		const res = await getKey("real-token");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data).toEqual({
			label: "Test API Key",
			usage: "12.5",
			limit: "50",
			devPlan: "none",
			devPlanCreditsUsed: "0",
			devPlanCreditsLimit: "0",
			devPlanCreditsRemaining: "0",
			devPlanPremiumWeeklyLimit: "0",
			devPlanPremiumCreditsUsed: "0",
			devPlanPremiumWeekResetsAt: null,
		});
	});

	test("returns plan status for a dev-plan org with an active premium week", async () => {
		await insertApiKey();
		const premiumWeekStart = daysAgo(3);
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "25",
			creditsLimit: "237",
			premiumCreditsUsed: "5",
			premiumWeekStart,
		});

		const res = await getKey("real-token");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.label).toBe("Test API Key");
		expect(data.usage).toBe("0");
		expect(data.limit).toBeNull();
		expect(data.devPlan).toBe("pro");
		expect(data.devPlanCreditsUsed).toBe("25");
		expect(data.devPlanCreditsLimit).toBe("237");
		expect(data.devPlanCreditsRemaining).toBe("212.00");
		expect(data.devPlanPremiumWeeklyLimit).toBe(
			getDevPlanPremiumWeeklyLimit("pro").toFixed(2),
		);
		expect(data.devPlanPremiumCreditsUsed).toBe("5.00");
		expect(data.devPlanPremiumWeekResetsAt).toBe(
			new Date(
				premiumWeekStart.getTime() + DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
			).toISOString(),
		);
	});

	test("reports zero premium usage when the weekly window has expired", async () => {
		await insertApiKey();
		await harness.setDevPlan({
			devPlan: "max",
			creditsUsed: "600",
			creditsLimit: "537",
			premiumCreditsUsed: "12",
			premiumWeekStart: daysAgo(8),
		});

		const res = await getKey("real-token");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.devPlan).toBe("max");
		// Over-limit usage clamps remaining to zero rather than going negative.
		expect(data.devPlanCreditsRemaining).toBe("0.00");
		expect(data.devPlanPremiumCreditsUsed).toBe("0.00");
		expect(data.devPlanPremiumWeekResetsAt).toBeNull();
	});

	test("does not echo the key token", async () => {
		await insertApiKey();
		await harness.setDevPlan({ devPlan: "lite" });

		const res = await getKey("real-token");
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).not.toContain("real-token");
	});
});
