import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

// PAYG overflow for DevPass orgs: once the monthly allowance is exhausted,
// an org that opted in (devPlanPaygEnabled) keeps flowing on its regular
// credits balance; without the opt-in the plan allowance is a hard cap even
// when the org holds credits. The weekly premium fair-use cap follows the
// same logic: with the opt-in and a positive balance, premium requests past
// the cap proceed and bill the balance — mid-cycle included.
describe("dev-plan PAYG overflow", () => {
	const harness = createGatewayApiTestHarness();

	const savedEnv: Record<string, string | undefined> = {};

	beforeAll(() => {
		for (const key of ["LLM_OPENAI_API_KEY", "LLM_OPENAI_BASE_URL"]) {
			savedEnv[key] = process.env[key];
		}
		process.env.LLM_OPENAI_API_KEY = "sk-payg-test";
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
			description: "PAYG test key",
			createdBy: "user-id",
		});
	}

	function chatRequest(token: string, model: string) {
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

	test("monthly allowance exhausted without the opt-in rejects even when the org holds credits", async () => {
		await setupCreditsApiKey("payg-off-token");
		// The seed leaves the org with credits "100.00" — without the opt-in
		// that balance must NOT count toward the gate.
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "100",
			creditsLimit: "100",
		});

		const res = await chatRequest("payg-off-token", "gpt-4o");

		expect(res.status).toBe(402);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("Dev Plan credit limit reached");
		// The hint pointing at the new opt-in must be present.
		expect(body).toContain("enable pay-as-you-go overflow");
		// Gifted/leftover credits are unspendable until the opt-in, so the
		// rejection names the amount instead of reading like an upsell.
		expect(body).toContain("$100.00 in credits waiting");
	});

	test("names no waiting balance when the org holds no credits", async () => {
		await setupCreditsApiKey("payg-off-empty-token");
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "100",
			creditsLimit: "100",
		});
		await harness.setOrganizationCredits("0");

		const res = await chatRequest("payg-off-empty-token", "gpt-4o");

		expect(res.status).toBe(402);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("Or enable pay-as-you-go overflow");
		expect(body).not.toContain("in credits waiting");
	});

	test("monthly allowance exhausted with the opt-in and a positive balance proceeds", async () => {
		await setupCreditsApiKey("payg-on-token");
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "100",
			creditsLimit: "100",
			paygEnabled: true,
		});

		const res = await chatRequest("payg-on-token", "gpt-4o");

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.choices?.[0]?.message).toBeTruthy();
	});

	test("monthly allowance exhausted with the opt-in but an empty balance rejects with the top-up hint", async () => {
		await setupCreditsApiKey("payg-empty-token");
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "100",
			creditsLimit: "100",
			paygEnabled: true,
		});
		await harness.setOrganizationCredits("0");

		const res = await chatRequest("payg-empty-token", "gpt-4o");

		expect(res.status).toBe(402);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("Dev Plan credit limit reached");
		expect(body).toContain("pay-as-you-go balance is empty");
	});

	test("weekly premium cap yields to PAYG overflow mid-cycle when the org holds credits", async () => {
		await setupCreditsApiKey("payg-premium-midcycle-token");
		// Monthly pool has room, weekly premium cap is exhausted, PAYG opted in
		// with a positive balance (the seed leaves credits "100.00"): the excess
		// premium spend bills the balance, so the request proceeds.
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "50",
			creditsLimit: "100",
			premiumCreditsUsed: "999",
			premiumWeekStart: new Date(),
			paygEnabled: true,
		});

		const res = await chatRequest("payg-premium-midcycle-token", "gpt-5.5");

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.choices?.[0]?.message).toBeTruthy();
	});

	test("weekly premium cap still rejects mid-cycle when the PAYG balance is empty", async () => {
		await setupCreditsApiKey("payg-premium-midcycle-empty-token");
		// Opted in but nothing to overflow onto: the cap still bites, and the
		// rejection points at the top-up instead of only the Reset Pass.
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "50",
			creditsLimit: "100",
			premiumCreditsUsed: "999",
			premiumWeekStart: new Date(),
			paygEnabled: true,
		});
		await harness.setOrganizationCredits("0");

		const res = await chatRequest(
			"payg-premium-midcycle-empty-token",
			"gpt-5.5",
		);

		expect(res.status).toBe(402);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("weekly allowance for premium-tier models");
		expect(body).toContain("credits balance is empty");
	});

	test("weekly premium cap still rejects mid-cycle without the opt-in even with credits", async () => {
		await setupCreditsApiKey("payg-premium-midcycle-off-token");
		// No opt-in: the seed's credits balance must not soften the cap.
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "50",
			creditsLimit: "100",
			premiumCreditsUsed: "999",
			premiumWeekStart: new Date(),
		});

		const res = await chatRequest("payg-premium-midcycle-off-token", "gpt-5.5");

		expect(res.status).toBe(402);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("weekly allowance for premium-tier models");
		expect(body).not.toContain("credits balance is empty");
	});

	test("weekly premium cap yields to PAYG once the monthly pool is exhausted", async () => {
		await setupCreditsApiKey("payg-premium-overflow-token");
		// Monthly exhausted + opted in + credits > 0: the premium fair-use cap
		// (a plan-allowance limiter) no longer applies — the request is billed
		// from the org's own credits at provider rates.
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "100",
			creditsLimit: "100",
			premiumCreditsUsed: "999",
			premiumWeekStart: new Date(),
			paygEnabled: true,
		});

		const res = await chatRequest("payg-premium-overflow-token", "gpt-5.5");

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.choices?.[0]?.message).toBeTruthy();
	});

	test("weekly premium cap still rejects when monthly is exhausted without the opt-in", async () => {
		await setupCreditsApiKey("payg-premium-off-token");
		await harness.setDevPlan({
			devPlan: "pro",
			creditsUsed: "100",
			creditsLimit: "100",
			premiumCreditsUsed: "999",
			premiumWeekStart: new Date(),
		});

		const res = await chatRequest("payg-premium-off-token", "gpt-5.5");

		expect(res.status).toBe(402);
		const body = JSON.stringify(await res.json());
		expect(body).toContain("weekly allowance for premium-tier models");
	});
});
