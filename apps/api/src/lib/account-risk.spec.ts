import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import { getAbuseIpCacheKey } from "@/utils/abuse-ip.js";

import { redisClient } from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";

import {
	approveHighRiskUser,
	assertOrganizationNotHighRisk,
	flagUserIfAbusiveIp,
	isUserHighRisk,
} from "./account-risk.js";

const abusiveIp = "5.6.7.8";
const originalApiKey = process.env.ABUSE_IPDB_API_KEY;

function abuseHeaders(ip = abusiveIp): Headers {
	return new Headers({ "x-forwarded-for": ip });
}

function mockAbuseResponse(score: number) {
	return vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(
			JSON.stringify({
				data: {
					ipAddress: abusiveIp,
					abuseConfidenceScore: score,
					totalReports: 9,
					countryCode: "NL",
					usageType: "Data Center/Web Hosting/Transit",
					isp: "Example Hosting",
					isTor: false,
				},
			}),
			{ status: 200 },
		),
	);
}

async function createMember(options: {
	userId: string;
	organizationId: string;
	email: string;
	extraMemberId?: string;
}) {
	await db.insert(tables.user).values({
		id: options.userId,
		name: "Risk User",
		email: options.email,
		emailVerified: true,
	});
	await db.insert(tables.organization).values({
		id: options.organizationId,
		name: "Risk Org",
		billingEmail: options.email,
	});
	await db.insert(tables.userOrganization).values({
		userId: options.userId,
		organizationId: options.organizationId,
		role: "owner",
	});
	if (options.extraMemberId) {
		await db.insert(tables.user).values({
			id: options.extraMemberId,
			name: "Teammate",
			email: `${options.extraMemberId}@example.com`,
			emailVerified: true,
		});
		await db.insert(tables.userOrganization).values({
			userId: options.extraMemberId,
			organizationId: options.organizationId,
			role: "admin",
		});
	}
}

describe("flagUserIfAbusiveIp", () => {
	beforeEach(async () => {
		process.env.ABUSE_IPDB_API_KEY = "test-abuse-key";
		await deleteAll();
		await redisClient.del(getAbuseIpCacheKey(abusiveIp));
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await redisClient.del(getAbuseIpCacheKey(abusiveIp));
		await deleteAll();
		if (originalApiKey === undefined) {
			delete process.env.ABUSE_IPDB_API_KEY;
		} else {
			process.env.ABUSE_IPDB_API_KEY = originalApiKey;
		}
	});

	test("flags the user and their sole-member organization", async () => {
		await createMember({
			userId: "risk-user",
			organizationId: "risk-org",
			email: "risk@example.com",
		});
		mockAbuseResponse(100);

		await flagUserIfAbusiveIp({
			userId: "risk-user",
			source: "signup",
			headers: abuseHeaders(),
		});

		const user = await db.query.user.findFirst({
			where: { id: { eq: "risk-user" } },
		});
		expect(user?.riskStatus).toBe("flagged");
		expect(user?.riskFlagSource).toBe("signup");
		expect(user?.riskFlagIp).toBe(abusiveIp);
		expect(user?.riskFlagDetails?.abuseConfidenceScore).toBe(100);

		const organization = await db.query.organization.findFirst({
			where: { id: { eq: "risk-org" } },
		});
		expect(organization?.riskFlagged).toBe(true);
		expect(await isUserHighRisk("risk-user")).toBe(true);
		await expect(assertOrganizationNotHighRisk("risk-org")).rejects.toThrow();
	});

	test("leaves a shared organization untouched", async () => {
		await createMember({
			userId: "risk-user",
			organizationId: "shared-org",
			email: "risk@example.com",
			extraMemberId: "teammate-user",
		});
		mockAbuseResponse(100);

		await flagUserIfAbusiveIp({
			userId: "risk-user",
			source: "signup",
			headers: abuseHeaders(),
		});

		const user = await db.query.user.findFirst({
			where: { id: { eq: "risk-user" } },
		});
		expect(user?.riskStatus).toBe("flagged");

		const organization = await db.query.organization.findFirst({
			where: { id: { eq: "shared-org" } },
		});
		expect(organization?.riskFlagged).toBe(false);
		await expect(
			assertOrganizationNotHighRisk("shared-org"),
		).resolves.toBeUndefined();
	});

	test("does not flag a score below the threshold", async () => {
		await createMember({
			userId: "risk-user",
			organizationId: "risk-org",
			email: "risk@example.com",
		});
		mockAbuseResponse(10);

		await flagUserIfAbusiveIp({
			userId: "risk-user",
			source: "signup",
			headers: abuseHeaders(),
		});

		const user = await db.query.user.findFirst({
			where: { id: { eq: "risk-user" } },
		});
		expect(user?.riskStatus).toBe("none");
	});

	test("never re-flags an approved account", async () => {
		await createMember({
			userId: "risk-user",
			organizationId: "risk-org",
			email: "risk@example.com",
		});
		mockAbuseResponse(100);
		await approveHighRiskUser({
			userId: "risk-user",
			reviewerId: "reviewer-id",
		});

		await flagUserIfAbusiveIp({
			userId: "risk-user",
			source: "email_verification",
			headers: abuseHeaders(),
		});

		const user = await db.query.user.findFirst({
			where: { id: { eq: "risk-user" } },
		});
		expect(user?.riskStatus).toBe("approved");
		const organization = await db.query.organization.findFirst({
			where: { id: { eq: "risk-org" } },
		});
		expect(organization?.riskFlagged).toBe(false);
	});

	test("fails open when the lookup errors", async () => {
		await createMember({
			userId: "risk-user",
			organizationId: "risk-org",
			email: "risk@example.com",
		});
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));

		await flagUserIfAbusiveIp({
			userId: "risk-user",
			source: "signup",
			headers: abuseHeaders(),
		});

		const user = await db.query.user.findFirst({
			where: { id: { eq: "risk-user" } },
		});
		expect(user?.riskStatus).toBe("none");
	});
});

