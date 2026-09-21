import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { orgRequestActivityKey } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
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

async function seedActivity(daysAgo: number) {
	const ageMs = daysAgo * 24 * 60 * 60 * 1000;
	const hour = new Date(Date.now() - ageMs);
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
		blockingCredits: boolean;
		recentActivity: boolean;
		idleDays: number;
		maxCredits: number;
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
		await redisClient.del(orgRequestActivityKey(ORG_ID));
		await deleteAll();
	});

	it("refuses non-owners", async () => {
		await seedOrg({}, "admin");

		const res = await deleteOrg(token);
		expect(res.status).toBe(403);
		expect((await getOrg())?.status).toBe("active");
	});

	it("refuses an organization holding $5 or more in credits", async () => {
		await seedOrg({ credits: "5.00" });

		const res = await deleteOrg(token);
		expect(res.status).toBe(409);
		const json = (await res.json()) as { message: string };
		expect(json.message).toContain("contact support");
		expect((await getOrg())?.status).toBe("active");
		expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
	});

	it("allows an organization holding less than $5 in credits", async () => {
		await seedOrg({ credits: "4.99" });

		const res = await deleteOrg(token);
		expect(res.status).toBe(200);
		expect((await getOrg())?.status).toBe("deleted");
	});

	it("refuses an organization with spend activity in the last 30 days", async () => {
		await seedOrg();
		await seedActivity(29);

		const res = await deleteOrg(token);
		expect(res.status).toBe(409);
		const json = (await res.json()) as { message: string };
		expect(json.message).toContain("30 days");
		expect((await getOrg())?.status).toBe("active");
	});

	it("refuses an organization whose gateway activity marker is still live", async () => {
		await seedOrg();
		await redisClient.set(orgRequestActivityKey(ORG_ID), String(Date.now()));

		const res = await deleteOrg(token);
		expect(res.status).toBe(409);
		expect((await getOrg())?.status).toBe("active");
	});

	it("refuses a personal (devpass) organization", async () => {
		await seedOrg({ kind: "devpass" });

		const res = await deleteOrg(token);
		expect(res.status).toBe(403);
		expect((await eligibility(token)).canDelete).toBe(false);
	});

	it("refuses when credits arrive while the Stripe cancel is in flight", async () => {
		await seedOrg({ plan: "pro", stripeSubscriptionId: "sub_race" });
		stripeMock.subscriptions.cancel.mockImplementation(async () => {
			await db
				.update(tables.organization)
				.set({ credits: "25.00" })
				.where(eq(tables.organization.id, ORG_ID));
			return { status: "canceled" };
		});

		const res = await deleteOrg(token);
		expect(res.status).toBe(409);
		expect((await getOrg())?.status).toBe("active");
	});

	it("deletes an idle organization with no credits and cancels its subscriptions", async () => {
		await seedOrg({
			credits: "-2.50",
			plan: "pro",
			stripeSubscriptionId: "sub_pro",
		});
		await seedActivity(31);

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

	it("hides deletion eligibility from non-owners", async () => {
		await seedOrg({}, "admin");

		const res = await app.request(`/orgs/${ORG_ID}/deletion-eligibility`, {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(403);
	});

	it("reports deletion blockers", async () => {
		await seedOrg({ credits: "10" });
		await seedActivity(1);

		expect(await eligibility(token)).toEqual({
			canDelete: false,
			blockingCredits: true,
			recentActivity: true,
			idleDays: 30,
			maxCredits: 5,
		});

		await db
			.update(tables.organization)
			.set({ credits: "0" })
			.where(eq(tables.organization.id, ORG_ID));
		await db.delete(tables.projectHourlyStats);
		await seedActivity(31);

		expect(await eligibility(token)).toEqual({
			canDelete: true,
			blockingCredits: false,
			recentActivity: false,
			idleDays: 30,
			maxCredits: 5,
		});
	});
});
