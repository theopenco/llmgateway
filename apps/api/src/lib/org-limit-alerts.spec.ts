import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notifyOrgLimit } from "@/lib/org-limit-alerts.js";
import { deleteAll } from "@/testing.js";
import { notifyOrgLimitReached } from "@/utils/discord.js";

import { db, tables } from "@llmgateway/db";

import type * as Discord from "@/utils/discord.js";

vi.mock("@/utils/discord.js", async (importOriginal) => ({
	...(await importOriginal<typeof Discord>()),
	notifyOrgLimitReached: vi.fn(),
}));

const ORG_ID = "limit-alert-org";

async function alertsFor(userId: string) {
	return await db.query.notification.findMany({
		where: { userId: { eq: userId }, type: { eq: "org_limit" } },
	});
}

describe("notifyOrgLimit", () => {
	beforeEach(async () => {
		await deleteAll();
		vi.mocked(notifyOrgLimitReached).mockClear();
		await db.insert(tables.user).values([
			{ id: "limit-owner", email: "owner@example.com", emailVerified: true },
			{ id: "limit-admin", email: "admin2@example.com", emailVerified: false },
			{ id: "limit-dev", email: "dev@example.com", emailVerified: true },
		]);
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Limit Org",
			billingEmail: "owner@example.com",
		});
		await db.insert(tables.userOrganization).values([
			{ userId: "limit-owner", organizationId: ORG_ID, role: "owner" },
			{ userId: "limit-admin", organizationId: ORG_ID, role: "admin" },
			{ userId: "limit-dev", organizationId: ORG_ID, role: "developer" },
		]);
	});

	afterEach(deleteAll);

	it("alerts owners and admins once per limit per day, and Discord", async () => {
		const event = {
			limit: "seats",
			source: "scim",
			detail: "Enterprise license: 2/2 seats",
		} as const;
		await notifyOrgLimit(ORG_ID, event);
		await notifyOrgLimit(ORG_ID, event);

		const [owner] = await alertsFor("limit-owner");
		expect(owner).toMatchObject({
			organizationId: ORG_ID,
			inApp: true,
			email: true,
			href: `/dashboard/${ORG_ID}/org/audit-logs`,
		});
		// Unverified addresses get the in-app alert only.
		expect(await alertsFor("limit-admin")).toMatchObject([
			{ inApp: true, email: false },
		]);
		expect(await alertsFor("limit-dev")).toHaveLength(0);
		expect(await alertsFor("limit-owner")).toHaveLength(1);

		expect(notifyOrgLimitReached).toHaveBeenCalledTimes(1);
		expect(notifyOrgLimitReached).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: ORG_ID,
				organizationName: "Limit Org",
				detail: "Enterprise license: 2/2 seats",
			}),
		);
		// Deployment-wide seat counts stay out of the org-facing copy.
		expect(owner?.message).not.toContain("2/2");
	});

	it("keys each limit separately and honors opt-outs", async () => {
		await db.insert(tables.notificationPreference).values({
			userId: "limit-admin",
			type: "org_limit",
			inApp: false,
			email: false,
		});
		await notifyOrgLimit(ORG_ID, {
			limit: "seats",
			source: "invite",
			detail: "Organization seats: 3/3",
		});
		await notifyOrgLimit(ORG_ID, {
			limit: "api_keys",
			projectId: "limit-project",
			maxApiKeys: 5,
		});

		const owner = await alertsFor("limit-owner");
		expect(owner.map((n) => n.href).sort()).toEqual([
			`/dashboard/${ORG_ID}/limit-project/api-keys`,
			`/dashboard/${ORG_ID}/org/team`,
		]);
		expect(await alertsFor("limit-admin")).toHaveLength(0);
		expect(notifyOrgLimitReached).toHaveBeenCalledTimes(2);
	});
});
