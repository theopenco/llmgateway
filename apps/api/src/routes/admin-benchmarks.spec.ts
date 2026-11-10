import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser } from "@/testing.js";
import { resolveBenchmarkRunTargets } from "@/utils/benchmark-targets.js";

import { catalogueMappingDescriptors } from "@llmgateway/benchmarks";
import { db, eq, tables } from "@llmgateway/db";
import { models } from "@llmgateway/models";

const originalAdminEmails = process.env.ADMIN_FULL_ACCESS_EMAILS;
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
	for (const id of extraRunIds) {
		await db.delete(tables.benchmarkRun).where(eq(tables.benchmarkRun.id, id));
	}
	extraRunIds.clear();
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.id, "benchmark-shadow-mapping"));
	if (insertedCatalogueModelId) {
		await db
			.delete(tables.model)
			.where(eq(tables.model.id, insertedCatalogueModelId));
		insertedCatalogueModelId = undefined;
	}
	if (insertedCatalogueProviderId) {
		await db
			.delete(tables.provider)
			.where(eq(tables.provider.id, insertedCatalogueProviderId));
		insertedCatalogueProviderId = undefined;
	}
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
		process.env.ADMIN_FULL_ACCESS_EMAILS = "admin@example.com";
		process.env.BENCHMARK_GATEWAY_API_KEY = "test-token";
		process.env.AIRSIDE_GATEWAY_API_KEY = "test-token";
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
		process.env.ADMIN_FULL_ACCESS_EMAILS = originalAdminEmails;
		if (originalAirsideGatewayKey === undefined) {
			delete process.env.AIRSIDE_GATEWAY_API_KEY;
		} else {
			process.env.AIRSIDE_GATEWAY_API_KEY = originalAirsideGatewayKey;
		}
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

	test("requires the Airside key even when the generic benchmark key is configured", async () => {
		delete process.env.AIRSIDE_GATEWAY_API_KEY;
		const response = await app.request("/admin/benchmarks/runs", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ modelId: MODEL_ID, profile: "smoke" }),
		});
		expect(response.status).toBe(400);
	});

	test("uses the dedicated key for Airside-only runs without the generic key", async () => {
		delete process.env.BENCHMARK_GATEWAY_API_KEY;
		const options = await app.request("/admin/benchmarks/options", {
			headers: { Cookie: cookie },
		});
		expect(
			((await options.json()) as BenchmarkOptions).gatewayKeyConfigured,
		).toBe(true);
		expect((await createRun(cookie, MODEL_ID)).status).toBe(200);
		delete process.env.AIRSIDE_GATEWAY_API_KEY;
		const unconfigured = await app.request("/admin/benchmarks/options", {
			headers: { Cookie: cookie },
		});
		expect(
			((await unconfigured.json()) as BenchmarkOptions).gatewayKeyConfigured,
		).toBe(false);
	});

	test("replaces catalogue sibling regions and gates mixed runs by their sources", async () => {
		const { modelId, providerId, descriptors } = await createCatalogueShadow();
		const targets = await resolveBenchmarkRunTargets(modelId, []);
		const owned = targets.filter(
			(target) => target.metadata?.provider === providerId,
		);
		expect(owned).toHaveLength(1);
		expect(owned[0]).toMatchObject({
			mapping: providerId,
			metadata: {
				source: "airside",
				externalId: "airside-shadow-upstream",
				inputPrice: "0.000003",
				outputPrice: "0.000004",
				region: null,
			},
		});
		const other = descriptors.find((entry) => entry.providerId !== providerId)!;
		const genericMapping = other.region
			? other.providerId + ":" + other.region
			: other.providerId;
		expect(targets).toContainEqual(
			expect.objectContaining({
				mapping: genericMapping,
				metadata: expect.objectContaining({
					source: "catalogue",
					externalId: other.externalId,
					inputPrice: other.inputPrice ?? null,
				}),
			}),
		);
		const options = (await (
			await app.request("/admin/benchmarks/options", {
				headers: { Cookie: cookie },
			})
		).json()) as BenchmarkOptions;
		expect(
			options.models
				.find((model) => model.modelId === modelId)
				?.mappings.filter(
					(mapping) =>
						mapping.mapping === providerId ||
						mapping.mapping.startsWith(providerId + ":"),
				),
		).toEqual([
			expect.objectContaining({ mapping: providerId, source: "airside" }),
		]);
		delete process.env.BENCHMARK_GATEWAY_API_KEY;
		expect((await createRun(cookie, modelId, [providerId])).status).toBe(200);
		const genericMissing = await createRun(cookie, modelId, [genericMapping]);
		expect(genericMissing.status).toBe(400);
		expect((await genericMissing.json()).message).toContain(
			"BENCHMARK_GATEWAY_API_KEY",
		);
		expect((await createRun(cookie, modelId)).status).toBe(400);
		process.env.BENCHMARK_GATEWAY_API_KEY = "test-token";
		delete process.env.AIRSIDE_GATEWAY_API_KEY;
		expect((await createRun(cookie, modelId, [genericMapping])).status).toBe(
			200,
		);
		const airsideMissing = await createRun(cookie, modelId, [providerId]);
		expect(airsideMissing.status).toBe(400);
		expect((await airsideMissing.json()).message).toContain(
			"AIRSIDE_GATEWAY_API_KEY",
		);
		expect((await createRun(cookie, modelId)).status).toBe(400);
		process.env.AIRSIDE_GATEWAY_API_KEY = "test-token";
		expect((await createRun(cookie, modelId)).status).toBe(200);
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
const extraRunIds = new Set<string>();
let insertedCatalogueModelId: string | undefined;
let insertedCatalogueProviderId: string | undefined;
const originalAirsideGatewayKey = process.env.AIRSIDE_GATEWAY_API_KEY;
async function createRun(
	cookie: string,
	modelId: string,
	mappings: string[] = [],
) {
	const response = await app.request("/admin/benchmarks/runs", {
		method: "POST",
		headers: { Cookie: cookie, "Content-Type": "application/json" },
		body: JSON.stringify({ modelId, mappings, profile: "smoke" }),
	});
	if (response.status === 200) {
		extraRunIds.add((await response.clone().json()).id as string);
	}
	return response;
}
async function createCatalogueShadow() {
	for (const model of models) {
		const descriptors = catalogueMappingDescriptors(model.id).filter(
			(entry) => !entry.deactivatedAt || entry.deactivatedAt > new Date(),
		);
		const replaced = descriptors.find(
			(entry) =>
				descriptors.filter((other) => other.providerId === entry.providerId)
					.length > 1 &&
				descriptors.some((other) => other.providerId !== entry.providerId),
		);
		if (!replaced) {
			continue;
		}
		const [insertedModel] = await db
			.insert(tables.model)
			.values({ id: model.id, name: model.name, family: model.family })
			.onConflictDoNothing()
			.returning({ id: tables.model.id });
		insertedCatalogueModelId = insertedModel?.id;
		const [insertedProvider] = await db
			.insert(tables.provider)
			.values({
				id: replaced.providerId,
				name: replaced.providerId,
				description: "Test",
			})
			.onConflictDoNothing()
			.returning({ id: tables.provider.id });
		insertedCatalogueProviderId = insertedProvider?.id;
		await db.insert(tables.modelProviderMapping).values({
			id: "benchmark-shadow-mapping",
			modelId: model.id,
			providerId: replaced.providerId,
			externalId: "airside-shadow-upstream",
			source: "airside",
			inputPrice: "0.000003",
			outputPrice: "0.000004",
		});
		return { modelId: model.id, providerId: replaced.providerId, descriptors };
	}
	throw new Error(
		"Expected a catalogue model with regional and alternate provider mappings",
	);
}
