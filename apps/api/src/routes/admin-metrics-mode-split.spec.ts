import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import {
	aggregateLogsForTesting,
	createTestUser,
	deleteAll,
} from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "mode-split-org";
const PROJECT_ID = "mode-split-project";
const API_KEY_ID = "mode-split-key";
const DEVPASS_ORG_ID = "mode-split-devpass-org";
const DEVPASS_PROJECT_ID = "mode-split-devpass-project";
const DEVPASS_KEY_ID = "mode-split-devpass-key";

function makeLog(o: {
	id: string;
	projectId: string;
	organizationId: string;
	apiKeyId: string;
	usedMode: "credits" | "api-keys";
	cost: number;
	dataStorageCost?: string;
}) {
	const now = new Date();
	return {
		id: o.id,
		requestId: o.id,
		createdAt: now,
		updatedAt: now,
		organizationId: o.organizationId,
		projectId: o.projectId,
		apiKeyId: o.apiKeyId,
		duration: 100,
		requestedModel: "gpt-4",
		requestedProvider: "openai",
		usedModel: "gpt-4",
		usedProvider: "openai",
		responseSize: 100,
		promptTokens: "10",
		completionTokens: "10",
		totalTokens: "20",
		messages: JSON.stringify([{ role: "user", content: "hi" }]),
		mode: "hybrid" as const,
		usedMode: o.usedMode,
		cost: o.cost,
		...(o.dataStorageCost ? { dataStorageCost: o.dataStorageCost } : {}),
	};
}

