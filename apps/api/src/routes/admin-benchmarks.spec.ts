import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const originalGatewayKey = process.env.BENCHMARK_GATEWAY_API_KEY;

const CARRIER_ID = "airside-benchmark-carrier";
const COMPANY_ID = "airside-benchmark-company";
const CLAIM_ID = "airside-benchmark-claim";
const MODEL_ID = "airside-benchmark-model";
const MAPPING_ID = "airside-benchmark-mapping";

interface BenchmarkOptions {
	models: {
		modelId: string;
		modelName: string;
		source: string;
		mappings: { mapping: string; source: string; deactivated: boolean }[];
	}[];
	profiles: { name: string; description: string }[];
	gatewayKeyConfigured: boolean;
}

interface RunSummary {
	id: string;
	modelId: string;
	profile: string;
	status: string;
	targetCount: number;
	mappings: string[];
}

async function clearFixtures() {
	await db
		.delete(tables.benchmarkRun)
		.where(eq(tables.benchmarkRun.modelId, MODEL_ID));
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.id, MAPPING_ID));
	await db.delete(tables.model).where(eq(tables.model.id, MODEL_ID));
	await db
		.delete(tables.providerClaim)
		.where(eq(tables.providerClaim.id, CLAIM_ID));
	await db
		.delete(tables.providerCompany)
		.where(eq(tables.providerCompany.id, COMPANY_ID));
	await db.delete(tables.provider).where(eq(tables.provider.id, CARRIER_ID));
}

describe("admin benchmarks", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		process.env.BENCHMARK_GATEWAY_API_KEY = "test-token";
		cookie = await createTestUser();
		await clearFixtures();

		await db.insert(tables.provider).values({
			id: CARRIER_ID,
			name: "Airside Benchmark Carrier",
			description: "test",
		});
		await db.insert(tables.providerCompany).values({
			id: COMPANY_ID,
			name: "Airside Benchmark Co",
		});
		await db.insert(tables.providerClaim).values({
			id: CLAIM_ID,
			providerCompanyId: COMPANY_ID,
			providerId: CARRIER_ID,
			kind: "custom",
			matchedDomain: "airside-benchmark.example",
			customName: "Airside Benchmark Carrier",
			customBaseUrl: "https://airside-benchmark.example/v1",
			status: "active",
		});
		await db.insert(tables.model).values({
			id: MODEL_ID,
			name: "Airside Benchmark Model",
			family: "test",
		});
		await db.insert(tables.modelProviderMapping).values({
			id: MAPPING_ID,
			modelId: MODEL_ID,
			providerId: CARRIER_ID,
			externalId: "carrier-upstream-id",
			source: "airside",
			inputPrice: "0.000001",
			outputPrice: "0.000002",
		});
	});

	afterEach(async () => {
		await clearFixtures();
		process.env.ADMIN_EMAILS = originalAdminEmails;
		if (originalGatewayKey === undefined) {
			delete process.env.BENCHMARK_GATEWAY_API_KEY;
		} else {
			process.env.BENCHMARK_GATEWAY_API_KEY = originalGatewayKey;
		}
	});

	test("options include a database-only airside model alongside the catalogue", async () => {
		const response = await app.request("/admin/benchmarks/options", {
			headers: { Cookie: cookie },
		});
		expect(response.status).toBe(200);
		const options = (await response.json()) as BenchmarkOptions;

		const airsideModel = options.models.find(
			(model) => model.modelId === MODEL_ID,
		);
		expect(airsideModel).toMatchObject({
			modelName: "Airside Benchmark Model",
			source: "airside",
		});
		expect(airsideModel?.mappings).toEqual([
			expect.objectContaining({
				mapping: CARRIER_ID,
				source: "airside",
				deactivated: false,
			}),
		]);

		// The static catalogue is still offered next to the DB listings.
		expect(options.models.some((model) => model.source === "catalogue")).toBe(
			true,
		);
		expect(options.profiles.map((profile) => profile.name)).toContain("coding");
		expect(options.gatewayKeyConfigured).toBe(true);
	});

	test("queues a run for an airside model and lists it", async () => {
		const created = await app.request("/admin/benchmarks/runs", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				modelId: MODEL_ID,
				mappings: [],
				profile: "coding",
				budgetMs: 60_000,
				timeoutMs: 30_000,
				seed: 1,
			}),
		});
		expect(created.status).toBe(200);
		const run = (await created.json()) as RunSummary;
		expect(run).toMatchObject({
			modelId: MODEL_ID,
			profile: "coding",
			status: "queued",
			targetCount: 1,
		});

		const list = await app.request("/admin/benchmarks/runs", {
			headers: { Cookie: cookie },
		});
		const { runs } = (await list.json()) as { runs: RunSummary[] };
		expect(runs.some((entry) => entry.id === run.id)).toBe(true);

		const detail = await app.request(`/admin/benchmarks/runs/${run.id}`, {
			headers: { Cookie: cookie },
		});
		expect(detail.status).toBe(200);
		const body = (await detail.json()) as {
			targets: { mapping: string; source: string }[];
			result: unknown;
		};
		expect(body.targets).toEqual([
			expect.objectContaining({ mapping: CARRIER_ID, source: "airside" }),
		]);
		expect(body.result).toBeNull();
	});

	test("rejects a mapping selector that matches nothing", async () => {
		const response = await app.request("/admin/benchmarks/runs", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({
				modelId: MODEL_ID,
				mappings: ["not-a-provider"],
				profile: "smoke",
			}),
		});
		expect(response.status).toBe(400);
	});

	test("rejects an unknown model", async () => {
		const response = await app.request("/admin/benchmarks/runs", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ modelId: "not-a-model", profile: "smoke" }),
		});
		expect(response.status).toBe(400);
	});

	test("refuses to queue when the gateway key is unset", async () => {
		delete process.env.BENCHMARK_GATEWAY_API_KEY;
		const response = await app.request("/admin/benchmarks/runs", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ modelId: MODEL_ID, profile: "smoke" }),
		});
		expect(response.status).toBe(400);
	});

	test("cancels a queued run but not a running one", async () => {
		const created = await app.request("/admin/benchmarks/runs", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ modelId: MODEL_ID, profile: "smoke" }),
		});
		const run = (await created.json()) as RunSummary;

		const canceled = await app.request(
			`/admin/benchmarks/runs/${run.id}/cancel`,
			{ method: "POST", headers: { Cookie: cookie } },
		);
		expect(canceled.status).toBe(200);

		await db
			.update(tables.benchmarkRun)
			.set({ status: "running" })
			.where(eq(tables.benchmarkRun.id, run.id));

		const again = await app.request(`/admin/benchmarks/runs/${run.id}/cancel`, {
			method: "POST",
			headers: { Cookie: cookie },
		});
		expect(again.status).toBe(409);
	});
});
