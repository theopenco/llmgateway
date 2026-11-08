import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	fetchOfficialStatus,
	OFFICIAL_INDICATORS,
	type OfficialStatus,
} from "@/lib/official-status.js";
import { cachedPublicResponse } from "@/lib/public-response-cache.js";
import { createRoute } from "@/utils/create-route.js";

import {
	and,
	db,
	eq,
	excludeRegionalMappingRows,
	gt,
	gte,
	sql,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	isStealthProvider,
	providers as providerDefinitions,
	type ProviderDefinition,
} from "@llmgateway/models";
import { deriveStabilityMetrics } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

export const publicProvidersStatus = new OpenAPIHono<ServerTypes>();

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const LAST_24H_SPAN_MS = 23 * HOUR_MS;
export const STATUS_HISTORY_DAYS = 90;
const OFFICIAL_REFRESH_MS = 2 * 60 * 1000;
const HISTORY_REFRESH_MS = 5 * 60 * 1000;
const OFFICIAL_FETCH_CONCURRENCY = 6;
const LAST_GOOD_MAX_AGE_MS = 30 * 60 * 1000;

const indicatorSchema = z.enum(OFFICIAL_INDICATORS);

const officialSummarySchema = z.object({
	indicator: indicatorSchema,
	description: z.string(),
});

const officialSchema = officialSummarySchema.extend({
	components: z.array(z.object({ name: z.string(), status: z.string() })),
	incidents: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			status: z.string(),
			impact: indicatorSchema,
			createdAt: z.string(),
			resolvedAt: z.string().nullable(),
			url: z.string(),
		}),
	),
});

const officialStateSchema = z.enum(["ok", "unsupported", "unavailable"]);

const measuredSchema = z.object({
	requestCount: z.number(),
	errorsCount: z.number(),
	uptime: z.number().nullable(),
});

const daySchema = measuredSchema.extend({ date: z.string() });

/** Catalogue providers that get a public status page. */
export function resetLastGoodOfficialStatus() {
	lastGoodOfficial.clear();
}

export function statusPageProviders(): ProviderDefinition[] {
	return providerDefinitions.filter(
		(provider) =>
			provider.id !== "llmgateway" &&
			provider.id !== "custom" &&
			!isStealthProvider(provider),
	);
}

function findStatusPageProvider(
	providerId: string,
): ProviderDefinition | undefined {
	return statusPageProviders().find((provider) => provider.id === providerId);
}

type OfficialResult =
	| { state: "ok"; official: OfficialStatus }
	| { state: "unsupported" | "unavailable"; official: null };

const lastGoodOfficial = new Map<
	string,
	{ result: OfficialResult; at: number }
>();

/**
 * A transient failure is cached like any other result, so a provider whose
 * page is down costs one fetch per refresh interval rather than a slow cold
 * path on every request. Within LAST_GOOD_MAX_AGE_MS of a successful read the
 * last good status is served instead of "unavailable", so one timeout does not
 * blank the page.
 */
async function loadOfficial(
	provider: ProviderDefinition,
): Promise<OfficialResult> {
	const url = provider.statusPageUrl;
	if (!url) {
		return { state: "unsupported", official: null };
	}
	return await cachedPublicResponse<OfficialResult>(
		`provider-official-status:${url}`,
		{ refreshAfterMs: OFFICIAL_REFRESH_MS },
		async () => {
			try {
				const official = await fetchOfficialStatus(url);
				const result: OfficialResult = official
					? { state: "ok", official }
					: { state: "unsupported", official: null };
				lastGoodOfficial.set(url, { result, at: Date.now() });
				return result;
			} catch (error) {
				logger.warn("Official status page unavailable", {
					statusPageUrl: url,
					error: error instanceof Error ? error.message : String(error),
				});
				const lastGood = lastGoodOfficial.get(url);
				if (lastGood && Date.now() - lastGood.at <= LAST_GOOD_MAX_AGE_MS) {
					return lastGood.result;
				}
				return { state: "unavailable", official: null };
			}
		},
	);
}

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await fn(items[index]);
			}
		},
	);
	await Promise.all(workers);
	return results;
}

function utcDayStart(date: Date): Date {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
}

