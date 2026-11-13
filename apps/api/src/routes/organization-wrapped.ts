import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getAdminOrganizationIds } from "@/utils/authorization.js";
import { createRoute } from "@/utils/create-route.js";

import {
	and,
	db,
	gte,
	inArray,
	lt,
	projectHourlyModelStats,
	projectHourlySourceStats,
	projectHourlyStats,
	sql,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const organizationWrapped = new OpenAPIHono<ServerTypes>();

export const FIRST_WRAPPED_YEAR = 2025;
const TOP_MODELS = 5;
const TOP_PROVIDERS = 3;
const TOP_SOURCES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const wrappedSchema = z.object({
	year: z.number(),
	organizationName: z.string(),
	totals: z.object({
		requests: z.number(),
		totalTokens: z.number(),
		inputTokens: z.number(),
		outputTokens: z.number(),
		cachedTokens: z.number(),
		cachedRequests: z.number(),
	}),
	activeDays: z.number(),
	longestStreakDays: z.number(),
	busiestDay: z.object({ date: z.string(), requests: z.number() }).nullable(),
	peakHourUtc: z.number().nullable(),
	months: z.array(
		z.object({
			month: z.string(),
			totalTokens: z.number(),
			requests: z.number(),
		}),
	),
	modelsUsed: z.number(),
	topModels: z.array(
		z.object({
			modelId: z.string(),
			totalTokens: z.number(),
			requests: z.number(),
			sharePercent: z.number(),
		}),
	),
	providersUsed: z.number(),
	topProviders: z.array(
		z.object({
			providerId: z.string(),
			totalTokens: z.number(),
			sharePercent: z.number(),
		}),
	),
	topSources: z.array(z.object({ source: z.string(), requests: z.number() })),
});

type Wrapped = z.infer<typeof wrappedSchema>;

const getWrapped = createRoute({
	method: "get",
	path: "/{id}/wrapped",
	request: {
		params: z.object({ id: z.string() }),
		query: z.object({
			year: z.coerce
				.number()
				.int()
				.min(FIRST_WRAPPED_YEAR)
				.max(9999)
				.optional(),
		}),
	},
	responses: {
		200: {
			content: { "application/json": { schema: wrappedSchema } },
			description:
				"The organization's usage for one calendar year (UTC), summarized for its year-in-review page.",
		},
	},
});

organizationWrapped.openapi(getWrapped, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { id } = c.req.valid("param");
	const now = new Date();
	const { year = now.getUTCFullYear() } = c.req.valid("query");

	// Organization-wide usage: owners and admins only, as project-scoped
	// members must not see projects they were not granted.
	const hasAccess = (await getAdminOrganizationIds(user.id)).includes(id);
	if (!hasAccess) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}
	if (year > now.getUTCFullYear()) {
		throw new HTTPException(404, { message: "Year not found" });
	}

	const organization = await db.query.organization.findFirst({
		where: { id: { eq: id } },
	});
	if (!organization) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	const projects = await db.query.project.findMany({
		where: { organizationId: { eq: id }, status: { ne: "deleted" } },
		columns: { id: true },
	});

	return c.json(
		await loadWrapped(
			organization.name,
			projects.map((project) => project.id),
			year,
		),
		200,
	);
});

/** `provider/model[:region]` → `model`. */
function modelIdOf(usedModel: string): string {
	const slash = usedModel.indexOf("/");
	const model = slash === -1 ? usedModel : usedModel.slice(slash + 1);
	return model.split(":")[0];
}

function percent(part: number, whole: number): number {
	return whole > 0 ? (part / whole) * 100 : 0;
}

function longestStreak(days: string[]): number {
	let longest = 0;
	let current = 0;
	let previous: number | null = null;
	for (const day of days) {
		const time = Date.parse(`${day}T00:00:00Z`);
		current = previous !== null && time - previous === DAY_MS ? current + 1 : 1;
		longest = Math.max(longest, current);
		previous = time;
	}
	return longest;
}

