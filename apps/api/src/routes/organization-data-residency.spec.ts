import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

const ORG_ID = "data-residency-org";

describe("organization data residency", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Data Residency Org",
			billingEmail: "data-residency@example.com",
			plan: "enterprise",
		});
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-owner`,
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("org compliance policy accepts EU data residency", async () => {
		const res = await app.request(`/orgs/${ORG_ID}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({
				providerCompliancePolicy: { enabled: true, dataResidency: "eu" },
			}),
		});
		expect(res.status).toBe(200);
		const [org] = await db
			.select()
			.from(tables.organization)
			.where(eq(tables.organization.id, ORG_ID));
		expect(org.providerCompliancePolicy?.dataResidency).toBe("eu");
	});
});
