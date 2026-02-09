import {
	db,
	tables,
	sql,
	gte,
	lt,
	and,
	projectHourlyStats,
	projectHourlyModelStats,
	apiKeyHourlyStats,
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
 * Helper function to round a date to the start of its hour
 */
function roundToHourStart(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		date.getHours(),
		0,
		0,
		0,
	);
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
		serviceFee: sql<number>`coalesce(sum(${tables.log.serviceFee}), 0)`.as(
			"serviceFee",
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
	};
}

/**
 * Aggregates logs into the hourly stats tables for testing purposes.
 * This mimics what the worker does in production.
 */
export async function aggregateLogsForTesting() {
	// Find all distinct project-hour combinations in the logs
	const buckets = await db
		.select({
			projectId: tables.log.projectId,
			hourTimestamp: sql<Date>`date_trunc('hour', ${tables.log.createdAt})`.as(
				"hourTimestamp",
			),
		})
		.from(tables.log)
		.groupBy(
			tables.log.projectId,
			sql`date_trunc('hour', ${tables.log.createdAt})`,
		);

	for (const bucket of buckets) {
		const hourTimestamp = roundToHourStart(new Date(bucket.hourTimestamp));
		const hourEnd = new Date(hourTimestamp.getTime() + 60 * 60 * 1000);
		const projectId = bucket.projectId;

		// Aggregate project hourly stats
		const [projectStats] = await db
			.select(getCommonAggregationFields())
			.from(tables.log)
			.where(
				and(
					sql`${tables.log.projectId} = ${projectId}`,
					gte(tables.log.createdAt, hourTimestamp),
					lt(tables.log.createdAt, hourEnd),
				),
			);

		if (projectStats && projectStats.requestCount > 0) {
			await db
				.insert(projectHourlyStats)
				.values({
					projectId,
					hourTimestamp,
					...projectStats,
				})
				.onConflictDoUpdate({
					target: [
						projectHourlyStats.projectId,
						projectHourlyStats.hourTimestamp,
					],
					set: {
						...projectStats,
						updatedAt: new Date(),
					},
				});
		}

		// Aggregate project hourly model stats
		const modelStats = await db
			.select({
				usedModel: tables.log.usedModel,
				usedProvider: tables.log.usedProvider,
				...getCommonAggregationFields(),
			})
			.from(tables.log)
			.where(
				and(
					sql`${tables.log.projectId} = ${projectId}`,
					gte(tables.log.createdAt, hourTimestamp),
					lt(tables.log.createdAt, hourEnd),
				),
			)
			.groupBy(tables.log.usedModel, tables.log.usedProvider);

		for (const stat of modelStats) {
			const { usedModel, usedProvider, ...statsFields } = stat;
			await db
				.insert(projectHourlyModelStats)
				.values({
					projectId,
					hourTimestamp,
					usedModel,
					usedProvider,
					...statsFields,
				})
				.onConflictDoUpdate({
					target: [
						projectHourlyModelStats.projectId,
						projectHourlyModelStats.hourTimestamp,
						projectHourlyModelStats.usedModel,
						projectHourlyModelStats.usedProvider,
					],
					set: {
						...statsFields,
						updatedAt: new Date(),
					},
				});
		}

		// Aggregate API key hourly stats
		const apiKeyStats = await db
			.select({
				apiKeyId: tables.log.apiKeyId,
				...getCommonAggregationFields(),
			})
			.from(tables.log)
			.where(
				and(
					sql`${tables.log.projectId} = ${projectId}`,
					gte(tables.log.createdAt, hourTimestamp),
					lt(tables.log.createdAt, hourEnd),
				),
			)
			.groupBy(tables.log.apiKeyId);

		for (const stat of apiKeyStats) {
			const { apiKeyId, ...statsFields } = stat;
			await db
				.insert(apiKeyHourlyStats)
				.values({
					apiKeyId,
					projectId,
					hourTimestamp,
					...statsFields,
				})
				.onConflictDoUpdate({
					target: [apiKeyHourlyStats.apiKeyId, apiKeyHourlyStats.hourTimestamp],
					set: {
						...statsFields,
						updatedAt: new Date(),
					},
				});
		}
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
