import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";

import { db, eq, getTableName, pool, tables } from "@llmgateway/db";
import { getProviderDefinition, models } from "@llmgateway/models";
import {
	CONTENT_FILTER_SETTING_ID,
	DEFAULT_CONTENT_FILTER_SETTINGS,
	getGatewayPublicBaseUrl,
	type ContentFilterSettings,
} from "@llmgateway/shared";
import { verifyVideoContentAccessToken } from "@llmgateway/shared/video-access";

import {
	resetMockVideoState,
	resetMockAudioState,
	startMockServer,
	stopMockServer,
} from "./mock-openai-server.js";
import { clearCache } from "./test-helpers.js";

type ProjectMode = "api-keys" | "credits" | "hybrid";
interface LockClient {
	query: (text: string, values?: unknown[]) => Promise<unknown>;
	release: () => void;
}

const TEST_USER_ID = "user-id";
const TEST_ORGANIZATION_ID = "org-id";
const TEST_PROJECT_ID = "project-id";
const GATEWAY_TEST_DB_LOCK_ID = 41001;

/**
 * Emptied wholesale before every test, in this order so foreign keys stay
 * satisfied. Airside-owned catalogue rows are handled separately below.
 */
const RESET_TABLES = [
	tables.log,
	tables.contentFilterHourlyModelStats,
	tables.contentFilterHourlyStats,
	tables.systemSetting,
	// Routing reads uptime/latency from a 60-minute history window, so metric
	// rows a test seeds (e.g. a 0%-uptime provider) must not leak into later
	// tests' provider selection — or collide with a re-seed in the same minute.
	tables.modelProviderMappingHistory,
	tables.webhookDeliveryLog,
	tables.videoJob,
	tables.apiKey,
	tables.providerKey,
	tables.providerPriceFiling,
	tables.providerDraftModel,
	tables.providerClaim,
	tables.providerCompanyMember,
	tables.providerRoutingSettings,
	tables.providerCompany,
	tables.routingScoreMultiplier,
	// Global rate limits carry no organization, so they survive the org delete
	// below and would cap later tests.
	tables.rateLimit,
	tables.userOrganization,
	tables.project,
	tables.organization,
	tables.user,
	tables.account,
	tables.session,
	tables.verification,
];

/**
 * One round trip instead of ~25.
 *
 * This runs before every test in every suite using the harness, so each
 * statement's latency is multiplied by a few thousand; issuing them as a single
 * simple query (no bind parameters, so Postgres accepts the batch) is worth
 * more than any of the individual deletes.
 *
 * The trailing statements drop the catalogue rows an Airside test created: the
 * data-modifying CTE and the `NOT EXISTS` read see the same snapshot, so the
 * mappings being deleted are excluded by `source <> 'airside'` rather than by
 * the delete itself — a model goes away only if nothing else maps it.
 */
const RESET_SQL = `
${RESET_TABLES.map((table) => `DELETE FROM "${getTableName(table)}";`).join("\n")}
WITH deleted AS (
	DELETE FROM "${getTableName(tables.modelProviderMapping)}"
	WHERE source = 'airside'
	RETURNING model_id
)
DELETE FROM "${getTableName(tables.model)}" m
WHERE m.id IN (SELECT model_id FROM deleted)
	AND NOT EXISTS (
		SELECT 1
		FROM "${getTableName(tables.modelProviderMapping)}" mpm
		WHERE mpm.model_id = m.id AND mpm.source <> 'airside'
	);
`;

async function resetGatewayTestData(client: LockClient) {
	await client.query(RESET_SQL);
}

async function seedGatewayTestData() {
	await db.insert(tables.user).values({
		id: TEST_USER_ID,
		name: "user",
		email: "user",
	});

	await db.insert(tables.organization).values({
		id: TEST_ORGANIZATION_ID,
		name: "Test Organization",
		billingEmail: "user",
		plan: "pro",
		retentionLevel: "retain",
		credits: "100.00",
	});

	await db.insert(tables.userOrganization).values({
		id: "user-org-id",
		userId: TEST_USER_ID,
		organizationId: TEST_ORGANIZATION_ID,
	});

	await db.insert(tables.project).values({
		id: TEST_PROJECT_ID,
		name: "Test Project",
		organizationId: TEST_ORGANIZATION_ID,
		mode: "api-keys",
	});
}

