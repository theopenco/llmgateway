import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
	and,
	apiKey,
	db,
	eq,
	log,
	organization,
	project,
	providerKeyHourlyStats,
	tables,
	user,
} from "@llmgateway/db";

import { refreshCurrentHourStats } from "./project-stats-aggregator.js";

describe("provider key hourly stats aggregation", () => {
	// Fresh ids per test: the shared test database is not reset between runs, so
	// reusing one suffix across the suite lets a failed cleanup collide with the
	// next test's inserts.
	let suffix = "";
	let ids = {
		userId: "",
		orgId: "",
		projectId: "",
		apiKeyId: "",
		providerKeyId: "",
	};

	const insertLog = (values: {
		providerKeyId: string | null;
		cost: number;
		cached?: boolean;
		hasError?: boolean;
		unifiedFinishReason?: string;
	}) =>
		db.insert(log).values({
			requestId: `pk-stats-request-${randomUUID()}`,
			organizationId: ids.orgId,
			projectId: ids.projectId,
			apiKeyId: ids.apiKeyId,
			providerKeyId: values.providerKeyId,
			cost: values.cost,
			cached: values.cached ?? false,
			hasError: values.hasError ?? false,
			unifiedFinishReason: values.unifiedFinishReason ?? "completed",
			promptTokens: "10",
			completionTokens: "20",
			totalTokens: "30",
			duration: 1000,
			usedMode: "credits",
			requestedModel: "openai/gpt-4o-mini",
			requestedProvider: "openai",
			usedModel: "gpt-4o-mini",
			usedProvider: "openai",
			responseSize: 100,
			mode: "credits",
		});

	const readStats = () =>
		db.query.providerKeyHourlyStats.findFirst({
			where: {
				providerKeyId: { eq: ids.providerKeyId },
				projectId: { eq: ids.projectId },
			},
		});

	beforeEach(async () => {
		suffix = randomUUID();
		ids = {
			userId: `pk-stats-user-${suffix}`,
			orgId: `pk-stats-org-${suffix}`,
			projectId: `pk-stats-project-${suffix}`,
			apiKeyId: `pk-stats-api-key-${suffix}`,
			providerKeyId: `pk-stats-provider-key-${suffix}`,
		};

		await db.insert(user).values({
			id: ids.userId,
			email: `pk-stats-${suffix}@example.com`,
			name: "Provider Key Stats",
		});
		await db.insert(organization).values({
			id: ids.orgId,
			name: "Provider Key Stats Org",
			billingEmail: `pk-stats-${suffix}@example.com`,
			credits: "100",
		});
		await db.insert(project).values({
			id: ids.projectId,
			name: "Provider Key Stats Project",
			organizationId: ids.orgId,
			mode: "credits",
		});
		await db.insert(apiKey).values({
			id: ids.apiKeyId,
			tokenHash: `pk-stats-token-${suffix}`,
			tokenMasked: `pk-stats-token-${suffix}`,
			projectId: ids.projectId,
			description: "Provider Key Stats Key",
			createdBy: ids.userId,
		});
		await db.insert(tables.providerKey).values({
			id: ids.providerKeyId,
			tokenCiphertext: `encrypted-pk-stats-${suffix}`,
			tokenHash: `hash-pk-stats-${suffix}`,
			tokenMasked: `sk-pk-stats-${suffix}`,
			provider: "openai",
			organizationId: ids.orgId,
		});
	});

	afterEach(async () => {
		await db
			.delete(providerKeyHourlyStats)
			.where(eq(providerKeyHourlyStats.providerKeyId, ids.providerKeyId));
		await db.delete(log).where(eq(log.organizationId, ids.orgId));
		await db.delete(apiKey).where(eq(apiKey.id, ids.apiKeyId));
		await db
			.delete(tables.providerKey)
			.where(eq(tables.providerKey.id, ids.providerKeyId));
		await db.delete(project).where(eq(project.id, ids.projectId));
		await db.delete(organization).where(eq(organization.id, ids.orgId));
		await db.delete(user).where(eq(user.id, ids.userId));
	});

	test("buckets attributed upstream spend per credential", async () => {
		await insertLog({ providerKeyId: ids.providerKeyId, cost: 0.01 });
		await insertLog({ providerKeyId: ids.providerKeyId, cost: 0.02 });

		await refreshCurrentHourStats();

		const stats = await readStats();
		expect(stats).toBeDefined();
		expect(stats!.requestCount).toBe(2);
		expect(Number(stats!.cost)).toBeCloseTo(0.03, 6);
		expect(String(stats!.totalTokens)).toBe("60");
	});

	test("excludes requests with no attributed credential", async () => {
		// Env-var credentials and pre-resolution failures log a null providerKeyId
		// and are not attributable to any key.
		await insertLog({ providerKeyId: null, cost: 0.05 });

		await refreshCurrentHourStats();

		expect(await readStats()).toBeUndefined();
	});

	test("cached responses add requests but no spend", async () => {
		// Cache hits never reach the provider and are logged at cost 0, matching
		// the billing worker's `!cached` skip when it increments provider_key.usage.
		await insertLog({
			providerKeyId: ids.providerKeyId,
			cost: 0,
			cached: true,
		});

		await refreshCurrentHourStats();

		const stats = await readStats();
		expect(stats!.requestCount).toBe(1);
		expect(stats!.cacheCount).toBe(1);
		expect(Number(stats!.cost)).toBe(0);
	});

	test("counts upstream errors separately from client errors", async () => {
		await insertLog({
			providerKeyId: ids.providerKeyId,
			cost: 0,
			hasError: true,
			unifiedFinishReason: "upstream_error",
		});
		await insertLog({
			providerKeyId: ids.providerKeyId,
			cost: 0,
			hasError: true,
			unifiedFinishReason: "client_error",
		});

		await refreshCurrentHourStats();

		const stats = await readStats();
		expect(stats!.errorCount).toBe(2);
		expect(stats!.upstreamErrorCount).toBe(1);
	});

	test("re-aggregating a bucket replaces rather than accumulates", async () => {
		// The stale-bucket phase re-runs buckets that receive new logs, so the
		// upsert has to be replace-semantics or every re-run would double the
		// reported spend.
		await insertLog({ providerKeyId: ids.providerKeyId, cost: 0.04 });

		await refreshCurrentHourStats();
		await refreshCurrentHourStats();

		const stats = await readStats();
		expect(stats!.requestCount).toBe(1);
		expect(Number(stats!.cost)).toBeCloseTo(0.04, 6);
	});

	test("keeps per-project rows separate for a shared credential", async () => {
		// A managed credential serves many tenants; the projectId in the grain is
		// what makes the per-tenant breakdown possible.
		const secondProjectId = `pk-stats-project-2-${suffix}`;
		const secondApiKeyId = `pk-stats-api-key-2-${suffix}`;
		await db.insert(project).values({
			id: secondProjectId,
			name: "Provider Key Stats Project 2",
			organizationId: ids.orgId,
			mode: "credits",
		});
		await db.insert(apiKey).values({
			id: secondApiKeyId,
			tokenHash: `pk-stats-token-2-${suffix}`,
			tokenMasked: `pk-stats-token-2-${suffix}`,
			projectId: secondProjectId,
			description: "Provider Key Stats Key 2",
			createdBy: ids.userId,
		});

		try {
			await insertLog({ providerKeyId: ids.providerKeyId, cost: 0.01 });
			await db.insert(log).values({
				requestId: `pk-stats-request-${randomUUID()}`,
				organizationId: ids.orgId,
				projectId: secondProjectId,
				apiKeyId: secondApiKeyId,
				providerKeyId: ids.providerKeyId,
				cost: 0.07,
				cached: false,
				duration: 1000,
				usedMode: "credits",
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				mode: "credits",
			});

			await refreshCurrentHourStats();

			const rows = await db.query.providerKeyHourlyStats.findMany({
				where: { providerKeyId: { eq: ids.providerKeyId } },
			});
			expect(rows).toHaveLength(2);
			expect(rows.reduce((sum, row) => sum + Number(row.cost), 0)).toBeCloseTo(
				0.08,
				6,
			);
		} finally {
			await db
				.delete(providerKeyHourlyStats)
				.where(
					and(
						eq(providerKeyHourlyStats.providerKeyId, ids.providerKeyId),
						eq(providerKeyHourlyStats.projectId, secondProjectId),
					),
				);
			await db.delete(log).where(eq(log.projectId, secondProjectId));
			await db.delete(apiKey).where(eq(apiKey.id, secondApiKeyId));
			await db.delete(project).where(eq(project.id, secondProjectId));
		}
	});
});