export async function loadWrapped(
	organizationName: string,
	projectIds: string[],
	year: number,
): Promise<Wrapped> {
	const empty: Wrapped = {
		year,
		organizationName,
		totals: {
			requests: 0,
			totalTokens: 0,
			inputTokens: 0,
			outputTokens: 0,
			cachedTokens: 0,
			cachedRequests: 0,
		},
		activeDays: 0,
		longestStreakDays: 0,
		busiestDay: null,
		peakHourUtc: null,
		months: [],
		modelsUsed: 0,
		topModels: [],
		providersUsed: 0,
		topProviders: [],
		topSources: [],
	};
	if (projectIds.length === 0) {
		return empty;
	}

	const from = new Date(Date.UTC(year, 0, 1));
	const to = new Date(Date.UTC(year + 1, 0, 1));
	const phs = projectHourlyStats;
	const phm = projectHourlyModelStats;
	const pss = projectHourlySourceStats;
	const day = sql<string>`to_char(date_trunc('day', ${phs.hourTimestamp}), 'YYYY-MM-DD')`;
	const hour = sql<number>`EXTRACT(HOUR FROM ${phs.hourTimestamp})`;

	const [dayRows, hourRows, modelRows, sourceRows] = await Promise.all([
		db
			.select({
				day,
				requests: sql<string>`COALESCE(SUM(${phs.requestCount}), 0)`,
				cachedRequests: sql<string>`COALESCE(SUM(${phs.cacheCount}), 0)`,
				totalTokens: sql<string>`COALESCE(SUM(${phs.totalTokens}), 0)`,
				inputTokens: sql<string>`COALESCE(SUM(${phs.inputTokens}), 0)`,
				outputTokens: sql<string>`COALESCE(SUM(${phs.outputTokens}), 0)`,
				cachedTokens: sql<string>`COALESCE(SUM(${phs.cachedTokens}), 0)`,
			})
			.from(phs)
			.where(
				and(
					inArray(phs.projectId, projectIds),
					gte(phs.hourTimestamp, from),
					lt(phs.hourTimestamp, to),
				),
			)
			.groupBy(day),
		db
			.select({
				hour,
				requests: sql<string>`COALESCE(SUM(${phs.requestCount}), 0)`,
			})
			.from(phs)
			.where(
				and(
					inArray(phs.projectId, projectIds),
					gte(phs.hourTimestamp, from),
					lt(phs.hourTimestamp, to),
				),
			)
			.groupBy(hour),
		db
			.select({
				usedModel: phm.usedModel,
				usedProvider: phm.usedProvider,
				requests: sql<string>`COALESCE(SUM(${phm.requestCount}), 0)`,
				totalTokens: sql<string>`COALESCE(SUM(${phm.totalTokens}), 0)`,
			})
			.from(phm)
			.where(
				and(
					inArray(phm.projectId, projectIds),
					gte(phm.hourTimestamp, from),
					lt(phm.hourTimestamp, to),
				),
			)
			.groupBy(phm.usedModel, phm.usedProvider),
		db
			.select({
				source: pss.source,
				requests: sql<string>`COALESCE(SUM(${pss.requestCount}), 0)`,
			})
			.from(pss)
			.where(
				and(
					inArray(pss.projectId, projectIds),
					gte(pss.hourTimestamp, from),
					lt(pss.hourTimestamp, to),
				),
			)
			.groupBy(pss.source),
	]);

	const totals = { ...empty.totals };
	const monthTotals = new Map<
		string,
		{ totalTokens: number; requests: number }
	>();
	const activeDays: string[] = [];
	let busiestDay: Wrapped["busiestDay"] = null;
	for (const row of dayRows) {
		const requests = Number(row.requests) || 0;
		if (requests <= 0) {
			continue;
		}
		const tokens = Number(row.totalTokens) || 0;
		totals.requests += requests;
		totals.totalTokens += tokens;
		totals.inputTokens += Number(row.inputTokens) || 0;
		totals.outputTokens += Number(row.outputTokens) || 0;
		totals.cachedTokens += Number(row.cachedTokens) || 0;
		totals.cachedRequests += Number(row.cachedRequests) || 0;
		activeDays.push(row.day);
		if (!busiestDay || requests > busiestDay.requests) {
			busiestDay = { date: row.day, requests };
		}
		const monthKey = row.day.slice(0, 7);
		const month = monthTotals.get(monthKey) ?? { totalTokens: 0, requests: 0 };
		month.totalTokens += tokens;
		month.requests += requests;
		monthTotals.set(monthKey, month);
	}
	activeDays.sort();

	let peakHourUtc: number | null = null;
	let peakRequests = 0;
	for (const row of hourRows) {
		const requests = Number(row.requests) || 0;
		if (requests > peakRequests) {
			peakRequests = requests;
			peakHourUtc = Number(row.hour);
		}
	}

	const modelTotals = new Map<
		string,
		{ totalTokens: number; requests: number }
	>();
	const providerTotals = new Map<string, number>();
	let modelTokens = 0;
	for (const row of modelRows) {
		const requests = Number(row.requests) || 0;
		if (requests <= 0) {
			continue;
		}
		const tokens = Number(row.totalTokens) || 0;
		const modelId = modelIdOf(row.usedModel);
		const model = modelTotals.get(modelId) ?? { totalTokens: 0, requests: 0 };
		model.totalTokens += tokens;
		model.requests += requests;
		modelTotals.set(modelId, model);
		providerTotals.set(
			row.usedProvider,
			(providerTotals.get(row.usedProvider) ?? 0) + tokens,
		);
		modelTokens += tokens;
	}

	return {
		year,
		organizationName,
		totals,
		activeDays: activeDays.length,
		longestStreakDays: longestStreak(activeDays),
		busiestDay,
		peakHourUtc,
		months: [...monthTotals.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([month, value]) => ({ month, ...value })),
		modelsUsed: modelTotals.size,
		topModels: [...modelTotals.entries()]
			.sort((a, b) => b[1].totalTokens - a[1].totalTokens)
			.slice(0, TOP_MODELS)
			.map(([modelId, value]) => ({
				modelId,
				...value,
				sharePercent: percent(value.totalTokens, modelTokens),
			})),
		providersUsed: providerTotals.size,
		topProviders: [...providerTotals.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, TOP_PROVIDERS)
			.map(([providerId, tokens]) => ({
				providerId,
				totalTokens: tokens,
				sharePercent: percent(tokens, modelTokens),
			})),
		topSources: sourceRows
			.map((row) => ({
				source: row.source,
				requests: Number(row.requests) || 0,
			}))
			.filter((row) => row.source !== "" && row.requests > 0)
			.sort((a, b) => b.requests - a.requests)
			.slice(0, TOP_SOURCES),
	};
}
