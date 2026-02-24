import {
	db,
	tables,
	sql,
	projectHourlyStats,
	projectHourlyModelStats,
	apiKeyHourlyStats,
	apiKeyHourlyModelStats,
} from "@llmgateway/db";

import { app } from "./index.js";

import type { OpenAPIHono } from "@hono/zod-openapi";

const credentials = {
	email: "admin@example.com",
	password: "admin@example.com1A",
};

export async function deleteAll() {
	// await redisClient.flushdb();

	await Promise.all([
		db.delete(tables.log),
		db.delete(tables.apiKey),
		db.delete(tables.providerKey),
		db.delete(projectHourlyStats),
		db.delete(projectHourlyModelStats),
		db.delete(apiKeyHourlyStats),
		db.delete(apiKeyHourlyModelStats),
	]);

	await Promise.all([
		db.delete(tables.userOrganization),
		db.delete(tables.project),
	]);

	await Promise.all([
		db.delete(tables.organization),
		db.delete(tables.user),
		db.delete(tables.account),
		db.delete(tables.session),
		db.delete(tables.verification),
	]);
}

/**
 * Common aggregation fields for stats tables
 */
function getCommonAggregationFields() {
	return {
		requestCount: sql<number>`count(*)::int`.as("requestCount"),
		errorCount:
			sql<number>`sum(case when ${tables.log.hasError} = true then 1 else 0 end)::int`.as(
				"errorCount",
			),
		cacheCount:
			sql<number>`sum(case when ${tables.log.cached} = true then 1 else 0 end)::int`.as(
				"cacheCount",
			),
		streamedCount:
			sql<number>`sum(case when ${tables.log.streamed} = true then 1 else 0 end)::int`.as(
				"streamedCount",
			),
		nonStreamedCount:
			sql<number>`sum(case when ${tables.log.streamed} = false or ${tables.log.streamed} is null then 1 else 0 end)::int`.as(
				"nonStreamedCount",
			),
		completedCount:
			sql<number>`sum(case when ${tables.log.unifiedFinishReason} = 'completed' then 1 else 0 end)::int`.as(
				"completedCount",
			),
		lengthLimitCount:
			sql<number>`sum(case when ${tables.log.unifiedFinishReason} = 'length_limit' then 1 else 0 end)::int`.as(
				"lengthLimitCount",
			),
		contentFilterCount:
			sql<number>`sum(case when ${tables.log.unifiedFinishReason} = 'content_filter' then 1 else 0 end)::int`.as(
				"contentFilterCount",
			),
		toolCallsCount:
			sql<number>`sum(case when ${tables.log.unifiedFinishReason} = 'tool_calls' then 1 else 0 end)::int`.as(
				"toolCallsCount",
			),
		canceledCount:
			sql<number>`sum(case when ${tables.log.unifiedFinishReason} = 'canceled' then 1 else 0 end)::int`.as(
				"canceledCount",
			),
		unknownFinishCount:
			sql<number>`sum(case when ${tables.log.unifiedFinishReason} = 'unknown' or ${tables.log.unifiedFinishReason} is null then 1 else 0 end)::int`.as(
				"unknownFinishCount",
			),
		clientErrorCount:
			sql<number>`sum(case when ${tables.log.unifiedFinishReason} = 'client_error' then 1 else 0 end)::int`.as(
				"clientErrorCount",
			),
		gatewayErrorCount:
			sql<number>`sum(case when ${tables.log.unifiedFinishReason} = 'gateway_error' then 1 else 0 end)::int`.as(
				"gatewayErrorCount",
			),
		upstreamErrorCount:
			sql<number>`sum(case when ${tables.log.unifiedFinishReason} = 'upstream_error' then 1 else 0 end)::int`.as(
				"upstreamErrorCount",
			),
		inputTokens:
			sql<string>`coalesce(sum(cast(${tables.log.promptTokens} as numeric)), 0)`.as(
				"inputTokens",
			),
		outputTokens:
			sql<string>`coalesce(sum(cast(${tables.log.completionTokens} as numeric)), 0)`.as(
				"outputTokens",
			),
		totalTokens:
			sql<string>`coalesce(sum(cast(${tables.log.totalTokens} as numeric)), 0)`.as(
				"totalTokens",
			),
		reasoningTokens:
			sql<string>`coalesce(sum(cast(${tables.log.reasoningTokens} as numeric)), 0)`.as(
				"reasoningTokens",
			),
		cachedTokens:
			sql<string>`coalesce(sum(cast(${tables.log.cachedTokens} as numeric)), 0)`.as(
				"cachedTokens",
			),
		cost: sql<number>`coalesce(sum(${tables.log.cost}), 0)`.as("cost"),
		inputCost: sql<number>`coalesce(sum(${tables.log.inputCost}), 0)`.as(
			"inputCost",
		),
		outputCost: sql<number>`coalesce(sum(${tables.log.outputCost}), 0)`.as(
			"outputCost",
		),
		requestCost: sql<number>`coalesce(sum(${tables.log.requestCost}), 0)`.as(
			"requestCost",
		),
		dataStorageCost:
			sql<number>`coalesce(sum(cast(${tables.log.dataStorageCost} as real)), 0)`.as(
				"dataStorageCost",
			),
		discountSavings: sql<number>`coalesce(
			sum(
				case
					when ${tables.log.discount} > 0 and ${tables.log.discount} < 1
					then ${tables.log.cost} * ${tables.log.discount} / (1 - ${tables.log.discount})
					else 0
				end
			),
			0
		)`.as("discountSavings"),
		imageInputCost:
			sql<number>`coalesce(sum(${tables.log.imageInputCost}), 0)`.as(
				"imageInputCost",
			),
		imageOutputCost:
			sql<number>`coalesce(sum(${tables.log.imageOutputCost}), 0)`.as(
				"imageOutputCost",
			),
		cachedInputCost:
			sql<number>`coalesce(sum(${tables.log.cachedInputCost}), 0)`.as(
				"cachedInputCost",
			),
		// Per-mode breakdowns
		creditsRequestCount:
			sql<number>`sum(case when ${tables.log.usedMode} = 'credits' then 1 else 0 end)::int`.as(
				"creditsRequestCount",
			),
		apiKeysRequestCount:
			sql<number>`sum(case when ${tables.log.usedMode} = 'api-keys' then 1 else 0 end)::int`.as(
				"apiKeysRequestCount",
			),
		creditsCost:
			sql<number>`coalesce(sum(case when ${tables.log.usedMode} = 'credits' then ${tables.log.cost} else 0 end), 0)`.as(
				"creditsCost",
			),
		apiKeysCost:
			sql<number>`coalesce(sum(case when ${tables.log.usedMode} = 'api-keys' then ${tables.log.cost} else 0 end), 0)`.as(
				"apiKeysCost",
			),
		creditsDataStorageCost:
			sql<number>`coalesce(sum(case when ${tables.log.usedMode} = 'credits' then cast(${tables.log.dataStorageCost} as real) else 0 end), 0)`.as(
				"creditsDataStorageCost",
			),
		apiKeysDataStorageCost:
			sql<number>`coalesce(sum(case when ${tables.log.usedMode} = 'api-keys' then cast(${tables.log.dataStorageCost} as real) else 0 end), 0)`.as(
				"apiKeysDataStorageCost",
			),
	};
}

