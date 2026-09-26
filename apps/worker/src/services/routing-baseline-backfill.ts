import {
	computeRoutingBaseline,
	getDynamicRouteBaselineCandidates,
	resolveCatalogueCandidate,
	type RoutingBaselineCandidate,
} from "@llmgateway/actions";
import {
	and,
	db,
	dynamicRoute,
	dynamicRouteVersion,
	eq,
	globalAggregationState,
	gt,
	inArray,
	isNotNull,
	isNull,
	like,
	log,
	or,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	type DynamicRouteGraph,
	parseDynamicRouteModel,
} from "@llmgateway/shared/dynamic-route";
import { DEFAULT_SMART_ROUTING_MODELS } from "@llmgateway/shared/smart-routing";

import {
	formatUTCTimestamp,
	recalculateProjectHourlyRoutingStats,
} from "./project-stats-aggregator.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const BATCH_SIZE = 1000;
const STATE_ID = "routing-baseline-backfill";

export const ROUTING_BASELINE_BACKFILL_DAYS = Number(
	process.env.ROUTING_BASELINE_BACKFILL_DAYS ?? 30,
);

type BackfillRow = Pick<
	typeof log.$inferSelect,
	| "id"
	| "projectId"
	| "organizationId"
	| "requestedModel"
	| "usedModel"
	| "cost"
	| "promptTokens"
	| "completionTokens"
	| "cachedTokens"
	| "reasoningTokens"
	| "cacheWriteTokens"
	| "routingMetadata"
>;

type GraphCache = Map<string, DynamicRouteGraph | null>;

function floorToHour(date: Date): Date {
	return new Date(Math.floor(date.getTime() / ONE_HOUR_MS) * ONE_HOUR_MS);
}

async function loadDynamicRouteGraph(
	projectId: string,
	name: string,
	version: number | undefined,
	cache: GraphCache,
): Promise<DynamicRouteGraph | null> {
	const key = `${projectId}/${name}/${version ?? "published"}`;
	const cached = cache.get(key);
	if (cached !== undefined) {
		return cached;
	}
	const [row] = await db
		.select({ graph: dynamicRouteVersion.graph })
		.from(dynamicRouteVersion)
		.innerJoin(dynamicRoute, eq(dynamicRoute.id, dynamicRouteVersion.routeId))
		.where(
			and(
				eq(dynamicRoute.projectId, projectId),
				eq(dynamicRoute.name, name),
				version === undefined
					? eq(dynamicRouteVersion.id, dynamicRoute.publishedVersionId)
					: eq(dynamicRouteVersion.version, version),
			),
		)
		.limit(1);
	const graph = row?.graph ?? null;
	cache.set(key, graph);
	return graph;
}

/**
 * Reconstructs the candidate set the router had for a historical request.
 * Dynamic routes use the graph version recorded on the log; smart routing
 * uses the recorded candidate list, falling back to the default list that
 * unconfigured `auto` / `smart` requests route across.
 */
async function resolveCandidates(
	row: BackfillRow,
	cache: GraphCache,
): Promise<RoutingBaselineCandidate[]> {
	const dynamicRouteName = parseDynamicRouteModel(row.requestedModel);
	if (dynamicRouteName) {
		const graph = await loadDynamicRouteGraph(
			row.projectId,
			dynamicRouteName,
			row.routingMetadata?.dynamicRoute?.version,
			cache,
		);
		return graph ? getDynamicRouteBaselineCandidates(graph) : [];
	}
	const modelIds =
		row.routingMetadata?.smartRouting?.candidateModels ??
		DEFAULT_SMART_ROUTING_MODELS;
	return modelIds
		.map((modelId) => resolveCatalogueCandidate(modelId))
		.filter((candidate) => candidate !== undefined);
}

