import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";
import { DEV_PLAN_DAY_LENGTH_MS } from "@llmgateway/shared";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

// Daily pacing allowance for DevPass orgs: a rolling 24-hour share of the
// monthly pool, enforced for every model. It follows the same PAYG overflow
// rules as the weekly premium cap — an opted-in org with a positive balance
// keeps flowing and the worker bills the over-pace spend to that balance.
describe("dev-plan daily pacing allowance", () => {
	const harness = createGatewayApiTestHarness();

	const savedEnv: Record<string, string | undefined> = {};

	beforeAll(() => {
		for (const key of ["LLM_OPENAI_API_KEY", "LLM_OPENAI_BASE_URL"]) {
			savedEnv[key] = process.env[key];
		}
		process.env.LLM_OPENAI_API_KEY = "sk-daily-test";
		process.env.LLM_OPENAI_BASE_URL = harness.mockServerUrl;
	});

	afterAll(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value !== undefined) {
				process.env[key] = value;
			} else {
				Reflect.deleteProperty(process.env, key);
			}
		}
	});

	async function setupCreditsApiKey(token: string) {
		await harness.setProjectMode("credits");
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Daily pacing test key",
			createdBy: "user-id",
		});
	}

	function chatRequest(token: string, model = "gpt-4o") {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});
	}

	test("rejects once the daily pacing allowance is spent", async () => {
		await setupCreditsApiKey("daily-cap-token");
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "20",
			creditsLimit: "158",
			dailyCreditsUsed: "999",
			dayStart: new Date(),
		});

		const res = await chatRequest("daily-cap-token");

		expect(res.status).toBe(402);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("daily pacing allowance on the pro plan");
		expect(body).toContain("resets in");
		expect(body).toContain("Enable pay-as-you-go overflow");
	});

	test("admits again once the 24-hour window has rolled over", async () => {
		await setupCreditsApiKey("daily-cap-expired-token");
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "20",
			creditsLimit: "158",
			dailyCreditsUsed: "999",
			dayStart: new Date(Date.now() - DEV_PLAN_DAY_LENGTH_MS - 1000),
		});

		const res = await chatRequest("daily-cap-expired-token");

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.choices?.[0]?.message).toBeTruthy();
	});

	test("applies to premium models as well as standard ones", async () => {
		await setupCreditsApiKey("daily-cap-premium-token");
		await harness.setDevPlan({
			devPlan: "max",
			creditsUsed: "20",
			creditsLimit: "358",
			dailyCreditsUsed: "999",
			dayStart: new Date(),
		});

		const res = await chatRequest("daily-cap-premium-token", "gpt-5.5");

		expect(res.status).toBe(402);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("daily pacing allowance on the max plan");
	});

	test("yields to PAYG overflow when the org holds credits", async () => {
		await setupCreditsApiKey("daily-cap-payg-token");
		// The seed leaves the org with credits "100.00".
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "20",
			creditsLimit: "158",
			dailyCreditsUsed: "999",
			dayStart: new Date(),
			paygEnabled: true,
		});

		const res = await chatRequest("daily-cap-payg-token");

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.choices?.[0]?.message).toBeTruthy();
	});

	test("still rejects with the top-up hint when the PAYG balance is empty", async () => {
		await setupCreditsApiKey("daily-cap-payg-empty-token");
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "20",
			creditsLimit: "158",
			dailyCreditsUsed: "999",
			dayStart: new Date(),
			paygEnabled: true,
		});
		await harness.setOrganizationCredits("0");

		const res = await chatRequest("daily-cap-payg-empty-token");

		expect(res.status).toBe(402);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("daily pacing allowance");
		expect(body).toContain("credits balance is empty");
	});

	test("does not apply to organizations without a dev plan", async () => {
		await setupCreditsApiKey("daily-cap-none-token");
		await harness.setProjectMode("credits");
		await db
			.update(tables.organization)
			.set({ devPlanDailyCreditsUsed: "999", devPlanDayStart: new Date() })
			.where(eq(tables.organization.id, "org-id"));

		const res = await chatRequest("daily-cap-none-token");

		expect(res.status).toBe(200);
	});
});