/**
 * Daily and last-24h stability of platform-credential traffic. BYOK requests
 * are excluded: their failures reflect the customer's key, not the provider.
 */
export async function loadMeasuredHistory(providerId: string, now: Date) {
	const today = utcDayStart(now);
	const historySpanMs = (STATUS_HISTORY_DAYS - 1) * DAY_MS;
	const from = new Date(today.getTime() - historySpanMs);
	const last24hFrom = last24hStart(now);
	const mph = tables.modelProviderMappingHistoryHourly;
	const day = sql<string>`to_char(date_trunc('day', ${mph.hourTimestamp}), 'YYYY-MM-DD')`;
	const inLast24h = gte(mph.hourTimestamp, last24hFrom);

	const rows = await db
		.select({
			date: day,
			logsCount: sql<string>`COALESCE(SUM(${mph.logsCount}), 0)`,
			clientErrorsCount: sql<string>`COALESCE(SUM(${mph.clientErrorsCount}), 0)`,
			gatewayErrorsCount: sql<string>`COALESCE(SUM(${mph.gatewayErrorsCount}), 0)`,
			upstreamErrorsCount: sql<string>`COALESCE(SUM(${mph.upstreamErrorsCount}), 0)`,
			last24hLogsCount: sql<string>`COALESCE(SUM(${mph.logsCount}) FILTER (WHERE ${inLast24h}), 0)`,
			last24hClientErrorsCount: sql<string>`COALESCE(SUM(${mph.clientErrorsCount}) FILTER (WHERE ${inLast24h}), 0)`,
			last24hGatewayErrorsCount: sql<string>`COALESCE(SUM(${mph.gatewayErrorsCount}) FILTER (WHERE ${inLast24h}), 0)`,
			last24hUpstreamErrorsCount: sql<string>`COALESCE(SUM(${mph.upstreamErrorsCount}) FILTER (WHERE ${inLast24h}), 0)`,
		})
		.from(mph)
		.where(
			and(
				eq(mph.providerId, providerId),
				gte(mph.hourTimestamp, from),
				gt(mph.logsCount, 0),
				eq(mph.usedMode, "credits"),
				excludeRegionalMappingRows(mph),
			),
		)
		.groupBy(day);

	const byDate = new Map(rows.map((row) => [row.date, row]));
	const sums = { logs: 0, client: 0, gateway: 0, upstream: 0 };
	const last24h = { logs: 0, client: 0, gateway: 0, upstream: 0 };
	const days = Array.from({ length: STATUS_HISTORY_DAYS }, (_, index) => {
		const offsetMs = index * DAY_MS;
		const date = new Date(from.getTime() + offsetMs).toISOString().slice(0, 10);
		const row = byDate.get(date);
		const counts = {
			logsCount: Number(row?.logsCount ?? 0),
			clientErrorsCount: Number(row?.clientErrorsCount ?? 0),
			gatewayErrorsCount: Number(row?.gatewayErrorsCount ?? 0),
			upstreamErrorsCount: Number(row?.upstreamErrorsCount ?? 0),
		};
		sums.logs += counts.logsCount;
		sums.client += counts.clientErrorsCount;
		sums.gateway += counts.gatewayErrorsCount;
		sums.upstream += counts.upstreamErrorsCount;
		last24h.logs += Number(row?.last24hLogsCount ?? 0);
		last24h.client += Number(row?.last24hClientErrorsCount ?? 0);
		last24h.gateway += Number(row?.last24hGatewayErrorsCount ?? 0);
		last24h.upstream += Number(row?.last24hUpstreamErrorsCount ?? 0);
		const { requestCount, errorsCount, uptime } =
			deriveStabilityMetrics(counts);
		return { date, requestCount, errorsCount, uptime };
	});

	const toMeasured = (totals: typeof sums) => {
		const { requestCount, errorsCount, uptime } = deriveStabilityMetrics({
			logsCount: totals.logs,
			clientErrorsCount: totals.client,
			gatewayErrorsCount: totals.gateway,
			upstreamErrorsCount: totals.upstream,
		});
		return { requestCount, errorsCount, uptime };
	};

	return {
		days,
		last24h: toMeasured(last24h),
		last90d: toMeasured(sums),
	};
}

