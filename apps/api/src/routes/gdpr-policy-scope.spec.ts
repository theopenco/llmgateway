import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { cdb, db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const orgId = "gdpr-scope-org";
const keyId = "gdpr-scope-key";
const privacy = {
	enabled: true,
	requireGdpr: true,
	blockApiTraining: true,
	blockStealthProviders: true,
	allowedCountries: ["US"],
};
describe("organization privacy versus key policy write guards", () => {
	let cookie: string;
	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			plan: "free",
		});
		await db.insert(tables.userOrganization).values({
			id: "gdpr-scope-member",
			organizationId: orgId,
			userId: "test-user-id",
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: "gdpr-scope-project",
			organizationId: orgId,
			name: "Test Project",
		});
		await db.insert(tables.apiKey).values({
			id: keyId,
			projectId: "gdpr-scope-project",
			createdBy: "test-user-id",
			description: "Test Key",
			...hashApiKeyForStorage("gdpr-scope-token"),
		});
	});
	afterEach(async () => {
		await deleteAll();
		vi.unstubAllEnvs();
	});
	const patch = (path: string, body: unknown) =>
		app.request(path, {
			method: "PATCH",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	test("free organization privacy does not unlock free key policies", async () => {
		vi.stubEnv("API_KEY_COMPLIANCE_ENABLED", "false");
		expect(
			(await patch(`/orgs/${orgId}`, { providerCompliancePolicy: privacy }))
				.status,
		).toBe(200);
		vi.stubEnv("API_KEY_COMPLIANCE_ENABLED", "true");
		expect(
			(await patch(`/keys/api/${keyId}`, { providerCompliancePolicy: privacy }))
				.status,
		).toBe(403);
		vi.stubEnv("API_KEY_COMPLIANCE_ENABLED", "false");
		expect(
			(await patch(`/keys/api/${keyId}`, { providerCompliancePolicy: privacy }))
				.status,
		).toBe(403);
		await cdb
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, orgId));
		expect(
			(await patch(`/keys/api/${keyId}`, { providerCompliancePolicy: privacy }))
				.status,
		).toBe(503);
	});
	test("free organization privacy does not unlock Enterprise ZDR", async () => {
		expect(
			(
				await patch(`/orgs/${orgId}`, {
					providerCompliancePolicy: { enabled: true, zeroDataRetention: true },
				})
			).status,
		).toBe(403);
	});
	test("owner can clear with writes off without blocking unrelated updates", async () => {
		vi.stubEnv("API_KEY_COMPLIANCE_ENABLED", "false");
		expect(
			(await patch(`/keys/api/${keyId}`, { providerCompliancePolicy: null }))
				.status,
		).toBe(200);
		expect(
			(
				await patch(`/keys/api/${keyId}`, {
					description: "Updated test description",
				})
			).status,
		).toBe(200);
	});
	test("a developer cannot write or clear either policy scope", async () => {
		vi.stubEnv("API_KEY_COMPLIANCE_ENABLED", "true");
		await cdb
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, "gdpr-scope-member"));
		await db.insert(tables.userProject).values({
			userOrganizationId: "gdpr-scope-member",
			projectId: "gdpr-scope-project",
		});
		for (const path of [`/orgs/${orgId}`, `/keys/api/${keyId}`]) {
			for (const value of [privacy, null]) {
				expect(
					(await patch(path, { providerCompliancePolicy: value })).status,
				).toBe(403);
			}
		}
	});
});
