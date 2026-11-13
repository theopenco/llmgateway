import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { cachedPublicResponse } from "@/lib/public-response-cache.js";
import { createRoute } from "@/utils/create-route.js";

import {
	and,
	db,
	excludeRegionalMappingRows,
	gt,
	gte,
	lt,
	modelHistoryHourly,
	modelProviderMappingHistoryHourly,
	sql,
} from "@llmgateway/db";
import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";
import { FIRST_USAGE_YEAR } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

export const publicUsageReport = new OpenAPIHono<ServerTypes>();

// A year of hourly rows is aggregated, so one caller recomputes a year at most
// every 6 hours and everyone else is served the cached report.
const REPORT_REFRESH_MS = 6 * 60 * 60 * 1000;
const TOP_MODELS = 25;
const TOP_FAMILIES = 10;
const TOP_RISERS = 5;
const RISER_WINDOW_MONTHS = 3;
// A riser must carry at least this share of the recent window's tokens, so a
// model going from a handful of requests to a few hundred does not top the list.
const RISER_MIN_SHARE = 0.005;

const reportSchema = z.object({
	year: z.number(),
	// False while the year is still running; the report then covers January
	// through `throughMonth`.
	complete: z.boolean(),
	throughMonth: z.string().nullable(),
	totals: z.object({
		totalTokens: z.number(),
		totalRequests: z.number(),
		activeModels: z.number(),
		activeProviders: z.number(),
	}),
	months: z.array(
		z.object({
			month: z.string(),
			totalTokens: z.number(),
			totalRequests: z.number(),
			topModelId: z.string().nullable(),
		}),
	),
	models: z.array(
		z.object({
			modelId: z.string(),
			family: z.string(),
			totalTokens: z.number(),
			totalRequests: z.number(),
			sharePercent: z.number(),
			firstActiveMonth: z.string(),
			peakMonth: z.string(),
		}),
	),
	families: z.array(
		z.object({
			family: z.string(),
			totalTokens: z.number(),
			sharePercent: z.number(),
		}),
	),
	providers: z.array(
		z.object({
			providerId: z.string(),
			totalTokens: z.number(),
			totalRequests: z.number(),
			sharePercent: z.number(),
		}),
	),
	risers: z.array(
		z.object({
			modelId: z.string(),
			previousTokens: z.number(),
			recentTokens: z.number(),
			growthPercent: z.number(),
		}),
	),
});

type UsageReport = z.infer<typeof reportSchema>;

const reportRoute = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			year: z.coerce.number().int().min(FIRST_USAGE_YEAR).max(9999).optional(),
		}),
	},
	responses: {
		200: {
			content: { "application/json": { schema: reportSchema } },
			description:
				"Public usage report for one calendar year (UTC): monthly token volume, top models, model families, provider share, and the fastest-growing models.",
		},
		404: { description: "No report exists for that year." },
	},
});

publicUsageReport.openapi(reportRoute, async (c) => {
	const now = new Date();
	const { year = now.getUTCFullYear() } = c.req.valid("query");
	if (year > now.getUTCFullYear()) {
		throw new HTTPException(404, { message: "Report not found" });
	}
	return c.json(
		await cachedPublicResponse(
			`usage-report:${year}`,
			{ refreshAfterMs: REPORT_REFRESH_MS },
			async () => await loadUsageReport(year, new Date()),
		),
		200,
	);
});

function percent(part: number, whole: number): number {
	return whole > 0 ? (part / whole) * 100 : 0;
}

