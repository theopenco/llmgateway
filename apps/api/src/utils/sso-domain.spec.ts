import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import {
	CONSUMER_EMAIL_DOMAINS,
	autoJoinSsoProviderOrganization,
	extractEmailDomain,
	isConfigurableDomain,
	normalizeDomain,
} from "./sso-domain.js";

describe("normalizeDomain", () => {
	it("lowercases, trims, and strips a leading @", () => {
		expect(normalizeDomain("  @Acme.COM ")).toBe("acme.com");
		expect(normalizeDomain("Example.io")).toBe("example.io");
		expect(normalizeDomain("acme.com")).toBe("acme.com");
	});
});

describe("extractEmailDomain", () => {
	it("returns the lowercased domain after the last @", () => {
		expect(extractEmailDomain("Jane.Doe@Acme.com")).toBe("acme.com");
		expect(extractEmailDomain("weird@sub@corp.example.com")).toBe(
			"corp.example.com",
		);
	});

	it("returns null for malformed addresses", () => {
		expect(extractEmailDomain("no-at-sign")).toBeNull();
		expect(extractEmailDomain("@leading.com")).toBeNull();
		expect(extractEmailDomain("trailing@")).toBeNull();
		expect(extractEmailDomain("")).toBeNull();
	});
});

describe("autoJoinSsoProviderOrganization", () => {
	const USER_ID = "sso-jit-join-user";
	const ORG_ID = "sso-jit-join-org";
	const EMAIL = "jane@sso-jit-join.example.com";

	async function cleanup() {
		// Sequential child-first deletes to avoid cascade deadlocks.
		const memberships = await db.query.userOrganization.findMany({
			where: { userId: { eq: USER_ID } },
		});
		for (const membership of memberships) {
			await db
				.delete(tables.userProject)
				.where(eq(tables.userProject.userOrganizationId, membership.id));
		}
		await db
			.delete(tables.userOrganization)
			.where(eq(tables.userOrganization.userId, USER_ID));
		await db
			.delete(tables.project)
			.where(eq(tables.project.organizationId, ORG_ID));
		await db
			.delete(tables.auditLog)
			.where(eq(tables.auditLog.organizationId, ORG_ID));
		await db
			.delete(tables.organization)
			.where(eq(tables.organization.id, ORG_ID));
		await db.delete(tables.user).where(eq(tables.user.id, USER_ID));
	}

	beforeEach(async () => {
		await cleanup();
		await db.insert(tables.user).values({
			id: USER_ID,
			email: EMAIL,
			name: "Jane Doe",
		});
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "SSO Org",
			billingEmail: "owner@sso-jit-join.example.com",
			plan: "enterprise",
		});
		await db.insert(tables.project).values({
			id: `${ORG_ID}-project`,
			name: "Default Project",
			organizationId: ORG_ID,
		});
	});

	afterEach(async () => {
		await cleanup();
	});

	it("joins the provider's organization as developer with default projects", async () => {
		const joined = await autoJoinSsoProviderOrganization({
			userId: USER_ID,
			email: EMAIL,
			name: "Jane Doe",
			organizationId: ORG_ID,
			ssoProviderId: "saml-sso-jit-join",
		});

		expect(joined).toBe(ORG_ID);

		const membership = await db.query.userOrganization.findFirst({
			where: { userId: { eq: USER_ID }, organizationId: { eq: ORG_ID } },
		});
		expect(membership?.role).toBe("developer");

		const projectGrants = await db.query.userProject.findMany({
			where: { userOrganizationId: { eq: membership!.id } },
		});
		expect(projectGrants.map((grant) => grant.projectId)).toEqual([
			`${ORG_ID}-project`,
		]);
	});

	it("is a no-op for existing members", async () => {
		const first = await autoJoinSsoProviderOrganization({
			userId: USER_ID,
			email: EMAIL,
			organizationId: ORG_ID,
			ssoProviderId: "saml-sso-jit-join",
		});
		expect(first).toBe(ORG_ID);

		const second = await autoJoinSsoProviderOrganization({
			userId: USER_ID,
			email: EMAIL,
			organizationId: ORG_ID,
			ssoProviderId: "saml-sso-jit-join",
		});
		expect(second).toBeNull();

		const memberships = await db.query.userOrganization.findMany({
			where: { userId: { eq: USER_ID }, organizationId: { eq: ORG_ID } },
		});
		expect(memberships).toHaveLength(1);
	});

	it("does not join deleted organizations", async () => {
		await db
			.update(tables.organization)
			.set({ status: "deleted" })
			.where(eq(tables.organization.id, ORG_ID));

		const joined = await autoJoinSsoProviderOrganization({
			userId: USER_ID,
			email: EMAIL,
			organizationId: ORG_ID,
			ssoProviderId: "saml-sso-jit-join",
		});

		expect(joined).toBeNull();

		const membership = await db.query.userOrganization.findFirst({
			where: { userId: { eq: USER_ID }, organizationId: { eq: ORG_ID } },
		});
		expect(membership).toBeUndefined();
	});
});

describe("isConfigurableDomain", () => {
	it("accepts well-formed corporate domains", () => {
		expect(isConfigurableDomain("acme.com")).toBe(true);
		expect(isConfigurableDomain("mail.corp.example.io")).toBe(true);
	});

	it("rejects consumer email providers", () => {
		for (const consumer of CONSUMER_EMAIL_DOMAINS) {
			expect(isConfigurableDomain(consumer)).toBe(false);
		}
	});

	it("rejects malformed domains", () => {
		expect(isConfigurableDomain("acme")).toBe(false);
		expect(isConfigurableDomain("acme.")).toBe(false);
		expect(isConfigurableDomain("@acme.com")).toBe(false);
		expect(isConfigurableDomain("")).toBe(false);
	});
});
