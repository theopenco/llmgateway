import { HTTPException } from "hono/http-exception";

import {
	and,
	db,
	desc,
	eq,
	gte,
	inArray,
	lt,
	sql,
	tables,
	apiKeyHourlyStats,
	apiKeyHourlyModelStats,
	apiKeyHourlySourceStats,
	projectHourlyStats,
	projectHourlyModelStats,
	projectHourlySourceStats,
} from "@llmgateway/db";
import { models, providers } from "@llmgateway/models";
import { CODING_AGENTS } from "@llmgateway/shared";

import type { AnyColumn, SQL } from "@llmgateway/db";
import type {
	McpUsageInput,
	McpUsageBreakdownInput,
	McpUsageScope,
} from "@llmgateway/shared";

type StatsTable =
	| typeof apiKeyHourlyStats
	| typeof apiKeyHourlyModelStats
	| typeof apiKeyHourlySourceStats
	| typeof projectHourlyStats
	| typeof projectHourlyModelStats
	| typeof projectHourlySourceStats;

function sum(column: AnyColumn) {
	return sql<number>`coalesce(sum(cast(${column} as double precision)), 0)`.mapWith(
		Number,
	);
}

function metrics(table: StatsTable) {
	return {
		requestCount: sum(table.requestCount),
		errorCount: sum(table.errorCount),
		cacheCount: sum(table.cacheCount),
		inputTokens: sum(table.inputTokens),
		outputTokens: sum(table.outputTokens),
		totalTokens: sum(table.totalTokens),
		reasoningTokens: sum(table.reasoningTokens),
		cachedTokens: sum(table.cachedTokens),
		costUsd: sum(table.cost),
		dataStorageCostUsd: sum(table.dataStorageCost),
		creditsCostUsd: sum(table.creditsCost),
		byokCostUsd: sum(table.apiKeysCost),
		discountSavingsUsd: sum(table.discountSavings),
	};
}

function dateRange(input: { from?: string; to?: string }, maxDays = 366) {
	const to = input.to ?? new Date().toISOString().slice(0, 10);
	const end = new Date(`${to}T00:00:00Z`);
	end.setUTCDate(end.getUTCDate() + 1);
	const defaultRangeMs = 30 * 86400000;
	const start = input.from
		? new Date(`${input.from}T00:00:00Z`)
		: new Date(end.getTime() - defaultRangeMs);
	const days = (end.getTime() - start.getTime()) / 86400000;
	if (days < 1 || days > maxDays) {
		throw new HTTPException(400, {
			message: `Date range must be ordered and contain at most ${maxDays} days.`,
		});
	}
	return { from: start.toISOString().slice(0, 10), to, start, end };
}

function scopeFilter(
	table: StatsTable,
	scope: McpUsageScope,
	range: ReturnType<typeof dateRange>,
) {
	let memberFilter: SQL | undefined;
	if (scope.type === "member") {
		if (!scope.userId || !("apiKeyId" in table)) {
			throw new Error(
				"Member analytics require a user and per-key statistics.",
			);
		}
		memberFilter = inArray(
			table.apiKeyId,
			db
				.select({ id: tables.apiKey.id })
				.from(tables.apiKey)
				.where(
					and(
						eq(tables.apiKey.createdBy, scope.userId),
						eq(tables.apiKey.projectId, scope.projectId),
					),
				),
		);
	}
	return and(
		eq(table.projectId, scope.projectId),
		gte(table.hourTimestamp, range.start),
		lt(table.hourTimestamp, range.end),
		memberFilter,
	);
}

function summaryTable(scope: McpUsageScope) {
	return scope.type === "member" ? apiKeyHourlyStats : projectHourlyStats;
}

