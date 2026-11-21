import { OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { cachedPublicResponse } from "@/lib/public-response-cache.js";
import { createRoute } from "@/utils/create-route.js";
import { floorToHourStart } from "@/utils/history-window.js";

import {
	and,
	db,
	eq,
	globalModelStats,
	globalSourceStats,
	gte,
	inArray,
	ne,
	projectHourlySourceModelStats,
	sql,
	tables,
} from "@llmgateway/db";
import {
	models as modelDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";
import type { AnyColumn } from "@llmgateway/db";

export const publicRankings = new OpenAPIHono<ServerTypes>();

// Both aggregations cover days of traffic and change slowly, so one caller
// recomputes them at most every 6 hours and everyone else reads the cache.
const REFRESH_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = { "7d": 7, "30d": 30 } as const;
const windowSchema = z.enum(["7d", "30d"]).default("7d").optional();

const TOP_AGENTS = 8;
const TOP_MODELS_PER_AGENT = 5;
// An app's model mix is published only when this many organizations sent
// traffic with its name, so the mix never describes a single customer.
export const MIN_ORGANIZATIONS_PER_AGENT = 5;

const TOP_COST_MODELS = 10;
const MAX_PROVIDERS_PER_MODEL = 6;
// A provider's blended price is shown only with a meaningful sample.
export const MIN_PROVIDER_TOKEN_SHARE = 0.01;

// usedModel is stored as `provider/model[:region]`.
function baseModelSql(column: AnyColumn) {
	return sql<string>`split_part(split_part(${column}, '/', 2), ':', 1)`;
}

function windowStart(window: keyof typeof WINDOW_DAYS): Date {
	const windowMs = WINDOW_DAYS[window] * DAY_MS;
	return floorToHourStart(new Date(Date.now() - windowMs));
}

const knownModels = new Map<string, ModelDefinition>(
	(modelDefinitions as readonly ModelDefinition[]).map((model) => [
		model.id,
		model,
	]),
);

const agentSchema = z.object({
	source: z.string(),
	models: z.array(
		z.object({
			modelId: z.string(),
			// Share of the app's tokens in the window, 0–100.
			sharePercent: z.number(),
		}),
	),
	otherSharePercent: z.number(),
});

const agentsRoute = createRoute({
	method: "get",
	path: "/agents",
	request: { query: z.object({ window: windowSchema }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						window: z.string(),
						agents: z.array(agentSchema),
					}),
				},
			},
			description:
				"The models each top app or coding agent sends its tokens to, as shares of that app's token volume over the window.",
		},
	},
});

publicRankings.openapi(agentsRoute, async (c) => {
	const { window = "7d" } = c.req.valid("query");
	return c.json(
		await cachedPublicResponse(
			`rankings-agents:${window}`,
			{ refreshAfterMs: REFRESH_MS },
			async () => await loadAgentModels(window),
		),
	);
});

export async function loadAgentModels(window: keyof typeof WINDOW_DAYS) {
	const start = windowStart(window);
	const sourceTokens = sql<string>`COALESCE(SUM(CAST(${globalSourceStats.totalTokens} AS NUMERIC)), 0)`;
	// Candidates come from the small daily table; the per-project rollup is
	// then read only for those sources, through its (source, hour) index.
	const candidates = await db
		.select({ source: globalSourceStats.source })
		.from(globalSourceStats)
		.where(
			and(
				ne(globalSourceStats.source, "unknown"),
				gte(globalSourceStats.dayTimestamp, start),
			),
		)
		.groupBy(globalSourceStats.source)
		.orderBy(sql`${sourceTokens} DESC`)
		.limit(TOP_AGENTS * 3);
	const sources = candidates.map((row) => row.source);
	if (sources.length === 0) {
		return { window, agents: [] };
	}

	const stats = projectHourlySourceModelStats;
	const inWindow = and(
		inArray(stats.source, sources),
		gte(stats.hourTimestamp, start),
	);
	const modelId = baseModelSql(stats.usedModel);
	const [organizationRows, modelRows] = await Promise.all([
		db
			.select({
				source: stats.source,
				organizations: sql<string>`COUNT(DISTINCT ${tables.project.organizationId})`,
			})
			.from(stats)
			.innerJoin(tables.project, eq(tables.project.id, stats.projectId))
			.where(inWindow)
			.groupBy(stats.source),
		db
			.select({
				source: stats.source,
				modelId,
				totalTokens: sql<string>`COALESCE(SUM(CAST(${stats.totalTokens} AS NUMERIC)), 0)`,
			})
			.from(stats)
			.where(inWindow)
			.groupBy(stats.source, modelId),
	]);

	const organizationsBySource = new Map(
		organizationRows.map((row) => [row.source, Number(row.organizations) || 0]),
	);
	const bySource = new Map<string, Map<string, Decimal>>();
	for (const row of modelRows) {
		const tokens = new Decimal(row.totalTokens ?? 0);
		if (tokens.lte(0)) {
			continue;
		}
		// Custom and retired ids are folded into "other" rather than published.
		const key = knownModels.has(row.modelId) ? row.modelId : "";
		const models = bySource.get(row.source) ?? new Map<string, Decimal>();
		models.set(key, (models.get(key) ?? new Decimal(0)).plus(tokens));
		bySource.set(row.source, models);
	}

	const agents = [...bySource.entries()]
		.filter(
			([source]) =>
				(organizationsBySource.get(source) ?? 0) >= MIN_ORGANIZATIONS_PER_AGENT,
		)
		.map(([source, models]) => {
			const total = [...models.values()].reduce(
				(sum, tokens) => sum.plus(tokens),
				new Decimal(0),
			);
			const top = [...models.entries()]
				.filter(([id]) => id !== "")
				.sort((a, b) => b[1].comparedTo(a[1]))
				.slice(0, TOP_MODELS_PER_AGENT)
				.map(([id, tokens]) => ({
					modelId: id,
					sharePercent: tokens
						.div(total)
						.times(100)
						.toDecimalPlaces(1)
						.toNumber(),
				}));
			const shown = top.reduce((sum, model) => sum + model.sharePercent, 0);
			return {
				source,
				total,
				models: top,
				otherSharePercent: Math.max(
					0,
					new Decimal(100).minus(shown).toDecimalPlaces(1).toNumber(),
				),
			};
		})
		.filter((agent) => agent.models.length > 0)
		.sort((a, b) => b.total.comparedTo(a.total))
		.slice(0, TOP_AGENTS)
		.map(({ source, models, otherSharePercent }) => ({
			source,
			models,
			otherSharePercent,
		}));

	return { window, agents };
}