export async function loadUsageReport(
	year: number,
	now: Date,
): Promise<UsageReport> {
	const from = new Date(Date.UTC(year, 0, 1));
	const to = new Date(Date.UTC(year + 1, 0, 1));
	const mh = modelHistoryHourly;
	const mph = modelProviderMappingHistoryHourly;
	const month = sql<string>`to_char(date_trunc('month', ${mh.hourTimestamp}), 'YYYY-MM')`;

	const modelMonthRows = await db
		.select({
			modelId: mh.modelId,
			month,
			totalTokens: sql<string>`COALESCE(SUM(${mh.totalTokens}), 0)`,
			totalRequests: sql<string>`COALESCE(SUM(${mh.logsCount}), 0)`,
		})
		.from(mh)
		// `logs_count > 0` changes no sum; it lets the planner use the partial
		// covering index that skips idle models' zero rows.
		.where(
			and(
				gte(mh.hourTimestamp, from),
				lt(mh.hourTimestamp, to),
				gt(mh.logsCount, 0),
			),
		)
		.groupBy(mh.modelId, month);

	const providerRows = await db
		.select({
			providerId: mph.providerId,
			totalTokens: sql<string>`COALESCE(SUM(${mph.totalTokens}), 0)`,
			totalRequests: sql<string>`COALESCE(SUM(${mph.logsCount}), 0)`,
		})
		.from(mph)
		// The region-less root row already carries a mapping's regional traffic.
		.where(
			and(
				gte(mph.hourTimestamp, from),
				lt(mph.hourTimestamp, to),
				gt(mph.logsCount, 0),
				excludeRegionalMappingRows(mph),
			),
		)
		.groupBy(mph.providerId);

	// Only catalogue models and providers are public; custom org models and the
	// gateway's routing pseudo-models stay out of the report.
	const familyByModel = new Map<string, string>(
		modelDefinitions
			.filter((m) => m.family !== "llmgateway")
			.map((m) => [m.id, m.family]),
	);
	const knownProviderIds = new Set<string>(
		providerDefinitions
			.filter((p) => p.name !== "LLM Gateway")
			.map((p) => p.id),
	);

	interface ModelTotals {
		totalTokens: number;
		totalRequests: number;
		byMonth: Map<string, number>;
	}
	const byModel = new Map<string, ModelTotals>();
	const byMonth = new Map<
		string,
		{ totalTokens: number; totalRequests: number }
	>();
	for (const row of modelMonthRows) {
		if (!familyByModel.has(row.modelId)) {
			continue;
		}
		const tokens = Number(row.totalTokens) || 0;
		const requests = Number(row.totalRequests) || 0;
		if (tokens <= 0) {
			continue;
		}
		const model = byModel.get(row.modelId) ?? {
			totalTokens: 0,
			totalRequests: 0,
			byMonth: new Map<string, number>(),
		};
		model.totalTokens += tokens;
		model.totalRequests += requests;
		model.byMonth.set(row.month, tokens);
		byModel.set(row.modelId, model);
		const bucket = byMonth.get(row.month) ?? {
			totalTokens: 0,
			totalRequests: 0,
		};
		bucket.totalTokens += tokens;
		bucket.totalRequests += requests;
		byMonth.set(row.month, bucket);
	}

	const monthKeys = [...byMonth.keys()].sort();
	let totalTokens = 0;
	let totalRequests = 0;
	for (const bucket of byMonth.values()) {
		totalTokens += bucket.totalTokens;
		totalRequests += bucket.totalRequests;
	}

	const ranked = [...byModel.entries()].sort(
		(a, b) => b[1].totalTokens - a[1].totalTokens,
	);

	const months = monthKeys.map((key) => {
		let topModelId: string | null = null;
		let topTokens = 0;
		for (const [modelId, model] of ranked) {
			const tokens = model.byMonth.get(key) ?? 0;
			if (tokens > topTokens) {
				topTokens = tokens;
				topModelId = modelId;
			}
		}
		const bucket = byMonth.get(key)!;
		return { month: key, ...bucket, topModelId };
	});

	const models = ranked.slice(0, TOP_MODELS).map(([modelId, model]) => {
		const active = [...model.byMonth.entries()].sort((a, b) =>
			a[0].localeCompare(b[0]),
		);
		const peak = active.reduce((best, current) =>
			current[1] > best[1] ? current : best,
		);
		return {
			modelId,
			family: familyByModel.get(modelId)!,
			totalTokens: model.totalTokens,
			totalRequests: model.totalRequests,
			sharePercent: percent(model.totalTokens, totalTokens),
			firstActiveMonth: active[0][0],
			peakMonth: peak[0],
		};
	});

	const familyTotals = new Map<string, number>();
	for (const [modelId, model] of ranked) {
		const family = familyByModel.get(modelId)!;
		familyTotals.set(
			family,
			(familyTotals.get(family) ?? 0) + model.totalTokens,
		);
	}
	const families = [...familyTotals.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, TOP_FAMILIES)
		.map(([family, tokens]) => ({
			family,
			totalTokens: tokens,
			sharePercent: percent(tokens, totalTokens),
		}));

	const publicProviders = providerRows
		.filter((row) => knownProviderIds.has(row.providerId))
		.map((row) => ({
			providerId: row.providerId,
			totalTokens: Number(row.totalTokens) || 0,
			totalRequests: Number(row.totalRequests) || 0,
		}))
		.filter((row) => row.totalTokens > 0)
		.sort((a, b) => b.totalTokens - a.totalTokens);
	const providerTokens = publicProviders.reduce(
		(sum, row) => sum + row.totalTokens,
		0,
	);
	const providers = publicProviders.map((row) => ({
		...row,
		sharePercent: percent(row.totalTokens, providerTokens),
	}));

	// Fastest growing: the most recent months against the same number of months
	// before them.
	const span = Math.min(RISER_WINDOW_MONTHS, Math.floor(monthKeys.length / 2));
	const recentKeys = span > 0 ? monthKeys.slice(-span) : [];
	const previousKeys = span > 0 ? monthKeys.slice(-span * 2, -span) : [];
	const sumMonths = (model: ModelTotals, keys: string[]) =>
		keys.reduce((sum, key) => sum + (model.byMonth.get(key) ?? 0), 0);
	const recentTotal = recentKeys.reduce(
		(sum, key) => sum + byMonth.get(key)!.totalTokens,
		0,
	);
	const risers = ranked
		.map(([modelId, model]) => {
			const previousTokens = sumMonths(model, previousKeys);
			const recentTokens = sumMonths(model, recentKeys);
			return { modelId, previousTokens, recentTokens };
		})
		.filter(
			(row) =>
				row.previousTokens > 0 &&
				row.recentTokens > row.previousTokens &&
				row.recentTokens >= recentTotal * RISER_MIN_SHARE,
		)
		.map((row) => ({
			...row,
			growthPercent:
				((row.recentTokens - row.previousTokens) / row.previousTokens) * 100,
		}))
		.sort((a, b) => b.growthPercent - a.growthPercent)
		.slice(0, TOP_RISERS);

	return {
		year,
		complete: now.getTime() >= to.getTime(),
		throughMonth: monthKeys.at(-1) ?? null,
		totals: {
			totalTokens,
			totalRequests,
			activeModels: byModel.size,
			activeProviders: providers.length,
		},
		months,
		models,
		families,
		providers,
		risers,
	};
}
