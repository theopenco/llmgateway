import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { db, shortid, tables } from "@llmgateway/db";

import { getUnsettledOrganizationSpend } from "./unsettled-spend.js";

// The worker debits credits minutes-to-seconds after a request completes, so
// the credit gates subtract spend that is logged but not yet processed. These
// tests cover the sum's debit rules and the gate integration on chat.
describe("unsettled organization spend", () => {
	const harness = createGatewayApiTestHarness();

	const savedEnv: Record<string, string | undefined> = {};

	beforeAll(() => {
		for (const key of ["LLM_OPENAI_API_KEY", "LLM_OPENAI_BASE_URL"]) {
			savedEnv[key] = process.env[key];
		}
		process.env.LLM_OPENAI_API_KEY = "sk-unsettled-test";
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

	async function insertLogRow(
		overrides: Partial<typeof tables.log.$inferInsert> = {},
	) {
		await db.insert(tables.log).values({
			requestId: shortid(),
			organizationId: "org-id",
			projectId: "project-id",
			apiKeyId: "token-id",
			duration: 100,
			requestedModel: "gpt-4o",
			usedModel: "gpt-4o",
			usedProvider: "openai",
			responseSize: 0,
			mode: "credits",
			usedMode: "credits",
			...overrides,
		});
	}

	function chatRequest(token: string) {
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				// Pinned to openai so the success path deterministically hits the
				// mock server instead of racing other providers' env keys.
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "Hello!" }],
			}),
		});
	}

	test("sums unprocessed rows with the worker's debit rules", async () => {
		// Counted in full: credits-mode, not cached, not wallet-funded.
		await insertLogRow({ billingCost: "1.25" });
		await insertLogRow({ cost: 2 });
		// billingCost wins over cost when both are set.
		await insertLogRow({ billingCost: "0.75", cost: 100 });
		// Already settled by the worker: excluded entirely.
		await insertLogRow({ billingCost: "50", processedAt: new Date() });
		// Cached, BYOK, and wallet-funded rows only bill their storage cost.
		await insertLogRow({
			billingCost: "10",
			cached: true,
			dataStorageCost: "0.01",
		});
		await insertLogRow({
			billingCost: "10",
			usedMode: "api-keys",
			dataStorageCost: "0.02",
		});
		await insertLogRow({
			billingCost: "10",
			endCustomerWalletId: "wallet-1",
			dataStorageCost: "0.04",
		});
		// Other organizations never count.
		await insertLogRow({ organizationId: "other-org-id", billingCost: "99" });

		const total = await getUnsettledOrganizationSpend("org-id");
		expect(total.toNumber()).toBeCloseTo(4.07, 8);
	});

	test("blocks a credits-mode request when unsettled spend exceeds the balance", async () => {
		await harness.setProjectMode("credits");
		await harness.setOrganizationCredits("1.00");
		await db.insert(tables.apiKey).values({
			id: "token-id-unsettled-block",
			token: "real-token-unsettled-block",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await insertLogRow({ billingCost: "5" });

		const res = await chatRequest("real-token-unsettled-block");

		expect(res.status).toBe(402);
		const json = await res.json();
		expect(json.error.message).toBe(
			"Organization org-id has insufficient credits",
		);
	});

	test("allows the request once the worker has settled the spend", async () => {
		await harness.setProjectMode("credits");
		await harness.setOrganizationCredits("1.00");
		await db.insert(tables.apiKey).values({
			id: "token-id-unsettled-settled",
			token: "real-token-unsettled-settled",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await insertLogRow({ billingCost: "5", processedAt: new Date() });

		const res = await chatRequest("real-token-unsettled-settled");

		expect(res.status).toBe(200);
	});
});