const tokenCostSchema = z.object({
	modelId: z.string(),
	providers: z.array(
		z.object({
			providerId: z.string(),
			// Billed cost divided by all tokens (input, cached and output), in
			// USD per million tokens.
			costPerMillionTokens: z.number(),
			// Share of the model's tokens this provider served, 0–100.
			sharePercent: z.number(),
		}),
	),
});

const tokenCostsRoute = createRoute({
	method: "get",
	path: "/token-costs",
	request: { query: z.object({ window: windowSchema }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						window: z.string(),
						models: z.array(tokenCostSchema),
					}),
				},
			},
			description:
				"Blended cost per million tokens for the most-used text models, per provider, from real traffic over the window.",
		},
	},
});

publicRankings.openapi(tokenCostsRoute, async (c) => {
	const { window = "7d" } = c.req.valid("query");
	return c.json(
		await cachedPublicResponse(
			`rankings-token-costs:${window}`,
			{ refreshAfterMs: REFRESH_MS },
			async () => await loadTokenCosts(window),
		),
	);
});

function isTextModel(modelId: string): boolean {
	const model = knownModels.get(modelId);
	if (!model) {
		return false;
	}
	const output: readonly string[] = model.output ?? ["text"];
	return !["image", "video", "audio", "embedding"].some((kind) =>
		output.includes(kind),
	);
}

export async function loadTokenCosts(window: keyof typeof WINDOW_DAYS) {
	const start = new Date(windowStart(window));
	start.setUTCHours(0, 0, 0, 0);
	const stats = globalModelStats;
	const modelId = baseModelSql(stats.usedModel);
	const rows = await db
		.select({
			modelId,
			providerId: stats.usedProvider,
			totalTokens: sql<string>`COALESCE(SUM(CAST(${stats.totalTokens} AS NUMERIC)), 0)`,
			cost: sql<string>`COALESCE(SUM(CAST(CAST(${stats.cost} AS DOUBLE PRECISION) AS NUMERIC)), 0)`,
		})
		.from(stats)
		.where(gte(stats.dayTimestamp, start))
		.groupBy(modelId, stats.usedProvider);

	const byModel = new Map<
		string,
		{
			total: Decimal;
			providers: { id: string; tokens: Decimal; cost: Decimal }[];
		}
	>();
	for (const row of rows) {
		const tokens = new Decimal(row.totalTokens ?? 0);
		if (tokens.lte(0) || !isTextModel(row.modelId)) {
			continue;
		}
		const entry = byModel.get(row.modelId) ?? {
			total: new Decimal(0),
			providers: [],
		};
		entry.total = entry.total.plus(tokens);
		entry.providers.push({
			id: row.providerId,
			tokens,
			cost: new Decimal(row.cost ?? 0),
		});
		byModel.set(row.modelId, entry);
	}

	const models = [...byModel.entries()]
		.sort((a, b) => b[1].total.comparedTo(a[1].total))
		.slice(0, TOP_COST_MODELS)
		.map(([id, entry]) => ({
			modelId: id,
			providers: entry.providers
				.filter((provider) =>
					provider.tokens.div(entry.total).gte(MIN_PROVIDER_TOKEN_SHARE),
				)
				.sort((a, b) => b.tokens.comparedTo(a.tokens))
				.slice(0, MAX_PROVIDERS_PER_MODEL)
				.map((provider) => ({
					providerId: provider.id,
					costPerMillionTokens: provider.cost
						.div(provider.tokens)
						.times(1_000_000)
						.toDecimalPlaces(4)
						.toNumber(),
					sharePercent: provider.tokens
						.div(entry.total)
						.times(100)
						.toDecimalPlaces(1)
						.toNumber(),
				})),
		}))
		.filter((model) => model.providers.length > 0);

	return { window, models };
}