describe("admin flagged accounts routes", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await db.insert(tables.user).values({
			id: "flagged-user",
			name: "Flagged User",
			email: "flagged@example.com",
			emailVerified: true,
			riskStatus: "flagged",
			riskFlaggedAt: new Date(),
			riskFlagSource: "signup",
			riskFlagIp: abusiveIp,
			riskFlagDetails: {
				ipAddress: abusiveIp,
				abuseConfidenceScore: 100,
				totalReports: 9,
				countryCode: "NL",
			},
		});
		await db.insert(tables.organization).values({
			id: "flagged-org",
			name: "Flagged Org",
			billingEmail: "flagged@example.com",
			riskFlagged: true,
		});
		await db.insert(tables.userOrganization).values({
			userId: "flagged-user",
			organizationId: "flagged-org",
			role: "owner",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("requires authentication", async () => {
		const res = await app.request("/admin/flagged-accounts");
		expect(res.status).toBe(401);
	});

	test("lists flagged accounts with their organizations", async () => {
		const res = await app.request("/admin/flagged-accounts", {
			headers: { Cookie: cookie },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.flaggedCount).toBe(1);
		expect(body.approvedCount).toBe(0);
		expect(body.archivedCount).toBe(0);
		expect(body.accounts).toHaveLength(1);
		expect(body.accounts[0]).toMatchObject({
			userId: "flagged-user",
			email: "flagged@example.com",
			riskStatus: "flagged",
			source: "signup",
			ipAddress: abusiveIp,
			abuseConfidenceScore: 100,
			countryCode: "NL",
		});
		expect(body.accounts[0].organizations).toEqual([
			expect.objectContaining({ id: "flagged-org", riskFlagged: true }),
		]);
	});

	test("archives accounts without changing their risk status", async () => {
		const archive = await app.request(
			"/admin/flagged-accounts/flagged-user/archive",
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ archived: true }),
			},
		);

		expect(archive.status).toBe(200);

		const user = await db.query.user.findFirst({
			where: { id: { eq: "flagged-user" } },
		});
		expect(user?.riskStatus).toBe("flagged");
		expect(user?.riskArchivedAt).not.toBe(null);

		const active = await app.request("/admin/flagged-accounts", {
			headers: { Cookie: cookie },
		});
		const activeBody = await active.json();
		expect(activeBody.accounts).toEqual([]);
		expect(activeBody.flaggedCount).toBe(0);
		expect(activeBody.archivedCount).toBe(1);

		const archived = await app.request(
			"/admin/flagged-accounts?archived=true&status=all",
			{ headers: { Cookie: cookie } },
		);
		const archivedBody = await archived.json();
		expect(archivedBody.accounts).toHaveLength(1);
		expect(archivedBody.accounts[0]).toMatchObject({
			userId: "flagged-user",
			riskStatus: "flagged",
		});
		expect(archivedBody.accounts[0].archivedAt).not.toBe(null);
	});

	test("restores archived accounts to the active queue", async () => {
		await db
			.update(tables.user)
			.set({ riskArchivedAt: new Date() })
			.where(eq(tables.user.id, "flagged-user"));

		const res = await app.request(
			"/admin/flagged-accounts/flagged-user/archive",
			{
				method: "PATCH",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({ archived: false }),
			},
		);

		expect(res.status).toBe(200);
		const user = await db.query.user.findFirst({
			where: { id: { eq: "flagged-user" } },
		});
		expect(user?.riskArchivedAt).toBe(null);
	});

	test("filters by search term", async () => {
		const res = await app.request(
			"/admin/flagged-accounts?search=nomatch@example.com",
			{ headers: { Cookie: cookie } },
		);

		expect(res.status).toBe(200);
		expect((await res.json()).accounts).toEqual([]);
	});

	test("activating unblocks the account and its organizations", async () => {
		const res = await app.request(
			"/admin/flagged-accounts/flagged-user/approve",
			{ method: "POST", headers: { Cookie: cookie } },
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			organizationIds: ["flagged-org"],
		});

		const user = await db.query.user.findFirst({
			where: { id: { eq: "flagged-user" } },
		});
		expect(user?.riskStatus).toBe("approved");
		expect(user?.riskReviewedBy).toBe("test-user-id");
		expect(user?.riskReviewedAt).not.toBe(null);

		const organization = await db.query.organization.findFirst({
			where: { id: { eq: "flagged-org" } },
		});
		expect(organization?.riskFlagged).toBe(false);

		const listed = await app.request("/admin/flagged-accounts", {
			headers: { Cookie: cookie },
		});
		expect((await listed.json()).accounts).toEqual([]);
	});

	test("returns 404 for an unknown user", async () => {
		const res = await app.request("/admin/flagged-accounts/nope/approve", {
			method: "POST",
			headers: { Cookie: cookie },
		});
		expect(res.status).toBe(404);
	});
});
