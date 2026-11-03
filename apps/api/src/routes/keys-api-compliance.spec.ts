import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import {
	redisClient,
	swrMirrorKey,
	swrWrap,
	waitForSwrMirrorWrites,
} from "@llmgateway/cache";
import { db, eq, tables, cdb, getTableName } from "@llmgateway/db";
import {
	getApiKeyFingerprint,
	hashApiKeyForStorage,
} from "@llmgateway/shared/api-key-hash";

const organizationId = "key-compliance-org";
const projectId = "key-compliance-project";
const keyId = "key-compliance-key";
const policy = { enabled: true, requireGdpr: true, allowedCountries: ["DE"] };

describe("API key compliance policies", () => {
	let cookie: string;

	beforeEach(async () => {
		vi.stubEnv("API_KEY_COMPLIANCE_ENABLED", "true");
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: organizationId,
			name: "Compliance Organization",
			billingEmail: "test@example.com",
			plan: "enterprise",
		});
		await db.insert(tables.userOrganization).values({
			id: "key-compliance-member",
			organizationId,
			userId: "test-user-id",
			role: "owner",
		});
		await db
			.insert(tables.project)
			.values({ id: projectId, organizationId, name: "Compliance Project" });
		await db.insert(tables.apiKey).values({
			id: keyId,
			projectId,
			createdBy: "test-user-id",
			description: "Compliance Key",
			...hashApiKeyForStorage("test-compliance-token"),
		});
	});

	afterEach(async () => {
		await deleteAll();
		vi.unstubAllEnvs();
	});

	function request(path: string, method = "GET", body?: unknown) {
		return app.request(path, {
			method,
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	function update(providerCompliancePolicy: unknown) {
		return request(`/keys/api/${keyId}`, "PATCH", { providerCompliancePolicy });
	}

	function inventory() {
		return request(`/keys/api/compliance?organizationId=${organizationId}`);
	}

	test.each(["session", "master"])(
		"policy writes invalidate cached authentication and audit changes: %s",
		async (authentication) => {
			const masterToken = `mk-${crypto.randomUUID()}`;
			if (authentication === "master") {
				await db.insert(tables.masterKey).values({
					id: "cache-compliance-master",
					organizationId,
					createdBy: "test-user-id",
					tokenHash: getApiKeyFingerprint(masterToken),
					maskedToken: "mk-****",
					description: "Test Master Key",
				});
			}
			const mutate = (nextPolicy: unknown) =>
				authentication === "session"
					? update(nextPolicy)
					: app.request(`/v1/master/keys/${keyId}`, {
							method: "PATCH",
							headers: {
								Authorization: `Bearer ${masterToken}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({ providerCompliancePolicy: nextPolicy }),
						});
			const cacheKey = `apiKey:compliance:${keyId}`;
			const readCached = () =>
				swrWrap(cacheKey, [getTableName(tables.apiKey)], () =>
					cdb.select().from(tables.apiKey).where(eq(tables.apiKey.id, keyId)),
				);
			for (const [previous, next] of [
				[null, policy],
				[policy, null],
			] as const) {
				expect((await readCached())[0]?.providerCompliancePolicy).toEqual(
					previous,
				);
				await waitForSwrMirrorWrites();
				expect(await redisClient.get(swrMirrorKey(cacheKey))).not.toBeNull();
				expect((await mutate(next)).status).toBe(200);
				expect(await redisClient.get(swrMirrorKey(cacheKey))).toBeNull();
				expect((await readCached())[0]?.providerCompliancePolicy).toEqual(next);
			}
			const logs = await db.query.auditLog.findMany({
				where: { organizationId, resourceId: keyId },
			});
			expect(logs).toHaveLength(2);
			expect(
				logs.map((log) => log.metadata?.changes?.providerCompliancePolicy),
			).toEqual(
				expect.arrayContaining([
					{ old: null, new: policy },
					{ old: policy, new: null },
				]),
			);
		},
	);

	test("creates and reads a policy without weakening the stored organization floor", async () => {
		const floor = {
			enabled: true,
			requireSoc2: true,
			allowedCountries: ["DE"],
		};
		await db
			.update(tables.organization)
			.set({ providerCompliancePolicy: floor })
			.where(eq(tables.organization.id, organizationId));
		const looserPolicy = {
			enabled: true,
			requireSoc2: false,
			allowedCountries: ["DE", "US"],
		};
		const res = await request("/keys/api", "POST", {
			projectId,
			description: "Explicit Policy",
			providerCompliancePolicy: looserPolicy,
		});
		expect(res.status).toBe(200);
		const { apiKey } = await res.json();
		expect(apiKey.providerCompliancePolicy).toEqual(looserPolicy);
		const createdAudit = await db.query.auditLog.findFirst({
			where: {
				organizationId,
				resourceId: apiKey.id,
				action: "api_key.create",
			},
		});
		expect(createdAudit?.metadata?.providerCompliancePolicy).toEqual(
			looserPolicy,
		);
		const listed = await (
			await request(`/keys/api?projectId=${projectId}`)
		).json();
		expect(
			listed.apiKeys.find((key: { id: string }) => key.id === apiKey.id)
				?.providerCompliancePolicy,
		).toEqual(looserPolicy);
		expect(
			(await db.query.apiKey.findFirst({ where: { id: apiKey.id } }))
				?.providerCompliancePolicy,
		).toEqual(looserPolicy);
		expect(
			(await db.query.organization.findFirst({ where: { id: organizationId } }))
				?.providerCompliancePolicy,
		).toEqual(floor);
	});

	test("defaults to inherited policy and preserves it on unrelated updates", async () => {
		const created = await request("/keys/api", "POST", {
			projectId,
			description: "Inherited Policy",
		});
		expect(created.status).toBe(200);
		expect((await created.json()).apiKey.providerCompliancePolicy).toBeNull();
		expect((await update(policy)).status).toBe(200);
		const renamed = await request(`/keys/api/${keyId}`, "PATCH", {
			description: "Renamed",
		});
		expect(renamed.status).toBe(200);
		expect((await renamed.json()).apiKey.providerCompliancePolicy).toEqual(
			policy,
		);
	});

	test("updates and clears a policy without exposing credentials", async () => {
		const response = await update(policy);
		expect(response.status).toBe(200);
		const { apiKey } = await response.json();
		expect(apiKey.providerCompliancePolicy).toEqual(policy);
		for (const field of ["token", "tokenHash", "safetyIdentifier"]) {
			expect(apiKey).not.toHaveProperty(field);
		}
		expect((await update(null)).status).toBe(200);
		expect(
			(await db.query.apiKey.findFirst({ where: { id: keyId } }))
				?.providerCompliancePolicy,
		).toBeNull();
	});

	test.each(["free", "pro"] as const)(
		"requires enterprise for %s writes but permits clearing after downgrade",
		async (plan) => {
			expect((await update(policy)).status).toBe(200);
			await db
				.update(tables.organization)
				.set({ plan })
				.where(eq(tables.organization.id, organizationId));
			for (const next of [policy, { enabled: false }]) {
				expect((await update(next)).status).toBe(403);
				expect(
					(
						await request("/keys/api", "POST", {
							projectId,
							description: "Denied",
							providerCompliancePolicy: next,
						})
					).status,
				).toBe(403);
			}
			expect((await inventory()).status).toBe(200);
			expect((await update(null)).status).toBe(200);
			expect(
				(
					await request("/keys/api", "POST", {
						projectId,
						description: "Inherited",
						providerCompliancePolicy: null,
					})
				).status,
			).toBe(200);
		},
	);

	test.each([
		{ enabled: true, allowedCountries: ["de"] },
		{ enabled: true, allowedProviders: ["unknown-provider"] },
		{ enabled: true, blockedModels: ["unknown-model"] },
		{
			enabled: true,
			blockedProviders: Array.from({ length: 501 }, () => "openai"),
		},
		{ requireSoc2: true },
	])("uses organization policy validation: %j", async (invalid) => {
		expect((await update(invalid)).status).toBe(400);
		expect(
			(
				await request("/keys/api", "POST", {
					projectId,
					description: "Invalid",
					providerCompliancePolicy: invalid,
				})
			).status,
		).toBe(400);
	});

	test("supports custom provider/model refs and key-only zero data retention", async () => {
		const next = {
			enabled: true,
			zeroDataRetention: true,
			allowedProviders: ["custom:compliance-test"],
			allowedModels: ["compliance-test/custom-model"],
		};
		const res = await update(next);
		expect(res.status).toBe(200);
		expect((await res.json()).apiKey.providerCompliancePolicy).toEqual(next);
	});

	test("lists only active explicit policies across all organization projects with a safe response", async () => {
		await update(policy);
		await db.insert(tables.organization).values({
			id: "other-compliance-org",
			name: "Other Organization",
			billingEmail: "other@example.com",
		});
		await db.insert(tables.project).values([
			{
				id: "second-compliance-project",
				organizationId,
				name: "Second Project",
			},
			{
				id: "deleted-compliance-project",
				organizationId,
				name: "Deleted Project",
				status: "deleted",
			},
			{
				id: "other-compliance-project",
				organizationId: "other-compliance-org",
				name: "Other Project",
			},
		]);
		const fixtures = [
			{
				id: "second-key",
				projectId: "second-compliance-project",
				providerCompliancePolicy: { enabled: false },
			},
			{ id: "inherited-key", projectId, providerCompliancePolicy: null },
			{ id: "inactive-key", projectId, status: "inactive" as const },
			{ id: "deleted-key", projectId, status: "deleted" as const },
			{ id: "expired-key", projectId, expiresAt: new Date("2020-01-01") },
			{ id: "deleted-project-key", projectId: "deleted-compliance-project" },
			{ id: "other-org-key", projectId: "other-compliance-project" },
			{ id: "playground-key", projectId, kind: "playground" as const },
			{ id: "platform-key", projectId, keyType: "platform_secret" as const },
		];
		await db.insert(tables.apiKey).values(
			fixtures.map((fixture) => ({
				createdBy: "test-user-id",
				description: fixture.id,
				providerCompliancePolicy: policy,
				...hashApiKeyForStorage(`test-${fixture.id}`),
				...fixture,
			})),
		);
		const res = await inventory();
		expect(res.status).toBe(200);
		const { apiKeys } = await res.json();
		expect(apiKeys).toHaveLength(2);
		expect(apiKeys).toEqual(
			expect.arrayContaining([
				{
					id: keyId,
					name: "Compliance Key",
					projectId,
					projectName: "Compliance Project",
					providerCompliancePolicy: policy,
				},
				{
					id: "second-key",
					name: "second-key",
					projectId: "second-compliance-project",
					projectName: "Second Project",
					providerCompliancePolicy: { enabled: false },
				},
			]),
		);
		for (const key of apiKeys) {
			expect(Object.keys(key).sort()).toEqual([
				"id",
				"name",
				"projectId",
				"projectName",
				"providerCompliancePolicy",
			]);
		}
	});

	test("requires authentication and organizationId for inventory", async () => {
		expect(
			(
				await app.request(
					`/keys/api/compliance?organizationId=${organizationId}`,
				)
			).status,
		).toBe(401);
		expect((await request("/keys/api/compliance")).status).toBe(400);
		expect(
			(await request("/keys/api/compliance?organizationId=unrelated-org"))
				.status,
		).toBe(403);
	});

	test.each(["owner", "admin", "project_admin", "developer"] as const)(
		"restricts inventory to organization admins: %s",
		async (role) => {
			await db
				.update(tables.userOrganization)
				.set({ role })
				.where(eq(tables.userOrganization.organizationId, organizationId));
			expect((await inventory()).status).toBe(
				role === "owner" || role === "admin" ? 200 : 403,
			);
		},
	);

	test("excludes deleted organizations and handles organizations without projects", async () => {
		await db
			.update(tables.project)
			.set({ status: "deleted" })
			.where(eq(tables.project.id, projectId));
		const empty = await inventory();
		expect(empty.status).toBe(200);
		expect(await empty.json()).toEqual({ apiKeys: [] });
		await db
			.update(tables.organization)
			.set({ status: "deleted" })
			.where(eq(tables.organization.id, organizationId));
		expect((await inventory()).status).toBe(403);
	});

	test.each(["developer", "project_admin"] as const)(
		"non-admin %s cannot create, change, disable or clear key policies",
		async (role) => {
			expect((await update(policy)).status).toBe(200);
			await db
				.update(tables.userOrganization)
				.set({ role })
				.where(eq(tables.userOrganization.organizationId, organizationId));
			await db
				.insert(tables.userProject)
				.values({ userOrganizationId: "key-compliance-member", projectId });
			for (const plan of ["enterprise", "pro"] as const) {
				await db
					.update(tables.organization)
					.set({ plan })
					.where(eq(tables.organization.id, organizationId));
				for (const next of [policy, { enabled: false }, null]) {
					expect((await update(next)).status).toBe(403);
					expect(
						(
							await request("/keys/api", "POST", {
								projectId,
								description: "Denied policy",
								providerCompliancePolicy: next,
							})
						).status,
					).toBe(403);
				}
			}
			const renamed = await request(`/keys/api/${keyId}`, "PATCH", {
				description: "Renamed by creator",
			});
			expect(renamed.status).toBe(200);
			expect((await renamed.json()).apiKey.providerCompliancePolicy).toEqual(
				policy,
			);
			expect(
				(
					await request("/keys/api", "POST", {
						projectId,
						description: "Inherited policy",
					})
				).status,
			).toBe(200);
		},
	);

	test.each(["owner", "admin"] as const)(
		"organization %s can create, change and clear key policies",
		async (role) => {
			await db
				.update(tables.userOrganization)
				.set({ role })
				.where(eq(tables.userOrganization.organizationId, organizationId));
			expect((await update(policy)).status).toBe(200);
			expect(
				(
					await request("/keys/api", "POST", {
						projectId,
						description: "Admin policy",
						providerCompliancePolicy: policy,
					})
				).status,
			).toBe(200);
			expect((await update(null)).status).toBe(200);
		},
	);

	test("rejects cross-organization mutations", async () => {
		await db.insert(tables.organization).values({
			id: "unrelated-org",
			name: "Unrelated",
			billingEmail: "unrelated@example.com",
		});
		await db.insert(tables.project).values({
			id: "unrelated-project",
			name: "Unrelated",
			organizationId: "unrelated-org",
		});
		await db
			.update(tables.apiKey)
			.set({ projectId: "unrelated-project" })
			.where(eq(tables.apiKey.id, keyId));
		expect((await update(policy)).status).toBe(404);
	});

	test("master-key create/update/read carry policy with the same validation", async () => {
		const masterToken = `mk-${crypto.randomUUID()}`;
		await db.insert(tables.masterKey).values({
			id: "compliance-master-key",
			organizationId,
			createdBy: "test-user-id",
			tokenHash: getApiKeyFingerprint(masterToken),
			maskedToken: "mk-****",
			description: "Test Master Key",
		});
		const masterRequest = (path: string, method = "GET", body?: unknown) =>
			app.request(`/v1/master${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${masterToken}`,
					"Content-Type": "application/json",
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		const res = await masterRequest("/keys", "POST", {
			projectId,
			description: "Master Created",
			providerCompliancePolicy: policy,
		});
		expect(res.status).toBe(201);
		const { apiKey } = await res.json();
		expect(apiKey.providerCompliancePolicy).toEqual(policy);
		const detail = await masterRequest(`/keys/${apiKey.id}`);
		expect(detail.status).toBe(200);
		expect((await detail.json()).apiKey.providerCompliancePolicy).toEqual(
			policy,
		);
		const cleared = await masterRequest(`/keys/${apiKey.id}`, "PATCH", {
			providerCompliancePolicy: null,
		});
		expect(cleared.status).toBe(200);
		expect((await cleared.json()).apiKey.providerCompliancePolicy).toBeNull();
		expect(
			(
				await masterRequest(`/keys/${apiKey.id}`, "PATCH", {
					providerCompliancePolicy: { enabled: true, allowedCountries: ["de"] },
				})
			).status,
		).toBe(400);
		expect(
			(
				await masterRequest(`/keys/${apiKey.id}`, "PATCH", {
					providerCompliancePolicy: policy,
				})
			).status,
		).toBe(200);
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, organizationId));
		expect(
			(
				await masterRequest(`/keys/${apiKey.id}`, "PATCH", {
					providerCompliancePolicy: null,
				})
			).status,
		).toBe(403);
		const clearedAfterDowngrade = await request(
			`/keys/api/${apiKey.id}`,
			"PATCH",
			{ providerCompliancePolicy: null },
		);
		expect(clearedAfterDowngrade.status).toBe(200);
		expect(
			(await clearedAfterDowngrade.json()).apiKey.providerCompliancePolicy,
		).toBeNull();
	});
	test.each(["developer", "project_admin", "removed"] as const)(
		"master issuer %s cannot change compliance after losing admin access",
		async (role) => {
			await update(policy);
			const token = `mk-${crypto.randomUUID()}`;
			await db.insert(tables.masterKey).values({
				id: "demoted-compliance-master",
				organizationId,
				createdBy: "test-user-id",
				tokenHash: getApiKeyFingerprint(token),
				maskedToken: "mk-****",
				description: "Test Master Key",
			});
			if (role === "removed") {
				await db
					.delete(tables.userOrganization)
					.where(eq(tables.userOrganization.organizationId, organizationId));
			} else {
				await db
					.update(tables.userOrganization)
					.set({ role })
					.where(eq(tables.userOrganization.organizationId, organizationId));
			}
			const call = (path: string, method: string, body: unknown) =>
				app.request(`/v1/master${path}`, {
					method,
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				});
			for (const next of [policy, { enabled: false }, null]) {
				expect(
					(
						await call(`/keys/${keyId}`, "PATCH", {
							providerCompliancePolicy: next,
						})
					).status,
				).toBe(403);
				expect(
					(
						await call("/keys", "POST", {
							projectId,
							description: "Denied policy",
							providerCompliancePolicy: next,
						})
					).status,
				).toBe(403);
			}
			expect(
				(
					await call(`/keys/${keyId}`, "PATCH", {
						description: "Unrelated token operation",
					})
				).status,
			).toBe(200);
			expect(
				(await db.query.apiKey.findFirst({ where: { id: keyId } }))
					?.providerCompliancePolicy,
			).toEqual(policy);
		},
	);
	test.each([undefined, "false"] as const)(
		"rollout gate defaults closed (%s) without affecting organization policies",
		async (flag) => {
			vi.stubEnv("API_KEY_COMPLIANCE_ENABLED", flag);
			await db
				.update(tables.apiKey)
				.set({ providerCompliancePolicy: policy })
				.where(eq(tables.apiKey.id, keyId));
			const token = `mk-${crypto.randomUUID()}`;
			await db.insert(tables.masterKey).values({
				id: "rollout-compliance-master",
				organizationId,
				createdBy: "test-user-id",
				tokenHash: getApiKeyFingerprint(token),
				maskedToken: "mk-****",
				description: "Test Master Key",
			});
			const master = (path: string, method: string, body: unknown) =>
				app.request(`/v1/master${path}`, {
					method,
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				});
			for (const next of [policy, { enabled: false }]) {
				expect((await update(next)).status).toBe(503);
				expect(
					(
						await request("/keys/api", "POST", {
							projectId,
							description: "Gated policy",
							providerCompliancePolicy: next,
						})
					).status,
				).toBe(503);
				expect(
					(
						await master(`/keys/${keyId}`, "PATCH", {
							providerCompliancePolicy: next,
						})
					).status,
				).toBe(503);
				expect(
					(
						await master("/keys", "POST", {
							projectId,
							description: "Gated policy",
							providerCompliancePolicy: next,
						})
					).status,
				).toBe(503);
			}
			expect(
				(await db.query.apiKey.findFirst({ where: { id: keyId } }))
					?.providerCompliancePolicy,
			).toEqual(policy);
			expect(
				(
					await request(`/keys/api/${keyId}`, "PATCH", {
						description: "Unrelated update",
					})
				).status,
			).toBe(200);
			expect(
				(
					await master(`/keys/${keyId}`, "PATCH", {
						description: "Unrelated master update",
					})
				).status,
			).toBe(200);
			expect(
				(
					await request("/keys/api", "POST", {
						projectId,
						description: "Inherited organization policy",
					})
				).status,
			).toBe(200);
			expect(
				(
					await master("/keys", "POST", {
						projectId,
						description: "Inherited organization policy",
					})
				).status,
			).toBe(201);
			const orgUpdate = await request(`/orgs/${organizationId}`, "PATCH", {
				providerCompliancePolicy: { enabled: true, requireGdpr: true },
			});
			expect(orgUpdate.status, await orgUpdate.text()).toBe(200);
			expect((await update(null)).status).toBe(200);
			await db
				.update(tables.apiKey)
				.set({ providerCompliancePolicy: policy })
				.where(eq(tables.apiKey.id, keyId));
			expect(
				(
					await master(`/keys/${keyId}`, "PATCH", {
						providerCompliancePolicy: null,
					})
				).status,
			).toBe(200);
		},
	);
});
