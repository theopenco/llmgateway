import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;

const ORG_ID = "org-details-test";

const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

async function get(path: string, token?: string): Promise<Response> {
	return await app.request(`/admin/organizations/${ORG_ID}${path}`, {
		headers: token ? { Cookie: token } : {},
	});
}

async function insertOrg() {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Org Details Test",
		billingEmail: "org-details@test.example",
		plan: "enterprise",
		retentionLevel: "retain",
		ssoAutoJoinDomain: "org-details.example",
		providerCompliancePolicy: {
			enabled: true,
			requireSoc2: true,
			blockedProviders: ["openai"],
			allowedModels: ["gpt-5.2"],
		},
	});
}

describe("admin organization details endpoints", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await insertOrg();
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
		for (const path of ["/audit-logs", "/settings", "/guardrails", "/sso"]) {
			expect((await get(path)).status).toBe(401);
		}

		process.env.ADMIN_EMAILS = "someone-else@example.com";
		for (const path of ["/audit-logs", "/settings", "/guardrails", "/sso"]) {
			expect((await get(path, cookie)).status).toBe(403);
		}
	});

	it("returns 404 for an unknown organization", async () => {
		for (const path of ["/audit-logs", "/settings", "/guardrails", "/sso"]) {
			const res = await app.request(
				`/admin/organizations/does-not-exist${path}`,
				{ headers: { Cookie: cookie } },
			);
			expect(res.status).toBe(404);
		}
	});

	it("returns paginated audit logs with filters", async () => {
		await db.insert(tables.auditLog).values([
			{
				id: "audit-1",
				organizationId: ORG_ID,
				userId: "test-user-id",
				action: "api_key.create",
				resourceType: "api_key",
				resourceId: "key-1",
				metadata: { resourceName: "Test Key" },
			},
			{
				id: "audit-2",
				organizationId: ORG_ID,
				userId: "test-user-id",
				action: "organization.update",
				resourceType: "organization",
				resourceId: ORG_ID,
			},
		]);

		const res = await get("/audit-logs", cookie);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.total).toBe(2);
		expect(json.auditLogs).toHaveLength(2);
		expect(json.auditLogs[0].user.email).toBe("admin@example.com");
		expect(json.filters.actions.length).toBeGreaterThan(0);

		const filtered = await get("/audit-logs?action=api_key.create", cookie);
		const filteredJson = await filtered.json();
		expect(filteredJson.total).toBe(1);
		expect(filteredJson.auditLogs[0].id).toBe("audit-1");

		// Unknown filter values are ignored rather than failing the request.
		const bogus = await get("/audit-logs?action=not.a.real.action", cookie);
		expect((await bogus.json()).total).toBe(2);

		const paged = await get("/audit-logs?limit=1&offset=1", cookie);
		const pagedJson = await paged.json();
		expect(pagedJson.total).toBe(2);
		expect(pagedJson.auditLogs).toHaveLength(1);
	});

	it("returns organization settings with the compliance policy and custom providers", async () => {
		await db.insert(tables.providerKey).values([
			{
				id: "custom-key-1",
				organizationId: ORG_ID,
				provider: "custom",
				name: "myllm",
				token: "sk-custom",
				complianceAttestation: { soc2: 2, gdpr: true, headquarters: "US" },
			},
			{
				id: "custom-key-deleted",
				organizationId: ORG_ID,
				provider: "custom",
				name: "gone",
				token: "sk-gone",
				status: "deleted",
			},
			{
				id: "regular-key",
				organizationId: ORG_ID,
				provider: "openai",
				token: "sk-openai",
			},
		]);

		const res = await get("/settings", cookie);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.organization.plan).toBe("enterprise");
		expect(json.organization.retentionLevel).toBe("retain");
		expect(json.organization.ssoAutoJoinDomain).toBe("org-details.example");
		expect(json.organization.providerCompliancePolicy.enabled).toBe(true);
		expect(json.organization.providerCompliancePolicy.blockedProviders).toEqual(
			["openai"],
		);
		expect(json.customProviders).toHaveLength(1);
		expect(json.customProviders[0].name).toBe("myllm");
		expect(json.customProviders[0].complianceAttestation.soc2).toBe(2);
	});

	it("returns guardrail config, rules and violation counts", async () => {
		await db.insert(tables.guardrailConfig).values({
			id: "gc-1",
			organizationId: ORG_ID,
			enabled: true,
			maxFileSizeMb: 25,
		});
		await db.insert(tables.guardrailRule).values({
			id: "gr-1",
			organizationId: ORG_ID,
			name: "No secrets",
			type: "blocked_terms",
			config: {
				type: "blocked_terms",
				terms: ["password"],
				matchType: "contains",
				caseSensitive: false,
			},
			priority: 10,
			action: "block",
		});
		await db.insert(tables.guardrailViolation).values([
			{
				id: "gv-recent",
				organizationId: ORG_ID,
				ruleId: "gr-1",
				ruleName: "No secrets",
				category: "custom",
				actionTaken: "blocked",
			},
			{
				id: "gv-old",
				organizationId: ORG_ID,
				ruleId: "gr-1",
				ruleName: "No secrets",
				category: "custom",
				actionTaken: "warned",
				createdAt: new Date(Date.now() - sixtyDaysMs),
			},
		]);

		// A project override must not leak into the org-level config or rules.
		await db.insert(tables.project).values({
			id: "guardrail-project",
			organizationId: ORG_ID,
			name: "Guardrail Project",
		});
		await db.insert(tables.guardrailConfig).values({
			id: "gc-project",
			organizationId: ORG_ID,
			projectId: "guardrail-project",
			inheritOrganization: false,
			enabled: true,
			maxFileSizeMb: 1,
		});
		await db.insert(tables.guardrailRule).values({
			id: "gr-project",
			organizationId: ORG_ID,
			projectId: "guardrail-project",
			name: "Project only",
			type: "custom_regex",
			config: { type: "custom_regex", pattern: "\\bACC-\\d{9}\\b" },
			priority: 20,
			action: "redact",
		});

		const res = await get("/guardrails", cookie);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.config.enabled).toBe(true);
		expect(json.config.maxFileSizeMb).toBe(25);
		expect(json.config.systemRules.prompt_injection.enabled).toBe(true);
		expect(json.rules).toHaveLength(1);
		expect(json.rules[0].config.terms).toEqual(["password"]);
		expect(json.violations.total).toBe(2);
		expect(json.violations.last30Days).toBe(1);
		expect(json.violations.recent).toHaveLength(2);
	});

	it("returns SSO connections, SCIM state and mappings without raw configs", async () => {
		await db.insert(tables.project).values({
			id: "sso-project",
			organizationId: ORG_ID,
			name: "SSO Project",
		});
		await db.insert(tables.ssoProvider).values({
			id: "sso-1",
			issuer: "https://idp.example.com",
			domain: "org-details.example",
			providerId: "org-details-sso",
			providerType: "okta",
			samlConfig: JSON.stringify({ secret: "should-not-leak" }),
			organizationId: ORG_ID,
			enforced: true,
			domainVerified: true,
		});
		await db.insert(tables.scimToken).values([
			{
				id: "scim-1",
				tokenHash: "hash-1",
				maskedToken: "scim_****abcd",
				organizationId: ORG_ID,
				ssoProviderId: "org-details-sso",
			},
			{
				id: "scim-deleted",
				tokenHash: "hash-2",
				maskedToken: "scim_****dead",
				organizationId: ORG_ID,
				status: "deleted",
			},
		]);
		await db.insert(tables.ssoRoleMapping).values({
			id: "map-1",
			organizationId: ORG_ID,
			groupName: "Engineering",
			role: "admin",
		});
		await db.insert(tables.ssoDefaultProject).values({
			id: "sdp-1",
			organizationId: ORG_ID,
			projectId: "sso-project",
		});
		await db.insert(tables.scimGroup).values({
			id: "group-1",
			organizationId: ORG_ID,
			displayName: "Engineering",
			externalId: "ext-1",
		});
		await db.insert(tables.scimGroupMember).values({
			id: "member-1",
			scimGroupId: "group-1",
			userId: "test-user-id",
		});

		const res = await get("/sso", cookie);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.ssoAutoJoinDomain).toBe("org-details.example");
		expect(json.connections).toHaveLength(1);
		expect(json.connections[0].protocol).toBe("saml");
		expect(json.connections[0].enforced).toBe(true);
		expect(JSON.stringify(json)).not.toContain("should-not-leak");
		expect(json.scimTokens).toHaveLength(1);
		expect(json.scimTokens[0].maskedToken).toBe("scim_****abcd");
		expect(json.roleMappings).toEqual([
			expect.objectContaining({ groupName: "Engineering", role: "admin" }),
		]);
		expect(json.defaultProjects).toEqual([
			expect.objectContaining({
				projectId: "sso-project",
				projectName: "SSO Project",
			}),
		]);
		expect(json.scimGroups).toEqual([
			expect.objectContaining({ displayName: "Engineering", memberCount: 1 }),
		]);
	});
});
