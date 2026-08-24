import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import {
	countEnterpriseSeatsAfterAdding,
	EnterpriseSeatLimitError,
	withEnterpriseSeatForOrganization,
	withEnterpriseSeatsForPromotion,
} from "./enterprise-seats.js";

import type { EnterpriseLicenseStatus } from "@llmgateway/shared/enterprise-license";

function license(
	maxSeats: number,
	kind: "enterprise" | "white_label" = "white_label",
	organizationId: string | null = null,
): EnterpriseLicenseStatus {
	return {
		status: "active",
		enterpriseEnabled: true,
		expiresAt: "2027-01-01T00:00:00.000Z",
		graceEndsAt: "2027-01-08T00:00:00.000Z",
		maxSeats,
		kind,
		organizationId,
		licenseId: "test-license",
		keyId: "test-key",
	};
}

async function addMembership(
	organizationId: string,
	userId: string,
	enterpriseLicense: EnterpriseLicenseStatus,
): Promise<void> {
	await withEnterpriseSeatForOrganization(
		organizationId,
		userId,
		async (tx) => {
			await tx.insert(tables.userOrganization).values({
				organizationId,
				userId,
				role: "developer",
			});
		},
		enterpriseLicense,
	);
}

describe("Enterprise seats", () => {
	it("counts a user only once across organizations", () => {
		expect(
			countEnterpriseSeatsAfterAdding(
				["existing", "shared"],
				["shared", "new", "new"],
			),
		).toBe(3);
	});

	it("does not add a seat for an already licensed user", () => {
		expect(countEnterpriseSeatsAfterAdding(["shared"], ["shared"])).toBe(1);
	});
});

describe("Enterprise seat transactions", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.insert(tables.user).values(
			["user-1", "user-2", "user-3"].map((id) => ({
				id,
				email: `${id}@example.com`,
				name: id,
				emailVerified: true,
			})),
		);
		await db.insert(tables.organization).values([
			{
				id: "enterprise-a",
				name: "Enterprise A",
				billingEmail: "enterprise-a@example.com",
				plan: "enterprise",
			},
			{
				id: "enterprise-b",
				name: "Enterprise B",
				billingEmail: "enterprise-b@example.com",
				plan: "enterprise",
			},
			{
				id: "pro-c",
				name: "Pro C",
				billingEmail: "pro-c@example.com",
				plan: "pro",
			},
		]);
		await db.insert(tables.userOrganization).values({
			organizationId: "enterprise-a",
			userId: "user-1",
			role: "owner",
		});
	});

	afterEach(deleteAll);

	it("serializes concurrent net-new users", async () => {
		const results = await Promise.allSettled([
			addMembership("enterprise-a", "user-2", license(2)),
			addMembership("enterprise-a", "user-3", license(2)),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			results.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		const members = await db.query.userOrganization.findMany({
			where: { organizationId: { eq: "enterprise-a" } },
		});
		expect(members).toHaveLength(2);
	});

	it("allows a duplicate user while blocking net-new seats above a lowered cap", async () => {
		const loweredLicense = license(1);
		await addMembership("enterprise-b", "user-1", loweredLicense);
		await expect(
			addMembership("enterprise-b", "user-2", loweredLicense),
		).rejects.toBeInstanceOf(EnterpriseSeatLimitError);
	});

	it("blocks an Enterprise promotion that would exceed the cap", async () => {
		await db.insert(tables.userOrganization).values({
			organizationId: "pro-c",
			userId: "user-2",
			role: "owner",
		});
		await expect(
			withEnterpriseSeatsForPromotion(
				"pro-c",
				async (tx) => {
					await tx
						.update(tables.organization)
						.set({ plan: "enterprise" })
						.where(eq(tables.organization.id, "pro-c"));
				},
				license(1),
			),
		).rejects.toBeInstanceOf(EnterpriseSeatLimitError);
		const organization = await db.query.organization.findFirst({
			where: { id: { eq: "pro-c" } },
		});
		expect(organization?.plan).toBe("pro");
	});

	it("counts only the organization bound to a standard license", async () => {
		const standardLicense = license(1, "enterprise", "enterprise-b");
		await addMembership("enterprise-b", "user-2", standardLicense);
		await expect(
			addMembership("enterprise-b", "user-3", standardLicense),
		).rejects.toBeInstanceOf(EnterpriseSeatLimitError);
	});
});