/** Prices every routed log row of one hour and refreshes its routing stats. */
async function backfillHour(hour: Date, cache: GraphCache): Promise<number> {
	const hourStart = formatUTCTimestamp(hour);
	const touchedProjects = new Set<string>();
	let updated = 0;
	let afterId: string | undefined;

	for (;;) {
		const rows: BackfillRow[] = await db
			.select({
				id: log.id,
				projectId: log.projectId,
				organizationId: log.organizationId,
				requestedModel: log.requestedModel,
				usedModel: log.usedModel,
				cost: log.cost,
				promptTokens: log.promptTokens,
				completionTokens: log.completionTokens,
				cachedTokens: log.cachedTokens,
				reasoningTokens: log.reasoningTokens,
				cacheWriteTokens: log.cacheWriteTokens,
				routingMetadata: log.routingMetadata,
			})
			.from(log)
			.where(
				and(
					sql`${log.createdAt} >= ${hourStart}::timestamp`,
					sql`${log.createdAt} < ${hourStart}::timestamp + interval '1 hour'`,
					or(
						inArray(log.requestedModel, ["auto", "smart"]),
						like(log.requestedModel, "dynamic/%"),
					),
					isNull(log.routingBaselineCost),
					isNotNull(log.cost),
					sql`${log.cached} is not true`,
					sql`${log.retried} is not true`,
					afterId ? gt(log.id, afterId) : undefined,
				),
			)
			.orderBy(log.id)
			.limit(BATCH_SIZE);

		for (const row of rows) {
			const candidates = await resolveCandidates(row, cache);
			if (candidates.length === 0 || row.cost === null) {
				continue;
			}
			const baseline = await computeRoutingBaseline({
				candidates,
				usage: row,
				actualCost: row.cost,
				actualModel: row.usedModel,
				organizationId: row.organizationId,
			});
			if (!baseline) {
				continue;
			}
			await db
				.update(log)
				.set({
					routingBaselineModel: baseline.model,
					routingBaselineCost: baseline.cost,
				})
				.where(eq(log.id, row.id));
			touchedProjects.add(row.projectId);
			updated++;
		}

		if (rows.length < BATCH_SIZE) {
			break;
		}
		afterId = rows[rows.length - 1].id;
	}

	if (touchedProjects.size > 0) {
		await recalculateProjectHourlyRoutingStats([...touchedProjects], hourStart);
	}
	return updated;
}

/**
 * Backfills routing baselines for the last ROUTING_BASELINE_BACKFILL_DAYS,
 * one hour per call, from the window start up to the hour the backfill first
 * ran (the gateway writes baselines itself from then on). Prices come from
 * the current catalogue. Returns true while hours remain.
 */
export async function runRoutingBaselineBackfillStep(
	now = new Date(),
): Promise<boolean> {
	let state = await db.query.globalAggregationState.findFirst({
		where: { id: STATE_ID },
	});
	if (!state) {
		const targetHour = floorToHour(now);
		const windowMs = ROUTING_BASELINE_BACKFILL_DAYS * 24 * ONE_HOUR_MS;
		await db
			.insert(globalAggregationState)
			.values({
				id: STATE_ID,
				// Exclusive cursor: every hour before it is done.
				lastProcessedHour: new Date(targetHour.getTime() - windowMs),
				targetHour,
			})
			.onConflictDoNothing();
		state = await db.query.globalAggregationState.findFirst({
			where: { id: STATE_ID },
		});
	}

	const hour = state?.lastProcessedHour;
	const targetHour = state?.targetHour;
	if (!hour || !targetHour || hour >= targetHour) {
		return false;
	}

	const updated = await backfillHour(hour, new Map());
	const nextHour = new Date(hour.getTime() + ONE_HOUR_MS);
	await db
		.update(globalAggregationState)
		.set({ lastProcessedHour: nextHour })
		.where(eq(globalAggregationState.id, STATE_ID));

	if (updated > 0) {
		logger.info("Backfilled routing baselines", {
			hour: hour.toISOString(),
			updated,
		});
	}
	return nextHour < targetHour;
}