async function ensureRoutingMetricMapping(modelId: string, providerId: string) {
	const modelDefinition = models.find((model) => model.id === modelId);
	const providerMapping = modelDefinition?.providers.find(
		(mapping) => mapping.providerId === providerId,
	);

	if (!modelDefinition || !providerMapping) {
		return;
	}

	const providerDefinition = getProviderDefinition(providerId);

	await db
		.insert(tables.provider)
		.values({
			id: providerId,
			name: providerDefinition?.name ?? providerId,
			description:
				providerDefinition?.description ?? `Test provider ${providerId}`,
			streaming: providerDefinition?.streaming ?? null,
			cancellation: providerDefinition?.cancellation ?? null,
			color: providerDefinition?.color ?? null,
			website: providerDefinition?.website ?? null,
			announcement: providerDefinition?.announcement ?? null,
			status: "active",
		})
		.onConflictDoNothing();

	await db
		.insert(tables.model)
		.values({
			id: modelId,
			name: modelDefinition.name,
			description: modelDefinition.description,
			family: modelDefinition.family,
			status: "active",
		})
		.onConflictDoNothing();

	await db
		.insert(tables.modelProviderMapping)
		.values({
			id: `${modelId}::${providerId}`,
			modelId,
			providerId,
			externalId: providerMapping.externalId,
			status: "active",
		})
		.onConflictDoNothing();
}