/**
 * Aggregates logs into the hourly stats tables for testing purposes.
 * This mimics what the worker does in production.
 *
 * Uses single-query aggregation (grouping by project+hour in one SELECT)
 * to avoid timezone issues when round-tripping timestamps through JS Date objects.
 * The hourTimestamp is returned as a string and passed back via sql`` to avoid
 * the pg driver's local-timezone interpretation of `timestamp without timezone`.
 */
export async function aggregateLogsForTesting() {
	// Clear existing aggregation data to ensure a clean state
	await Promise.all([
		db.delete(projectHourlyStats),
		db.delete(projectHourlyModelStats),
		db.delete(apiKeyHourlyStats),
		db.delete(apiKeyHourlyModelStats),
	]);

	const hourTrunc = sql`date_trunc('hour', ${tables.log.createdAt})`;

	// Project hourly stats - aggregate in a single query
	const projectStats = await db
		.select({
			projectId: tables.log.projectId,
			hourTimestamp:
				sql<string>`to_char(${hourTrunc}, 'YYYY-MM-DD HH24:MI:SS')`.as(
					"hourTimestamp",
				),
			...getCommonAggregationFields(),
		})
		.from(tables.log)
		.groupBy(tables.log.projectId, hourTrunc);

	for (const stats of projectStats) {
		const { projectId, hourTimestamp, ...fields } = stats;
		if (fields.requestCount > 0) {
			await db
				.insert(projectHourlyStats)
				.values({
					projectId,
					hourTimestamp: sql`${hourTimestamp}::timestamp`,
					...fields,
				})
				.onConflictDoUpdate({
					target: [
						projectHourlyStats.projectId,
						projectHourlyStats.hourTimestamp,
					],
					set: {
						...fields,
						updatedAt: new Date(),
					},
				});
		}
	}

	// Project hourly model stats
	const modelStats = await db
		.select({
			projectId: tables.log.projectId,
			hourTimestamp:
				sql<string>`to_char(${hourTrunc}, 'YYYY-MM-DD HH24:MI:SS')`.as(
					"hourTimestamp",
				),
			usedModel: tables.log.usedModel,
			usedProvider: tables.log.usedProvider,
			...getCommonAggregationFields(),
		})
		.from(tables.log)
		.groupBy(
			tables.log.projectId,
			hourTrunc,
			tables.log.usedModel,
			tables.log.usedProvider,
		);

	for (const stat of modelStats) {
		const { projectId, hourTimestamp, usedModel, usedProvider, ...fields } =
			stat;
		await db
			.insert(projectHourlyModelStats)
			.values({
				projectId,
				hourTimestamp: sql`${hourTimestamp}::timestamp`,
				usedModel,
				usedProvider,
				...fields,
			})
			.onConflictDoUpdate({
				target: [
					projectHourlyModelStats.projectId,
					projectHourlyModelStats.hourTimestamp,
					projectHourlyModelStats.usedModel,
					projectHourlyModelStats.usedProvider,
				],
				set: {
					...fields,
					updatedAt: new Date(),
				},
			});
	}

	// API key hourly stats
	const apiKeyStats = await db
		.select({
			apiKeyId: tables.log.apiKeyId,
			projectId: tables.log.projectId,
			hourTimestamp:
				sql<string>`to_char(${hourTrunc}, 'YYYY-MM-DD HH24:MI:SS')`.as(
					"hourTimestamp",
				),
			...getCommonAggregationFields(),
		})
		.from(tables.log)
		.groupBy(tables.log.apiKeyId, tables.log.projectId, hourTrunc);

	for (const stat of apiKeyStats) {
		const { apiKeyId, projectId, hourTimestamp, ...fields } = stat;
		await db
			.insert(apiKeyHourlyStats)
			.values({
				apiKeyId,
				projectId,
				hourTimestamp: sql`${hourTimestamp}::timestamp`,
				...fields,
			})
			.onConflictDoUpdate({
				target: [apiKeyHourlyStats.apiKeyId, apiKeyHourlyStats.hourTimestamp],
				set: {
					...fields,
					updatedAt: new Date(),
				},
			});
	}

	// API key hourly model stats
	const apiKeyModelStats = await db
		.select({
			apiKeyId: tables.log.apiKeyId,
			projectId: tables.log.projectId,
			hourTimestamp:
				sql<string>`to_char(${hourTrunc}, 'YYYY-MM-DD HH24:MI:SS')`.as(
					"hourTimestamp",
				),
			usedModel: tables.log.usedModel,
			usedProvider: tables.log.usedProvider,
			...getCommonAggregationFields(),
		})
		.from(tables.log)
		.groupBy(
			tables.log.apiKeyId,
			tables.log.projectId,
			hourTrunc,
			tables.log.usedModel,
			tables.log.usedProvider,
		);

	for (const stat of apiKeyModelStats) {
		const {
			apiKeyId,
			projectId,
			hourTimestamp,
			usedModel,
			usedProvider,
			...fields
		} = stat;
		await db
			.insert(apiKeyHourlyModelStats)
			.values({
				apiKeyId,
				projectId,
				hourTimestamp: sql`${hourTimestamp}::timestamp`,
				usedModel,
				usedProvider,
				...fields,
			})
			.onConflictDoUpdate({
				target: [
					apiKeyHourlyModelStats.apiKeyId,
					apiKeyHourlyModelStats.hourTimestamp,
					apiKeyHourlyModelStats.usedModel,
					apiKeyHourlyModelStats.usedProvider,
				],
				set: {
					...fields,
					updatedAt: new Date(),
				},
			});
	}
}

export async function createTestUser() {
	await deleteAll();

	// Create test user
	await db.insert(tables.user).values({
		id: "test-user-id",
		name: "Test User",
		email: "admin@example.com",
		emailVerified: true,
	});

	// Create test account
	await db.insert(tables.account).values({
		id: "test-account-id",
		providerId: "credential",
		accountId: "test-account-id",
		userId: "test-user-id",
		password:
			"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460",
	});

	return await getTestToken(app);
}

export async function getTestToken(app: OpenAPIHono<any>) {
	const auth = await app.request("/auth/sign-in/email", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(credentials),
	});
	if (auth.status !== 200) {
		throw new Error(`Failed to authenticate: ${auth.status}`);
	}
	return auth.headers.get("set-cookie")!;
}
