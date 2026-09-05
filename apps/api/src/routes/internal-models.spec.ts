import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { internalModels } from "@/routes/internal-models.js";

import { db, eq, tables } from "@llmgateway/db";

const modelId = "removed-provider-test";
const carrierId = "catalogue-test-carrier";
const companyId = "catalogue-test-company";

describe("removed provider catalogue visibility", () => {
	beforeAll(async () => {
		for (const id of ["iceberg", "granite", "glacier", carrierId]) {
			await db
				.insert(tables.provider)
				.values({
					id,
					name: id,
					description: "Test provider",
					status: "active",
				})
				.onConflictDoUpdate({
					target: tables.provider.id,
					set: { status: "active" },
				});
		}
		await db
			.insert(tables.providerCompany)
			.values({ id: companyId, name: "Test carrier company" });
		await db.insert(tables.providerClaim).values({
			providerCompanyId: companyId,
			providerId: carrierId,
			kind: "custom",
			status: "active",
			matchedDomain: "example.com",
		});
		await db.insert(tables.model).values({ id: modelId, family: "test" });
		await db.insert(tables.modelProviderMapping).values(
			["iceberg", "granite", "glacier", carrierId].map((providerId) => ({
				modelId,
				providerId,
				externalId: modelId,
				status: "active" as const,
				source:
					providerId === carrierId
						? ("airside" as const)
						: ("catalogue" as const),
				inputPrice: "1.4e-6",
				logsCount: 42,
			})),
		);
	});

	afterAll(async () => {
		await db.delete(tables.model).where(eq(tables.model.id, modelId));
		await db
			.delete(tables.providerCompany)
			.where(eq(tables.providerCompany.id, companyId));
		await db.delete(tables.provider).where(eq(tables.provider.id, carrierId));
	});

	it("omits removed providers before sync, but preserves registered custom carriers", async () => {
		const response = await internalModels.request("/providers");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { providers: { id: string }[] };
		const ids = body.providers.map((provider) => provider.id);
		expect(ids).not.toContain("iceberg");
		expect(ids).not.toContain("granite");
		expect(ids).toContain("glacier");
		expect(ids).toContain(carrierId);
	});

	it("omits removed mappings without changing stored prices or usage", async () => {
		const response = await internalModels.request("/models");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			models: { id: string; mappings: { providerId: string }[] }[];
		};
		expect(
			body.models
				.find((entry) => entry.id === modelId)
				?.mappings.map((mapping) => mapping.providerId)
				.sort(),
		).toEqual(["glacier", carrierId].sort());
		const retained = await db.query.modelProviderMapping.findMany({
			where: { modelId: { eq: modelId } },
		});
		expect(retained).toHaveLength(4);
		for (const mapping of retained) {
			expect(Number(mapping.inputPrice)).toBe(1.4e-6);
			expect(mapping.logsCount).toBe(42);
			expect(mapping.status).toBe("active");
		}
	});
});
