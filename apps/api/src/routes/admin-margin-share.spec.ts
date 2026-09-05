import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

const ORG_ID = "margin-share-test-org";

async function patchShare(
	percent: unknown,
	token?: string,
	orgId = ORG_ID,
): Promise<Response> {
	return await app.request(`/admin/organizations/${orgId}/margin-share`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Cookie: token } : {}),
		},
		body: JSON.stringify({ percent }),
	});
}

async function readShare() {
	return await db.query.organizationProviderMarginShare.findFirst({
		where: { organizationId: { eq: ORG_ID } },
	});
}

describe("admin provider margin share", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Margin Share Test",
			billingEmail: "margin-share@test.example",
		});
	});

	afterEach(async () => {
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
		await deleteAll();
	});

	it("rejects unauthenticated and non-admin requests", async () => {
		expect((await patchShare(50)).status).toBe(401);

		process.env.ADMIN_EMAILS = "someone-else@example.com";
		expect((await patchShare(50, cookie)).status).toBe(403);
		expect(await readShare()).toBeUndefined();
	});

	it("returns 404 for an unknown organization", async () => {
		expect((await patchShare(50, cookie, "missing-org")).status).toBe(404);
	});

	it("rejects an out-of-range percent", async () => {
		expect((await patchShare(101, cookie)).status).toBe(400);
		expect((await patchShare(-1, cookie)).status).toBe(400);
		expect(await readShare()).toBeUndefined();
	});

	it("stores the share as a fraction, updates it in place, and audits", async () => {
		const created = await patchShare(50, cookie);
		expect(created.status).toBe(200);
		expect(await created.json()).toMatchObject({ percent: 50 });
		expect((await readShare())?.sharePercent).toBe("0.5");

		const updated = await patchShare(12.5, cookie);
		expect(updated.status).toBe(200);
		const rows = await db.query.organizationProviderMarginShare.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].sharePercent).toBe("0.125");

		const audit = await db.query.auditLog.findFirst({
			where: {
				organizationId: { eq: ORG_ID },
				action: { eq: "provider_margin_share.update" },
			},
		});
		expect(audit).toMatchObject({
			resourceType: "organization",
			resourceId: ORG_ID,
			metadata: { percent: 50 },
		});
	});

	it("exposes the share and accrued total on the admin org read", async () => {
		await db.insert(tables.organizationProviderMarginShare).values({
			organizationId: ORG_ID,
			sharePercent: "0.25",
			totalAccrued: "1.5",
		});

		const res = await app.request(
			`/admin/organizations/${ORG_ID}/transactions`,
			{ headers: { Cookie: cookie } },
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.organization.providerMarginSharePercent).toBe(25);
		expect(body.organization.providerMarginShareAccrued).toBe("1.5");
	});

	it("never surfaces the share on the organization's own endpoints", async () => {
		await db.insert(tables.organizationProviderMarginShare).values({
			organizationId: ORG_ID,
			sharePercent: "0.5",
		});
		const userRow = await db.query.user.findFirst({
			where: { email: { eq: "admin@example.com" } },
		});
		await db.insert(tables.userOrganization).values({
			userId: userRow!.id,
			organizationId: ORG_ID,
			role: "owner",
		});

		const res = await app.request("/orgs", { headers: { Cookie: cookie } });
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).not.toContain("sharePercent");
		expect(text).not.toContain("providerMarginShare");
	});
});
