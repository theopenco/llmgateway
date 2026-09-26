import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	eachDay,
	MAX_ORG_ACTIVITY_RANGE_DAYS,
	rangeDaysInclusive,
} from "@/lib/date-range.js";
import { bucketDate } from "@/utils/timezone.js";

import {
	and,
	db,
	desc,
	eq,
	gte,
	inArray,
	lte,
	projectHourlyRoutingStats,
	sql,
	tables,
} from "@llmgateway/db";

const routingSavingsTotalsSchema = z.object({
	requestCount: z.number(),
	cost: z.number(),
	baselineCost: z.number(),
	savings: z.number(),
});

export const routingSavingsSchema = z.object({
	totals: routingSavingsTotalsSchema,
	routes: z.array(
		routingSavingsTotalsSchema.extend({
			projectId: z.string(),
			projectName: z.string(),
			routeKey: z.string(),
		}),
	),
	daily: z.array(
		z.object({
			date: z.string(),
			cost: z.number(),
			baselineCost: z.number(),
		}),
	),
});

export type RoutingSavings = z.infer<typeof routingSavingsSchema>;

const costSum = sql<number>`COALESCE(SUM(cast(${projectHourlyRoutingStats.cost} as double precision)), 0)`;
const baselineCostSum = sql<number>`COALESCE(SUM(cast(${projectHourlyRoutingStats.baselineCost} as double precision)), 0)`;
const requestCountSum = sql<number>`COALESCE(SUM(${projectHourlyRoutingStats.requestCount}), 0)`;

function totalsOf(row: {
	requestCount: number;
	cost: number;
	baselineCost: number;
}) {
	const cost = Number(row.cost);
	const baselineCost = Number(row.baselineCost);
	return {
		requestCount: Number(row.requestCount),
		cost,
		baselineCost,
		savings: Decimal.max(0, new Decimal(baselineCost).minus(cost)).toNumber(),
	};
}

/**
 * Routed-request spend vs. the priciest-candidate baseline for the given
 * projects, per route and per day, read from project_hourly_routing_stats.
 */
export async function getRoutingSavings({
	projectIds,
	startDate,
	endDate,
	fromStr,
	toStr,
	timeZone,
}: {
	projectIds: string[];
	startDate: Date;
	endDate: Date;
	fromStr: string;
	toStr: string;
	timeZone: string;
}): Promise<RoutingSavings> {
	if (rangeDaysInclusive(fromStr, toStr) > MAX_ORG_ACTIVITY_RANGE_DAYS) {
		throw new HTTPException(400, {
			message: `Date range too large (max ${MAX_ORG_ACTIVITY_RANGE_DAYS} days)`,
		});
	}
	const days = eachDay(fromStr, toStr);
	if (projectIds.length === 0) {
		return {
			totals: { requestCount: 0, cost: 0, baselineCost: 0, savings: 0 },
			routes: [],
			daily: days.map((date) => ({ date, cost: 0, baselineCost: 0 })),
		};
	}

	const where = and(
		inArray(projectHourlyRoutingStats.projectId, projectIds),
		gte(projectHourlyRoutingStats.hourTimestamp, startDate),
		lte(projectHourlyRoutingStats.hourTimestamp, endDate),
	);

	const routeRows = await db
		.select({
			projectId: projectHourlyRoutingStats.projectId,
			projectName: tables.project.name,
			routeKey: projectHourlyRoutingStats.routeKey,
			requestCount: requestCountSum.as("requestCount"),
			cost: costSum.as("cost"),
			baselineCost: baselineCostSum.as("baselineCost"),
		})
		.from(projectHourlyRoutingStats)
		.innerJoin(
			tables.project,
			eq(tables.project.id, projectHourlyRoutingStats.projectId),
		)
		.where(where)
		.groupBy(
			projectHourlyRoutingStats.projectId,
			tables.project.name,
			projectHourlyRoutingStats.routeKey,
		)
		.orderBy(desc(sql`${baselineCostSum} - ${costSum}`));

	const [totalsRow] = await db
		.select({
			requestCount: requestCountSum.as("requestCount"),
			cost: costSum.as("cost"),
			baselineCost: baselineCostSum.as("baselineCost"),
		})
		.from(projectHourlyRoutingStats)
		.where(where);

	const dailyRows = await db
		.select({
			date: bucketDate(
				projectHourlyRoutingStats.hourTimestamp,
				timeZone,
				false,
			).as("date"),
			cost: costSum.as("cost"),
			baselineCost: baselineCostSum.as("baselineCost"),
		})
		.from(projectHourlyRoutingStats)
		.where(where)
		.groupBy(sql`1`);
	const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));

	const routes = routeRows.map((row) => ({
		projectId: row.projectId,
		projectName: row.projectName,
		routeKey: row.routeKey,
		...totalsOf(row),
	}));

	return {
		totals: totalsOf(totalsRow),
		routes,
		daily: days.map((date) => {
			const row = dailyByDate.get(date);
			return {
				date,
				cost: Number(row?.cost ?? 0),
				baselineCost: Number(row?.baselineCost ?? 0),
			};
		}),
	};
}