async function totals(
	scope: McpUsageScope,
	range: ReturnType<typeof dateRange>,
) {
	const table = summaryTable(scope);
	const [row] = await db
		.select({
			...metrics(table),
			updatedAt: sql<
				string | null
			>`to_char(max(${table.updatedAt}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
		})
		.from(table)
		.where(scopeFilter(table, scope, range));
	return row;
}

function breakdownTable(
	scope: McpUsageScope,
	groupBy: McpUsageBreakdownInput["group_by"],
) {
	if (groupBy === "api_key") {
		return {
			table: apiKeyHourlyStats,
			dimension: sql<string>`${apiKeyHourlyStats.apiKeyId}`,
		};
	}
	if (groupBy === "app") {
		const table =
			scope.type === "member"
				? apiKeyHourlySourceStats
				: projectHourlySourceStats;
		// Collapse known aliases before ranking, so one app occupies one row.
		const aliases = CODING_AGENTS.map(
			(agent) =>
				sql`when ${inArray(table.source, agent.xSourceValues)} then ${agent.id}`,
		);
		return {
			table,
			dimension: sql<string>`case ${sql.join(aliases, sql` `)} else ${table.source} end`,
		};
	}
	const table =
		scope.type === "member" ? apiKeyHourlyModelStats : projectHourlyModelStats;
	return {
		table,
		dimension: sql<string>`${groupBy === "provider" ? table.usedProvider : table.usedModel}`,
	};
}

async function rank(
	scope: McpUsageScope,
	range: ReturnType<typeof dateRange>,
	input: McpUsageBreakdownInput,
) {
	const { table, dimension } = breakdownTable(scope, input.group_by);
	const fields = metrics(table);
	const order = {
		requests: fields.requestCount,
		cost: fields.costUsd,
		tokens: fields.totalTokens,
	}[input.sort_by];
	const rows = await db
		.select({ id: dimension, ...fields })
		.from(table)
		.where(scopeFilter(table, scope, range))
		.groupBy(sql`1`)
		.orderBy(desc(order), sql`1 ASC`)
		.limit(input.limit + 1)
		.offset(input.offset);
	const keys =
		input.group_by === "api_key" && rows.length
			? await db.query.apiKey.findMany({
					where: {
						id: { in: rows.map((row) => row.id) },
						projectId: { eq: scope.projectId },
					},
					columns: { id: true, description: true },
				})
			: [];
	return {
		rows: rows.slice(0, input.limit).map((row) => ({
			...row,
			name:
				input.group_by === "provider"
					? (providers.find((provider) => provider.id === row.id)?.name ??
						row.id)
					: input.group_by === "model"
						? (models.find((model) => model.id === row.id)?.name ?? row.id)
						: input.group_by === "app"
							? (CODING_AGENTS.find((agent) => agent.id === row.id)?.label ??
								row.id)
							: (keys.find((key) => key.id === row.id)?.description ?? row.id),
		})),
		hasMore: rows.length > input.limit,
	};
}

async function coverage(
	scope: McpUsageScope,
	range: ReturnType<typeof dateRange>,
	groupBy: McpUsageBreakdownInput["group_by"],
	totalRequestCount: number,
) {
	const { table } = breakdownTable(scope, groupBy);
	const [row] = await db
		.select({ requestCount: sum(table.requestCount) })
		.from(table)
		.where(scopeFilter(table, scope, range));
	return {
		requestCount: row.requestCount,
		totalRequestCount,
		complete: row.requestCount === totalRequestCount,
	};
}

export async function getMcpUsage(scope: McpUsageScope, input: McpUsageInput) {
	const range = dateRange(input, input.granularity === "hour" ? 31 : 366);
	const table = summaryTable(scope);
	const bucket: SQL<string> = sql`to_char(date_trunc(${input.granularity}, ${table.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
	const [total, series, provider, model, app] = await Promise.all([
		totals(scope, range),
		db
			.select({ date: bucket, ...metrics(table) })
			.from(table)
			.where(scopeFilter(table, scope, range))
			.groupBy(sql`1`)
			.orderBy(sql`1`),
		rank(scope, range, {
			...input,
			group_by: "provider",
			sort_by: "requests",
			limit: 1,
			offset: 0,
		}),
		rank(scope, range, {
			...input,
			group_by: "model",
			sort_by: "requests",
			limit: 1,
			offset: 0,
		}),
		rank(scope, range, {
			...input,
			group_by: "app",
			sort_by: "requests",
			limit: 1,
			offset: 0,
		}),
	]);
	const { updatedAt, ...usageTotals } = total;
	return {
		scope,
		from: range.from,
		to: range.to,
		timezone: "UTC" as const,
		currency: "USD" as const,
		updatedAt,
		granularity: input.granularity,
		totals: usageTotals,
		series,
		mostUsedProvider: provider.rows[0] ?? null,
		mostUsedModel: model.rows[0] ?? null,
		mostUsedApp: app.rows[0] ?? null,
		appUsageCoverage: await coverage(scope, range, "app", total.requestCount),
	};
}

export async function getMcpUsageBreakdown(
	scope: McpUsageScope,
	input: McpUsageBreakdownInput,
) {
	const range = dateRange(input);
	const [total, ranking] = await Promise.all([
		totals(scope, range),
		rank(scope, range, input),
	]);
	return {
		scope,
		from: range.from,
		to: range.to,
		timezone: "UTC" as const,
		currency: "USD" as const,
		updatedAt: total.updatedAt,
		groupBy: input.group_by,
		sortBy: input.sort_by,
		rows: ranking.rows,
		pagination: {
			limit: input.limit,
			offset: input.offset,
			hasMore: ranking.hasMore,
		},
		coverage: await coverage(scope, range, input.group_by, total.requestCount),
	};
}
