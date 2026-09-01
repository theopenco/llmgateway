import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import {
	aggregateLogsForTesting,
	createTestUser,
	deleteAll,
} from "@/testing.js";

import {
	redisClient,
	swrWrap,
	waitForSwrMirrorWrites,
} from "@llmgateway/cache";
import {
	cdb,
	db,
	eq,
	getTableName,
	organizationCacheTag,
	tables,
} from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { randomInt } from "@llmgateway/shared/random";

describe("organization route", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
			autoTopUpEnabled: false,
			autoTopUpThreshold: "10",
			autoTopUpAmount: "10",
		});

		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: "test-org-id",
			role: "owner",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("PATCH /orgs/{id} logs enabling auto top-up in audit log", async () => {
		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				autoTopUpEnabled: true,
			}),
		});

		expect(response.status).toBe(200);

		const auditLogs = await db.query.auditLog.findMany({
			where: {
				organizationId: {
					eq: "test-org-id",
				},
				action: {
					eq: "payment.auto_topup.update",
				},
			},
		});

		expect(auditLogs).toHaveLength(1);
		expect(auditLogs[0]?.userId).toBe("test-user-id");
		expect(auditLogs[0]?.resourceId).toBe("test-org-id");
		expect(auditLogs[0]?.metadata).toMatchObject({
			changes: {
				autoTopUpEnabled: {
					old: false,
					new: true,
				},
			},
		});
	});

	test("GET /orgs returns effective Enterprise access", async () => {
		const response = await app.request("/orgs", {
			headers: { Cookie: token },
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.organizations[0].enterpriseAccess).toBe(false);

		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "test-org-id"));
		const enterpriseResponse = await app.request("/orgs", {
			headers: { Cookie: token },
		});
		const enterpriseBody = await enterpriseResponse.json();
		const enterpriseOrganization = enterpriseBody.organizations.find(
			(organization: { id: string }) => organization.id === "test-org-id",
		);
		expect(enterpriseOrganization?.enterpriseAccess).toBe(true);
	});

	test("GET /orgs creates a dashboard org for DevPass-only users", async () => {
		await deleteAll();

		const codeUrl = process.env.CODE_URL ?? "http://localhost:3004";
		const email = `test-devpass-orgs-${Date.now()}@example.com`;
		const password = "Password123!";

		const signUpResponse = await app.request("/auth/sign-up/email", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: codeUrl,
				"CF-Connecting-IP": `192.168.32.${randomInt(0, 255)}`,
			},
			body: JSON.stringify({ email, password, name: "Dev User" }),
		});

		expect(signUpResponse.status).toBe(200);

		const cookie = signUpResponse.headers.get("set-cookie");
		expect(cookie).not.toBeNull();

		const beforeOrganizations = await db.query.userOrganization.findMany({
			with: {
				organization: true,
			},
		});

		expect(beforeOrganizations).toHaveLength(1);
		expect(beforeOrganizations[0]?.organization?.kind).toBe("devpass");

		const response = await app.request("/orgs", {
			headers: {
				Cookie: cookie!,
			},
		});

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			organizations: Array<{
				name: string;
				kind: "default" | "chat" | "devpass";
			}>;
		};

		expect(body.organizations).toHaveLength(1);
		expect(body.organizations[0]?.name).toBe("Default Organization");
		expect(body.organizations[0]?.kind).toBe("default");

		const afterOrganizations = await db.query.userOrganization.findMany({
			with: {
				organization: true,
			},
		});

		expect(afterOrganizations).toHaveLength(2);
		expect(
			afterOrganizations.some((uo) => uo.organization?.kind === "devpass"),
		).toBe(true);
		expect(
			afterOrganizations.some(
				(uo) => uo.organization?.name === "Default Organization",
			),
		).toBe(true);
	});

	test("PATCH /orgs/{id} with an empty body is a no-op", async () => {
		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			organization: { id: string; name: string };
		};
		expect(body.organization.id).toBe("test-org-id");
		expect(body.organization.name).toBe("Test Organization");
	});

	test("DevPass organizations can require no API training", async () => {
		await db
			.update(tables.organization)
			.set({ kind: "devpass" })
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				providerCompliancePolicy: {
					enabled: true,
					blockApiTraining: true,
				},
			}),
		});

		expect(response.status).toBe(200);
		expect(
			(
				await db.query.organization.findFirst({
					where: { id: { eq: "test-org-id" } },
				})
			)?.providerCompliancePolicy,
		).toEqual({ enabled: true, blockApiTraining: true });
	});

	test("compliance updates invalidate the gateway organization cache", async () => {
		await redisClient.flushdb();
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "test-org-id"));
		await db
			.update(tables.userOrganization)
			.set({ role: "admin" })
			.where(eq(tables.userOrganization.organizationId, "test-org-id"));

		const organizationTableName = getTableName(tables.organization);
		const readGatewayPolicy = async () =>
			await swrWrap("org:test-org-id", [organizationTableName], async () => {
				const organizations = await cdb
					.select()
					.from(tables.organization)
					.where(eq(tables.organization.id, "test-org-id"))
					.limit(1)
					.$withCache({
						tag: organizationCacheTag("test-org-id"),
						autoInvalidate: true,
					});
				return organizations[0]?.providerCompliancePolicy;
			});

		expect(await readGatewayPolicy()).toBeNull();
		await waitForSwrMirrorWrites();

		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				providerCompliancePolicy: {
					enabled: true,
					allowedProviders: ["openai"],
				},
			}),
		});

		expect(response.status).toBe(200);
		expect(await readGatewayPolicy()).toEqual({
			enabled: true,
			allowedProviders: ["openai"],
		});
	});

	test("non-enterprise orgs can clear a leftover compliance policy but not enable one", async () => {
		// The gateway enforces enabled policies fail-closed regardless of plan,
		// so a downgraded org must still be able to turn its policy off.
		await db
			.update(tables.organization)
			.set({
				plan: "free",
				providerCompliancePolicy: { enabled: true, requireSoc2: true },
			})
			.where(eq(tables.organization.id, "test-org-id"));

		const enableResponse = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				providerCompliancePolicy: { enabled: true, requireGdpr: true },
			}),
		});
		expect(enableResponse.status).toBe(403);

		const clearResponse = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ providerCompliancePolicy: null }),
		});
		expect(clearResponse.status).toBe(200);
		expect(
			(
				await db.query.organization.findFirst({
					where: { id: { eq: "test-org-id" } },
				})
			)?.providerCompliancePolicy,
		).toBeNull();
	});

	test("DevPass organizations reject other compliance settings even on an enterprise plan", async () => {
		// devpass orgs are limited to blockApiTraining at write time regardless
		// of plan; fuller policies never enter through this route.
		await db
			.update(tables.organization)
			.set({ kind: "devpass", plan: "enterprise" })
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				providerCompliancePolicy: {
					enabled: true,
					blockApiTraining: true,
					allowedProviders: ["openai"],
				},
			}),
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			error: true,
			message: expect.stringContaining("allowedProviders"),
		});
	});

	test("DevPass organizations reject other compliance settings", async () => {
		await db
			.update(tables.organization)
			.set({ kind: "devpass" })
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				providerCompliancePolicy: {
					enabled: true,
					requireGdpr: true,
				},
			}),
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			error: true,
			message: expect.stringContaining("requireGdpr"),
		});
	});

	test("ZDR cannot be enabled while payload retention is active", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "enterprise", retentionLevel: "retain" })
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining("requires Metadata Only"),
		});
		const organization = await db.query.organization.findFirst({
			where: { id: { eq: "test-org-id" } },
		});
		expect(organization?.retentionLevel).toBe("retain");
		expect(organization?.providerCompliancePolicy?.enabled).not.toBe(true);
	});

	test("ZDR can be enabled when payload retention is disabled", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "enterprise", retentionLevel: "none" })
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			}),
		});

		expect(response.status).toBe(200);
		const organization = await db.query.organization.findFirst({
			where: { id: { eq: "test-org-id" } },
		});
		expect(organization?.retentionLevel).toBe("none");
		expect(organization?.providerCompliancePolicy).toEqual({
			enabled: true,
			zeroDataRetention: true,
		});
	});

	test("legacy no prompt logging remains compatible with payload retention", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "enterprise", retentionLevel: "retain" })
			.where(eq(tables.organization.id, "test-org-id"));
		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Cached Project",
			organizationId: "test-org-id",
			cachingEnabled: true,
		});

		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				providerCompliancePolicy: {
					enabled: true,
					blockPromptLogging: true,
				},
			}),
		});

		expect(response.status).toBe(200);
		const organization = await db.query.organization.findFirst({
			where: { id: { eq: "test-org-id" } },
		});
		expect(organization?.retentionLevel).toBe("retain");
		expect(organization?.providerCompliancePolicy).toEqual({
			enabled: true,
			blockPromptLogging: true,
		});
		expect(
			(
				await db.query.project.findFirst({
					where: { id: { eq: "test-project-id" } },
				})
			)?.cachingEnabled,
		).toBe(true);
	});

	test("ZDR cannot be enabled while a project cache is active", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "enterprise", retentionLevel: "none" })
			.where(eq(tables.organization.id, "test-org-id"));
		await db.insert(tables.project).values({
			id: "cached-project-id",
			name: "Cached Project",
			organizationId: "test-org-id",
			cachingEnabled: true,
		});

		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining("response caching"),
		});
		expect(
			(
				await db.query.organization.findFirst({
					where: { id: { eq: "test-org-id" } },
				})
			)?.providerCompliancePolicy?.enabled,
		).not.toBe(true);
	});

	test("payload retention stays blocked by stored ZDR after downgrade", async () => {
		await db
			.update(tables.organization)
			.set({
				plan: "free",
				retentionLevel: "none",
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			})
			.where(eq(tables.organization.id, "test-org-id"));

		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ retentionLevel: "retain" }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining("Zero data retention"),
		});
		expect(
			(
				await db.query.organization.findFirst({
					where: { id: { eq: "test-org-id" } },
				})
			)?.retentionLevel,
		).toBe("none");
	});

	test("PATCH /orgs/{id} logs top-up setting changes separately from organization updates", async () => {
		const response = await app.request("/orgs/test-org-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				name: "Renamed Organization",
				autoTopUpThreshold: 25,
				autoTopUpAmount: 50,
			}),
		});

		expect(response.status).toBe(200);

		const orgAuditLogs = await db.query.auditLog.findMany({
			where: {
				organizationId: {
					eq: "test-org-id",
				},
				action: {
					eq: "organization.update",
				},
			},
		});
		expect(orgAuditLogs).toHaveLength(1);
		expect(orgAuditLogs[0]?.metadata).toMatchObject({
			changes: {
				name: {
					old: "Test Organization",
					new: "Renamed Organization",
				},
			},
		});

		const autoTopUpAuditLogs = await db.query.auditLog.findMany({
			where: {
				organizationId: {
					eq: "test-org-id",
				},
				action: {
					eq: "payment.auto_topup.update",
				},
			},
		});
		expect(autoTopUpAuditLogs).toHaveLength(1);
		expect(autoTopUpAuditLogs[0]?.metadata).toMatchObject({
			changes: {
				autoTopUpThreshold: {
					old: "10",
					new: "25",
				},
				autoTopUpAmount: {
					old: "10",
					new: "50",
				},
			},
		});
	});

	test("GET /orgs/{id}/credits-runway only counts spend that drains credits", async () => {
		await db
			.update(tables.organization)
			.set({ credits: "77" })
			.where(eq(tables.organization.id, "test-org-id"));

		await db.insert(tables.project).values({
			id: "runway-project-id",
			name: "Runway Project",
			organizationId: "test-org-id",
		});
		await db.insert(tables.apiKey).values({
			id: "runway-api-key-id",
			...hashApiKeyForStorage("runway-token"),
			projectId: "runway-project-id",
			description: "Runway Key",
			createdBy: "test-user-id",
		});

		const now = new Date();
		const baseLog = {
			createdAt: now,
			updatedAt: now,
			organizationId: "test-org-id",
			projectId: "runway-project-id",
			apiKeyId: "runway-api-key-id",
			duration: 100,
			requestedModel: "gpt-4",
			requestedProvider: "openai",
			usedModel: "gpt-4",
			usedProvider: "openai",
			responseSize: 100,
			promptTokens: "10",
			completionTokens: "10",
			totalTokens: "20",
			messages: JSON.stringify([{ role: "user", content: "hi" }]),
			mode: "hybrid",
		} as const;
		await db.insert(tables.log).values([
			{
				...baseLog,
				id: "runway-log-credits",
				requestId: "runway-log-credits",
				usedMode: "credits",
				cost: 7,
			},
			{
				// BYOK request: its provider cost never drains credits, only its
				// data-storage cost does.
				...baseLog,
				id: "runway-log-byok",
				requestId: "runway-log-byok",
				usedMode: "api-keys",
				cost: 700,
				dataStorageCost: "0.7",
			},
		]);
		await aggregateLogsForTesting();

		const response = await app.request("/orgs/test-org-id/credits-runway", {
			headers: { Cookie: token },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			avgDailySpend7d: number;
			runwayDays: number | null;
			balance: number;
		};

		// (7 credits + 0.7 BYOK storage) / 7 days = 1.1 — NOT (7 + 700 + 0.7) / 7.
		expect(body.avgDailySpend7d).toBeCloseTo(1.1, 2);
		expect(body.balance).toBe(77);
		// 77 / 1.1 = 70 days, capped to 31 ("30+").
		expect(body.runwayDays).toBe(31);
	});
});
