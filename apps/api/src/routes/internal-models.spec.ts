import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { internalModels } from "@/routes/internal-models.js";

import { db, eq, tables } from "@llmgateway/db";

const modelId = "retirement-catalogue-test";
const carrierId = "retirement-test-carrier";

describe("retired provider catalogue visibility", () => {
	beforeAll(async () => {
		for (const id of ["iceberg", "granite", "glacier", carrierId]) {
			await db
				.insert(tables.provider)
				.values({
					id,
					name: id,
					description: "Catalogue test provider",
					status: "active",
				})
				.onConflictDoUpdate({
					target: tables.provider.id,
					set: { status: "active" },
				});
		}
		await db.insert(tables.model).values({ id: modelId, family: "test" });
		await db.insert(tables.modelProviderMapping).values(
			["iceberg", "granite", "glacier", carrierId].map((providerId) => ({
				modelId,
				providerId,
				externalId: modelId,
				status: "active" as const,
			})),
		);
	});

	afterAll(async () => {
		await db.delete(tables.model).where(eq(tables.model.id, modelId));
		await db.delete(tables.provider).where(eq(tables.provider.id, carrierId));
	});

	it("hides retired providers even before catalogue sync updates their database status", async () => {
		const response = await internalModels.request("/providers");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { providers: { id: string }[] };
		const ids = body.providers.map((provider) => provider.id);
		expect(ids).not.toContain("iceberg");
		expect(ids).not.toContain("granite");
		expect(ids).toContain("glacier");
		expect(ids).toContain(carrierId);
	});

	it("hides retired mappings while retaining database rows and DB-only carriers", async () => {
		const response = await internalModels.request("/models");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			models: { id: string; mappings: { providerId: string }[] }[];
		};
		const model = body.models.find((entry) => entry.id === modelId);
		expect(model?.mappings.map((mapping) => mapping.providerId).sort()).toEqual(
			["glacier", carrierId].sort(),
		);
		const retained = await db.query.modelProviderMapping.findMany({
			where: { modelId: { eq: modelId } },
		});
		expect(retained).toHaveLength(4);
	});
});