describe("admin — credits vs BYOK mode split", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: ORG_ID,
				name: "Mode Split Org",
				billingEmail: "mode-split@example.com",
			},
			{
				id: DEVPASS_ORG_ID,
				name: "Mode Split DevPass Org",
				billingEmail: "mode-split-devpass@example.com",
				kind: "devpass",
			},
		]);

		await db.insert(tables.transaction).values([
			// $100 topped up on the PAYG org.
			{
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "105",
				creditAmount: "100",
				status: "completed",
			},
			// A plan transaction so the DevPass org's usage is excluded from the
			// global credit-economy metrics.
			{
				organizationId: DEVPASS_ORG_ID,
				type: "dev_plan_start",
				amount: "20",
				creditAmount: "40",
				status: "completed",
				stripeInvoiceId: "inv_mode_split_dev_1",
			},
		]);

		await db.insert(tables.project).values([
			{
				id: PROJECT_ID,
				name: "Mode Split Project",
				organizationId: ORG_ID,
			},
			{
				id: DEVPASS_PROJECT_ID,
				name: "Mode Split DevPass Project",
				organizationId: DEVPASS_ORG_ID,
			},
		]);

		await db.insert(tables.apiKey).values([
			{
				id: API_KEY_ID,
				token: "mode-split-token",
				projectId: PROJECT_ID,
				description: "Mode Split Key",
				createdBy: "test-user-id",
			},
			{
				id: DEVPASS_KEY_ID,
				token: "mode-split-devpass-token",
				projectId: DEVPASS_PROJECT_ID,
				description: "Mode Split DevPass Key",
				createdBy: "test-user-id",
			},
		]);

		await db.insert(tables.log).values([
			makeLog({
				id: "mode-split-log-credits",
				projectId: PROJECT_ID,
				organizationId: ORG_ID,
				apiKeyId: API_KEY_ID,
				usedMode: "credits",
				cost: 10,
			}),
			makeLog({
				id: "mode-split-log-byok",
				projectId: PROJECT_ID,
				organizationId: ORG_ID,
				apiKeyId: API_KEY_ID,
				usedMode: "api-keys",
				cost: 40,
				dataStorageCost: "0.5",
			}),
			makeLog({
				id: "mode-split-devpass-credits",
				projectId: DEVPASS_PROJECT_ID,
				organizationId: DEVPASS_ORG_ID,
				apiKeyId: DEVPASS_KEY_ID,
				usedMode: "credits",
				cost: 3,
			}),
			makeLog({
				id: "mode-split-devpass-byok",
				projectId: DEVPASS_PROJECT_ID,
				organizationId: DEVPASS_ORG_ID,
				apiKeyId: DEVPASS_KEY_ID,
				usedMode: "api-keys",
				cost: 90,
			}),
		]);

		await aggregateLogsForTesting();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("GET /admin/metrics splits spend and derives unusedCredits from debited spend", async () => {
		const res = await app.request("/admin/metrics", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			totalSpent: number;
			totalCreditsSpent: number;
			totalApiKeysSpent: number;
			unusedCredits: number;
			overage: number;
		};

		// Blended stays blended; DevPass-org usage is excluded from all three.
		expect(body.totalSpent).toBeCloseTo(50, 3);
		expect(body.totalCreditsSpent).toBeCloseTo(10, 3);
		expect(body.totalApiKeysSpent).toBeCloseTo(40, 3);
		// Only debited spend counts against topped-up credits:
		// 100 - (10 credits + 0.5 BYOK storage) = 89.5 — NOT 100 - 50.5.
		expect(body.unusedCredits).toBeCloseTo(89.5, 3);
		expect(body.overage).toBe(0);
	});

	test("GET /admin/organizations returns per-org spend splits", async () => {
		const res = await app.request("/admin/organizations?limit=50", {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			organizations: {
				id: string;
				totalSpent?: string;
				totalCreditsSpent?: string;
				totalApiKeysSpent?: string;
			}[];
		};

		const org = body.organizations.find((o) => o.id === ORG_ID);
		expect(org).toBeDefined();
		expect(parseFloat(org!.totalSpent ?? "0")).toBeCloseTo(50, 3);
		expect(parseFloat(org!.totalCreditsSpent ?? "0")).toBeCloseTo(10, 3);
		expect(parseFloat(org!.totalApiKeysSpent ?? "0")).toBeCloseTo(40, 3);
	});

	test("GET /admin/organizations/{orgId} splits org metrics", async () => {
		const res = await app.request(`/admin/organizations/${ORG_ID}?window=1d`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			totalCost: number;
			creditsCost: number;
			apiKeysCost: number;
			creditsRequestCount: number;
			apiKeysRequestCount: number;
		};

		expect(body.totalCost).toBeCloseTo(50, 3);
		expect(body.creditsCost).toBeCloseTo(10, 3);
		expect(body.apiKeysCost).toBeCloseTo(40, 3);
		expect(body.creditsRequestCount).toBe(1);
		expect(body.apiKeysRequestCount).toBe(1);
	});

	test("GET project metrics splits project totals", async () => {
		const res = await app.request(
			`/admin/organizations/${ORG_ID}/projects/${PROJECT_ID}/metrics?window=1d`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			totalCost: number;
			creditsCost: number;
			apiKeysCost: number;
			creditsRequestCount: number;
			apiKeysRequestCount: number;
		};

		expect(body.totalCost).toBeCloseTo(50, 3);
		expect(body.creditsCost).toBeCloseTo(10, 3);
		expect(body.apiKeysCost).toBeCloseTo(40, 3);
		expect(body.creditsRequestCount).toBe(1);
		expect(body.apiKeysRequestCount).toBe(1);
	});

	test("GET /admin/organizations/{orgId}/cost-by-model splits per-model rows", async () => {
		const res = await app.request(
			`/admin/organizations/${ORG_ID}/cost-by-model?window=1d`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			models: {
				model: string;
				cost: number;
				creditsCost: number;
				apiKeysCost: number;
				creditsRequestCount: number;
				apiKeysRequestCount: number;
			}[];
			totalCost: number;
			totalCreditsRequests: number;
			totalApiKeysRequests: number;
			totalCreditsCost: number;
			totalApiKeysCost: number;
		};

		expect(body.totalCost).toBeCloseTo(50, 3);
		expect(body.totalCreditsRequests).toBe(1);
		expect(body.totalApiKeysRequests).toBe(1);
		expect(body.totalCreditsCost).toBeCloseTo(10, 3);
		expect(body.totalApiKeysCost).toBeCloseTo(40, 3);

		const gpt4 = body.models.find((m) => m.model === "gpt-4");
		expect(gpt4).toBeDefined();
		expect(gpt4!.creditsCost).toBeCloseTo(10, 3);
		expect(gpt4!.apiKeysCost).toBeCloseTo(40, 3);
		expect(gpt4!.creditsRequestCount).toBe(1);
		expect(gpt4!.apiKeysRequestCount).toBe(1);
	});

	test("organization cost charts retain soft-deleted usage", async () => {
		await db
			.update(tables.organization)
			.set({ status: "deleted" })
			.where(eq(tables.organization.id, ORG_ID));

		const breakdownRes = await app.request(
			`/admin/organizations/${ORG_ID}/cost-by-model?window=1d`,
			{ headers: { Cookie: cookie } },
		);
		expect(breakdownRes.status).toBe(200);
		const breakdown = (await breakdownRes.json()) as {
			models: { model: string; cost: number }[];
			totalCost: number;
		};
		expect(breakdown.models).toHaveLength(1);
		expect(breakdown.totalCost).toBeCloseTo(50, 3);

		const timeseriesRes = await app.request(
			`/admin/organizations/${ORG_ID}/cost-by-model-timeseries?window=1d`,
			{ headers: { Cookie: cookie } },
		);
		expect(timeseriesRes.status).toBe(200);
		const timeseries = (await timeseriesRes.json()) as {
			models: string[];
			data: { entries: { cost: number }[] }[];
		};
		expect(timeseries.models).toHaveLength(1);
		expect(
			timeseries.data
				.flatMap((point) => point.entries)
				.reduce((sum, entry) => sum + entry.cost, 0),
		).toBeCloseTo(50, 3);
	});

	test("cost breakdown totals include rows beyond the top 20", async () => {
		const hourTimestamp = new Date();
		hourTimestamp.setUTCMinutes(0, 0, 0);
		await db.insert(tables.projectHourlyModelStats).values(
			Array.from({ length: 20 }, (_, index) => ({
				projectId: PROJECT_ID,
				hourTimestamp,
				usedModel: `extra-model-${index}`,
				usedProvider: "test-provider",
				requestCount: 1,
				totalTokens: "1",
				cost: 1,
				creditsRequestCount: 1,
				creditsCost: 1,
			})),
		);

		const res = await app.request(
			`/admin/organizations/${ORG_ID}/cost-by-model?window=1d`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			models: { creditsRequestCount: number }[];
			totalCreditsRequests: number;
			totalApiKeysRequests: number;
		};

		expect(body.models).toHaveLength(20);
		expect(
			body.models.reduce((sum, model) => sum + model.creditsRequestCount, 0),
		).toBe(20);
		expect(body.totalCreditsRequests).toBe(21);
		expect(body.totalApiKeysRequests).toBe(1);
	});

	test.each([
		["project", "Mode Split Project"],
		["api-key", "Mode Split Key"],
		["user", "admin@example.com"],
	] as const)(
		"GET organization cost breakdown groups by %s",
		async (groupBy, expectedLabel) => {
			const res = await app.request(
				`/admin/organizations/${ORG_ID}/cost-by-model?window=1d&groupBy=${groupBy}`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				models: { model: string; cost: number }[];
			};

			expect(body.models).toHaveLength(1);
			expect(body.models[0]?.model).toContain(expectedLabel);
			expect(body.models[0]?.cost).toBeCloseTo(50, 3);
		},
	);

	test.each([
		["api-key", API_KEY_ID],
		["user", "Deleted user"],
	] as const)(
		"organization %s breakdown retains deleted-key usage",
		async (groupBy, expectedLabel) => {
			await db.delete(tables.apiKey).where(eq(tables.apiKey.id, API_KEY_ID));

			const breakdownRes = await app.request(
				`/admin/organizations/${ORG_ID}/cost-by-model?window=1d&groupBy=${groupBy}`,
				{ headers: { Cookie: cookie } },
			);
			expect(breakdownRes.status).toBe(200);
			const breakdown = (await breakdownRes.json()) as {
				models: { model: string; cost: number }[];
			};
			expect(breakdown.models).toHaveLength(1);
			expect(breakdown.models[0]?.model).toContain(expectedLabel);
			expect(breakdown.models[0]?.cost).toBeCloseTo(50, 3);

			const timeseriesRes = await app.request(
				`/admin/organizations/${ORG_ID}/cost-by-model-timeseries?window=1d&groupBy=${groupBy}`,
				{ headers: { Cookie: cookie } },
			);
			expect(timeseriesRes.status).toBe(200);
			const timeseries = (await timeseriesRes.json()) as {
				models: string[];
				data: { entries: { cost: number }[] }[];
			};
			expect(timeseries.models).toHaveLength(1);
			expect(timeseries.models[0]).toContain(expectedLabel);
			expect(
				timeseries.data
					.flatMap((point) => point.entries)
					.reduce((sum, entry) => sum + entry.cost, 0),
			).toBeCloseTo(50, 3);
		},
	);

	test.each(["project", "api-key", "user"] as const)(
		"GET organization cost timeseries groups by %s",
		async (groupBy) => {
			const res = await app.request(
				`/admin/organizations/${ORG_ID}/cost-by-model-timeseries?window=1d&groupBy=${groupBy}`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				groupBy: string;
				models: string[];
				data: { entries: { cost: number }[] }[];
			};

			expect(body.groupBy).toBe(groupBy);
			expect(body.models).toHaveLength(1);
			expect(
				body.data
					.flatMap((point) => point.entries)
					.reduce((sum, entry) => sum + entry.cost, 0),
			).toBeCloseTo(50, 3);
		},
	);

	test("DevPass real provider cost excludes BYOK usage", async () => {
		const res = await app.request(`/admin/devpass/${DEVPASS_ORG_ID}`, {
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			subscriber: { allTimeCost: number };
		};

		// The $90 BYOK request is paid by the subscriber's own provider key, so
		// it is not a cost LLM Gateway bears.
		expect(body.subscriber.allTimeCost).toBeCloseTo(3, 3);
	});
});
