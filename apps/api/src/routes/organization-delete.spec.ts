import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as PaymentsModule from "@/routes/payments.js";

const stripeMock = vi.hoisted(() => ({
	subscriptions: { cancel: vi.fn() },
}));

vi.mock("@/routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

const ORG_ID = "delete-org";
const PROJECT_ID = "delete-org-project";

async function seedOrg(
	overrides: Partial<typeof tables.organization.$inferInsert> = {},
	role: "owner" | "admin" | "developer" = "owner",
) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Deletable Org",
		billingEmail: "delete@example.com",
		credits: "0",
		...overrides,
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: ORG_ID,
		role,
	});
	await db.insert(tables.project).values({
		id: PROJECT_ID,
		name: "Project",
		organizationId: ORG_ID,
	});
}

async function seedRequests(hoursAgo: number) {
	const hour = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
	hour.setUTCMinutes(0, 0, 0);
	await db.insert(tables.projectHourlyStats).values({
		projectId: PROJECT_ID,
		hourTimestamp: hour,
		requestCount: 5,
	});
}

async function deleteOrg(token: string) {
	return await app.request(`/orgs/${ORG_ID}`, {
		method: "DELETE",
		headers: { Cookie: token },
	});
}

async function eligibility(token: string) {
	const res = await app.request(`/orgs/${ORG_ID}/deletion-eligibility`, {
		headers: { Cookie: token },
	});
	expect(res.status).toBe(200);
	return (await res.json()) as {
		canDelete: boolean;
		positiveCredits: boolean;
		recentRequests: boolean;
		idleHours: number;
	};
}

async function getOrg() {
	return await db.query.organization.findFirst({
		where: { id: { eq: ORG_ID } },
	});
}

describe("DELETE /orgs/{id}", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		stripeMock.subscriptions.cancel.mockReset();
		stripeMock.subscriptions.cancel.mockResolvedValue({ status: "canceled" });
	});

	afterEach(async () => {
		await deleteAll();
	});

	it("refuses non-owners", async () => {
		await seedOrg({}, "admin");

		const res = await deleteOrg(token);
		expect(res.status).toBe(403);
		expect((await getOrg())?.status).toBe("active");
	});

	it("refuses an organization with a positive credit balance", async () => {
		await seedOrg({ credits: "0.01" });

		const res = await deleteOrg(token);
		expect(res.status).toBe(409);
		const json = (await res.json()) as { message: string };
		expect(json.message).toContain("contact support");
		expect((await getOrg())?.status).toBe("active");
		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
	});

	it("refuses an organization that served requests in the last 72 hours", async () => {
		await seedOrg();
		await seedRequests(71);

		const res = await deleteOrg(token);
		expect(res.status).toBe(409);
		const json = (await res.json()) as { message: string };
		expect(json.message).toContain("72 hours");
		expect((await getOrg())?.status).toBe("active");
	});

	it("deletes an idle organization with no credits and cancels its subscriptions", async () => {
		await seedOrg({
			credits: "-2.50",
			plan: "pro",
			stripeSubscriptionId: "sub_pro",
		});
		await seedRequests(80);

		const res = await deleteOrg(token);
		expect(res.status).toBe(200);

		const org = await getOrg();
		expect(org?.status).toBe("deleted");
		expect(org?.plan).toBe("free");
		expect(org?.stripeSubscriptionId).toBeNull();
		expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
			"sub_pro",
			expect.objectContaining({ invoice_now: false, prorate: false }),
		);

		const listed = await app.request("/orgs", { headers: { Cookie: token } });
		const { organizations } = (await listed.json()) as {
			organizations: { id: string }[];
		};
		expect(organizations.find((o) => o.id === ORG_ID)).toBeUndefined();
	});

	it("reports deletion blockers", async () => {
		await seedOrg({ credits: "5" });
		await seedRequests(1);

		expect(await eligibility(token)).toEqual({
			canDelete: false,
			positiveCredits: true,
			recentRequests: true,
			idleHours: 72,
		});

		await db
			.update(tables.organization)
			.set({ credits: "0" })
			.where(eq(tables.organization.id, ORG_ID));
		await db.delete(tables.projectHourlyStats);
		await seedRequests(73);

		expect(await eligibility(token)).toEqual({
			canDelete: true,
			positiveCredits: false,
			recentRequests: false,
			idleHours: 72,
		});
	});
});