function last24hStart(now: Date): Date {
	const currentHourMs = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
	return new Date(currentHourMs - LAST_24H_SPAN_MS);
}

async function loadLast24hByProvider(now: Date) {
	const mph = tables.modelProviderMappingHistoryHourly;
	const rows = await db
		.select({
			providerId: mph.providerId,
			logsCount: sql<string>`COALESCE(SUM(${mph.logsCount}), 0)`,
			clientErrorsCount: sql<string>`COALESCE(SUM(${mph.clientErrorsCount}), 0)`,
			gatewayErrorsCount: sql<string>`COALESCE(SUM(${mph.gatewayErrorsCount}), 0)`,
			upstreamErrorsCount: sql<string>`COALESCE(SUM(${mph.upstreamErrorsCount}), 0)`,
		})
		.from(mph)
		.where(
			and(
				gte(mph.hourTimestamp, last24hStart(now)),
				gt(mph.logsCount, 0),
				eq(mph.usedMode, "credits"),
				excludeRegionalMappingRows(mph),
			),
		)
		.groupBy(mph.providerId);
	return new Map(
		rows.map((row) => {
			const { requestCount, errorsCount, uptime } = deriveStabilityMetrics({
				logsCount: Number(row.logsCount),
				clientErrorsCount: Number(row.clientErrorsCount),
				gatewayErrorsCount: Number(row.gatewayErrorsCount),
				upstreamErrorsCount: Number(row.upstreamErrorsCount),
			});
			return [row.providerId, { requestCount, errorsCount, uptime }];
		}),
	);
}

const listRoute = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						providers: z.array(
							z.object({
								providerId: z.string(),
								statusPageUrl: z.string().nullable(),
								officialState: officialStateSchema,
								official: officialSummarySchema.nullable(),
								last24h: measuredSchema,
							}),
						),
					}),
				},
			},
			description:
				"Current official status and last-24h measured uptime for every provider with a public status page.",
		},
	},
});

publicProvidersStatus.openapi(listRoute, async (c) => {
	return c.json(
		await cachedPublicResponse(
			"provider-status-index",
			{ refreshAfterMs: OFFICIAL_REFRESH_MS },
			loadStatusIndex,
		),
	);
});

async function loadStatusIndex() {
	const measuredById = await loadLast24hByProvider(new Date());
	const providers = await mapWithConcurrency(
		statusPageProviders(),
		OFFICIAL_FETCH_CONCURRENCY,
		async (provider) => {
			const { state, official } = await loadOfficial(provider);
			return {
				providerId: provider.id,
				statusPageUrl: provider.statusPageUrl ?? null,
				officialState: state,
				official: official
					? {
							indicator: official.indicator,
							description: official.description,
						}
					: null,
				last24h: measuredById.get(provider.id) ?? {
					requestCount: 0,
					errorsCount: 0,
					uptime: null,
				},
			};
		},
	);
	return { providers };
}

const detailRoute = createRoute({
	method: "get",
	path: "/{providerId}",
	request: {
		params: z.object({ providerId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						providerId: z.string(),
						statusPageUrl: z.string().nullable(),
						officialState: officialStateSchema,
						official: officialSchema.nullable(),
						measured: z.object({
							days: z.array(daySchema),
							last24h: measuredSchema,
							last90d: measuredSchema,
						}),
					}),
				},
			},
			description:
				"Official status, incidents, and 90 days of measured uptime for one provider.",
		},
		404: {
			description: "Unknown provider.",
		},
	},
});

publicProvidersStatus.openapi(detailRoute, async (c) => {
	const { providerId } = c.req.valid("param");
	const provider = findStatusPageProvider(providerId);
	if (!provider) {
		throw new HTTPException(404, { message: "Provider not found" });
	}
	const [official, measured] = await Promise.all([
		loadOfficial(provider),
		cachedPublicResponse(
			`provider-status-history:${provider.id}`,
			{ refreshAfterMs: HISTORY_REFRESH_MS },
			async () => await loadMeasuredHistory(provider.id, new Date()),
		),
	]);
	return c.json({
		providerId: provider.id,
		statusPageUrl: provider.statusPageUrl ?? null,
		officialState: official.state,
		official: official.official,
		measured,
	});
});
