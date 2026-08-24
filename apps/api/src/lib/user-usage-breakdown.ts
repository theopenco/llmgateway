import { mapModeSplit, modeSplitFields } from "@/lib/mode-split.js";
import { bucketDate } from "@/utils/timezone.js";

import {
	and,
	apiKeyHourlyStats,
	db,
	eq,
	gte,
	inArray,
	lte,
	sql,
	tables,
} from "@llmgateway/db";

export interface UserUsageRow {
	/** Bucket label produced by `bucketDate` (hour or day, per `isHourly`). */
	date: string;
	userId: string;
	/** `user.name`, falling back to `user.email`, then `"Unknown user"`. */
	name: string;
	requestCount: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cost: number;
	creditsRequestCount: number;
	apiKeysRequestCount: number;
	creditsCost: number;
	apiKeysCost: number;
}

/**
 * Usage per member across a set of projects.
 *
 * Requests are attributed to whoever created the api key that made them
 * (`api_key.created_by`) — the log table has no user column, so this join is the
 * only link between traffic and a person. `end_user_customer` keys are included
 * deliberately: their creator is the member who provisioned the platform key.
 *
 * Shared by the project-scoped `/activity?groupBy=user` and the org-wide
 * `/analytics/activity?groupBy=user` so the two views cannot drift apart.
 */
export async function getUserUsageBreakdown(options: {
	projectIds: string[];
	startDate: Date;
	endDate: Date;
	timeZone: string;
	isHourly?: boolean;
}): Promise<UserUsageRow[]> {
	const {
		projectIds,
		startDate,
		endDate,
		timeZone,
		isHourly = false,
	} = options;

	if (!projectIds.length) {
		return [];
	}

	const rows = await db
		.select({
			date: bucketDate(apiKeyHourlyStats.hourTimestamp, timeZone, isHourly).as(
				"date",
			),
			userId: tables.apiKey.createdBy,
			requestCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
					"requestCount",
				),
			inputTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.inputTokens} AS NUMERIC)), 0)`.as(
					"inputTokens",
				),
			outputTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.outputTokens} AS NUMERIC)), 0)`.as(
					"outputTokens",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
					"totalTokens",
				),
			cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cost} as double precision)), 0)`.as(
				"cost",
			),
			...modeSplitFields(apiKeyHourlyStats),
		})
		.from(apiKeyHourlyStats)
		.innerJoin(tables.apiKey, eq(tables.apiKey.id, apiKeyHourlyStats.apiKeyId))
		.where(
			and(
				inArray(apiKeyHourlyStats.projectId, projectIds),
				inArray(tables.apiKey.keyType, ["user", "end_user_customer"]),
				gte(apiKeyHourlyStats.hourTimestamp, startDate),
				lte(apiKeyHourlyStats.hourTimestamp, endDate),
			),
		)
		.groupBy(sql`1, ${tables.apiKey.createdBy}`)
		.orderBy(sql`1 ASC, ${tables.apiKey.createdBy} ASC`);

	const creatorIds = Array.from(new Set(rows.map((row) => row.userId)));
	const names = new Map(
		creatorIds.length
			? (
					await db
						.select({
							id: tables.user.id,
							name: tables.user.name,
							email: tables.user.email,
						})
						.from(tables.user)
						.where(inArray(tables.user.id, creatorIds))
				).map((u) => [u.id, u.name ?? u.email] as const)
			: [],
	);

	return rows.map((row) => ({
		date: String(row.date),
		userId: row.userId,
		name: names.get(row.userId) ?? "Unknown user",
		requestCount: Number(row.requestCount),
		inputTokens: Number(row.inputTokens),
		outputTokens: Number(row.outputTokens),
		totalTokens: Number(row.totalTokens),
		cost: Number(row.cost),
		...mapModeSplit(row),
	}));
}
