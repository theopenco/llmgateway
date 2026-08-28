import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { db, tables } from "@llmgateway/db";
import { ONBOARDING_SPONSOR_HEADER } from "@llmgateway/shared";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

// A brand new organization is created with 0 credits, so the onboarding wizard's
// first call would 402 on the very first thing a user does. The API proxy
// asserts eligibility and sends a shared secret; this covers what the gateway
// then does with it — which the unit test for the header comparison cannot see:
// the request must actually get through the credit gate and must actually be
// billed nothing.
describe("sponsored onboarding call", () => {
	const harness = createGatewayApiTestHarness();

	const savedEnv: Record<string, string | undefined> = {};
	const SECRET = "integration-onboarding-secret";

	beforeAll(() => {
		for (const key of [
			"LLM_OPENAI_API_KEY",
			"LLM_OPENAI_BASE_URL",
			"ONBOARDING_SPONSOR_SECRET",
		]) {
			savedEnv[key] = process.env[key];
		}
		process.env.LLM_OPENAI_API_KEY = "sk-onboarding-test";
		process.env.LLM_OPENAI_BASE_URL = harness.mockServerUrl;
		process.env.ONBOARDING_SPONSOR_SECRET = SECRET;
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

	async function setupZeroCreditKey(token: string) {
		await harness.setProjectMode("credits");
		await harness.setOrganizationCredits("0");
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Onboarding test key",
			createdBy: "user-id",
		});
	}

	function chatRequest(token: string, headers: Record<string, string> = {}) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				...headers,
			},
			body: JSON.stringify({
				model: "gpt-4o",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});
	}

	test("a zero-credit org is rejected without the secret", async () => {
		await setupZeroCreditKey("onboarding-unsponsored");

		const res = await chatRequest("onboarding-unsponsored");

		expect(res.status).toBe(402);
		expect(JSON.stringify(await res.json())).toContain("insufficient credits");
	});

	test("the same call succeeds with the secret", async () => {
		await setupZeroCreditKey("onboarding-sponsored");

		const res = await chatRequest("onboarding-sponsored", {
			[ONBOARDING_SPONSOR_HEADER]: SECRET,
		});

		expect(res.status).toBe(200);
	});

	test("a wrong secret is still rejected", async () => {
		await setupZeroCreditKey("onboarding-wrong-secret");

		const res = await chatRequest("onboarding-wrong-secret", {
			[ONBOARDING_SPONSOR_HEADER]: "not-the-secret",
		});

		expect(res.status).toBe(402);
	});

	// The point of zero-rating: the org owns the row (so it shows up in their
	// activity) but is charged nothing for it, including data storage — the
	// worker debits that separately, even when inference was zeroed.
	test("the logged call is billed nothing and belongs to the caller", async () => {
		await setupZeroCreditKey("onboarding-cost");

		const res = await chatRequest("onboarding-cost", {
			[ONBOARDING_SPONSOR_HEADER]: SECRET,
		});
		expect(res.status).toBe(200);

		const json = (await res.json()) as {
			usage: { cost: number; cost_details?: { total_cost: number } };
		};
		expect(json.usage.cost).toBe(0);

		const logs = await waitForLogs(1);
		expect(logs).toHaveLength(1);
		expect(logs[0].organizationId).toBe("org-id");
		expect(logs[0].projectId).toBe("project-id");
		expect(Number(logs[0].cost ?? 0)).toBe(0);
		expect(Number(logs[0].inputCost ?? 0)).toBe(0);
		expect(Number(logs[0].outputCost ?? 0)).toBe(0);
		expect(Number(logs[0].dataStorageCost ?? 0)).toBe(0);
	});
});