export function createGatewayApiTestHarness() {
	let mockServerUrl = "";
	let lockClient: LockClient | null = null;

	beforeAll(async () => {
		mockServerUrl = await startMockServer();
	});

	afterAll(() => {
		stopMockServer();
	});

	beforeEach(async () => {
		lockClient = await pool.connect();
		await lockClient.query("SELECT pg_advisory_lock($1)", [
			GATEWAY_TEST_DB_LOCK_ID,
		]);
		await clearCache();
		resetMockVideoState();
		resetMockAudioState();
		await resetGatewayTestData(lockClient);
		await seedGatewayTestData();
	});

	afterEach(async () => {
		const client = lockClient;
		if (!client) {
			return;
		}

		try {
			await client.query("SELECT pg_advisory_unlock($1)", [
				GATEWAY_TEST_DB_LOCK_ID,
			]);
		} finally {
			client.release();
			lockClient = null;
		}
	});

	return {
		get mockServerUrl() {
			return mockServerUrl;
		},
		async setProjectMode(mode: ProjectMode) {
			await db
				.update(tables.project)
				.set({ mode })
				.where(eq(tables.project.id, TEST_PROJECT_ID));
		},
		async setOrganizationCredits(credits: string) {
			await db
				.update(tables.organization)
				.set({ credits })
				.where(eq(tables.organization.id, TEST_ORGANIZATION_ID));
		},
		async setOrganizationPlan(plan: "free" | "pro" | "enterprise") {
			await db
				.update(tables.organization)
				.set({ plan })
				.where(eq(tables.organization.id, TEST_ORGANIZATION_ID));
		},
		async setTrustTierOverride(trustTierOverride: number | null) {
			await db
				.update(tables.organization)
				.set({ trustTierOverride })
				.where(eq(tables.organization.id, TEST_ORGANIZATION_ID));
		},
		async setContentFilterTierOverride(
			contentFilterTierOverride: number | null,
		) {
			await db
				.update(tables.organization)
				.set({ contentFilterTierOverride })
				.where(eq(tables.organization.id, TEST_ORGANIZATION_ID));
		},
		async setContentFilterLogOnly(contentFilterLogOnly: boolean) {
			await db
				.update(tables.organization)
				.set({ contentFilterLogOnly })
				.where(eq(tables.organization.id, TEST_ORGANIZATION_ID));
		},
		// The gateway pins this row in cache for a minute, so clear it after
		// writing.
		async setContentFilterSettings(settings: Partial<ContentFilterSettings>) {
			const value = JSON.stringify({
				...DEFAULT_CONTENT_FILTER_SETTINGS,
				...settings,
			});
			await db
				.insert(tables.systemSetting)
				.values({
					id: CONTENT_FILTER_SETTING_ID,
					enabled: settings.enabled ?? true,
					value,
				})
				.onConflictDoUpdate({
					target: tables.systemSetting.id,
					set: { enabled: settings.enabled ?? true, value },
				});
			await clearCache();
		},
		async setDevPlan(options: {
			devPlan: "lite" | "pro" | "max";
			serviceTier?: "default" | "flex";
			creditsUsed?: string;
			creditsLimit?: string;
			premiumCreditsUsed?: string;
			premiumWeekStart?: Date | null;
			paygEnabled?: boolean;
		}) {
			await db
				.update(tables.organization)
				.set({
					kind: "devpass",
					devPlan: options.devPlan,
					devPlanServiceTier: options.serviceTier ?? "default",
					devPlanCreditsUsed: options.creditsUsed ?? "0",
					devPlanCreditsLimit: options.creditsLimit ?? "100",
					devPlanPremiumCreditsUsed: options.premiumCreditsUsed ?? "0",
					devPlanPremiumWeekStart: options.premiumWeekStart ?? null,
					devPlanPaygEnabled: options.paygEnabled ?? false,
				})
				.where(eq(tables.organization.id, TEST_ORGANIZATION_ID));
		},
		async setRoutingMetrics(
			modelId: string,
			providerId: string,
			metrics: {
				uptime: number;
				latency?: number;
				throughput?: number;
				totalRequests?: number;
			},
		) {
			await ensureRoutingMetricMapping(modelId, providerId);

			// Routing now reads metrics on-demand from
			// model_provider_mapping_history (see packages/db/src/provider-metrics-history.ts).
			// Seed a single recent history row whose unweighted aggregates
			// produce the requested uptime/latency/throughput.
			const totalRequests = metrics.totalRequests ?? 100;
			const latency = metrics.latency ?? 100;
			const throughput = metrics.throughput ?? 100;
			const uptimeFraction = metrics.uptime / 100;
			const errorRate = 1 - uptimeFraction;
			const errorsCount = Math.round(totalRequests * errorRate);
			const totalDurationMs = 1000; // arbitrary
			const totalOutputTokens = Math.round(
				(throughput * totalDurationMs) / 1000,
			);
			const totalTimeToFirstToken = latency * totalRequests;
			const minuteTimestamp = new Date(Math.floor(Date.now() / 60000) * 60000);

			await db
				.insert(tables.modelProviderMappingHistory)
				.values({
					modelId,
					providerId,
					modelProviderMappingId: `${modelId}::${providerId}`,
					minuteTimestamp,
					usedMode: "credits",
					logsCount: totalRequests,
					errorsCount,
					clientErrorsCount: 0,
					gatewayErrorsCount: 0,
					upstreamErrorsCount: errorsCount,
					cachedCount: 0,
					totalOutputTokens,
					totalDuration: totalDurationMs,
					totalTimeToFirstToken,
					totalTimeToFirstReasoningToken: 0,
					timeToFirstTokenCount: totalRequests,
					timeToFirstReasoningTokenCount: 0,
				})
				.onConflictDoUpdate({
					target: [
						tables.modelProviderMappingHistory.modelProviderMappingId,
						tables.modelProviderMappingHistory.minuteTimestamp,
						tables.modelProviderMappingHistory.usedMode,
					],
					set: {
						logsCount: totalRequests,
						errorsCount,
						clientErrorsCount: 0,
						gatewayErrorsCount: 0,
						upstreamErrorsCount: errorsCount,
						cachedCount: 0,
						totalOutputTokens,
						totalDuration: totalDurationMs,
						totalTimeToFirstToken,
						totalTimeToFirstReasoningToken: 0,
						timeToFirstTokenCount: totalRequests,
						timeToFirstReasoningTokenCount: 0,
					},
				});
		},
		expectSignedVideoLogContentUrl(url: string, logId: string) {
			const validAfterSixDays = 6 * 24 * 60 * 60 * 1000;
			const expiredAfterEightDays = 8 * 24 * 60 * 60 * 1000;
			const parsed = new URL(url);
			expect(parsed.origin).toBe(new URL(getGatewayPublicBaseUrl()).origin);
			expect(parsed.pathname).toBe(`/v1/videos/logs/${logId}/content`);
			const token = parsed.searchParams.get("token");
			expect(token).toBeTruthy();
			if (!token) {
				throw new Error("Missing video access token");
			}

			expect(verifyVideoContentAccessToken(token, logId)).toBe(true);
			expect(
				verifyVideoContentAccessToken(
					token,
					logId,
					new Date(Date.now() + validAfterSixDays),
				),
			).toBe(true);
			expect(
				verifyVideoContentAccessToken(
					token,
					logId,
					new Date(Date.now() + expiredAfterEightDays),
				),
			).toBe(false);

			return parsed;
		},
	};
}
