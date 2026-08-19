import {
	and,
	db,
	gte,
	log,
	lt,
	routingElectionHourly,
	routingExclusionHourly,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	ROUTING_EXCLUSION_REASONS,
	ROUTING_SELECTION_REASONS,
} from "@llmgateway/shared/routing-telemetry";

import { excludeRecoveredSameProviderRegionRetry } from "./log-filters.js";
import { formatUTCTimestamp } from "./project-stats-aggregator.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

// Inferred drizzle transaction type, so both aggregations can run against the
// same transaction rather than the pooled connection.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Chunk size for the bulk upserts. Postgres caps a statement at 65535 bind
// parameters and these rows have well under 20 columns, so 1000 stays safe.
const UPSERT_CHUNK_SIZE = 1000;

// `log.usedModel` is stored as `provider/model[:region]`, so the catalogue model
// id has to be recovered from it. Regions are collapsed: exclusions are recorded
// per provider (recordFilteredProvider merges a provider's regional variants),
// so keying either table by region would invent a distinction the source data
// does not carry.
const usedBaseModelSql = sql<string>`split_part(split_part(${log.usedModel}, '/', 2), ':', 1)`;

// routingMetadata is a `json` column, so every operator below needs an explicit
// jsonb cast — `->` on `json` returns `json`, which has no containment or
// array-element support.
const routingMetadataJsonb = sql`(${log.routingMetadata}::jsonb)`;

const selectionReasonSql = sql<string>`coalesce(
	case
		when ${routingMetadataJsonb} ->> 'selectionReason' = any(${sql.raw(
			`array[${ROUTING_SELECTION_REASONS.map((reason) => `'${reason}'`).join(",")}]`,
		)})
		then ${routingMetadataJsonb} ->> 'selectionReason'
	end,
	'unknown'
)`;

// `requestedServiceTier` holds the tier the gateway actually requested upstream,
// which for a coding-plan org may be a default the client never sent.
// `routingMetadata.serviceTierSource` is the only thing that separates the two,
// so the implicit count reads it; a row without the field predates it and counts
// as an explicit request.
const serviceTierSourceSql = sql<
	string | null
>`(${routingMetadataJsonb} ->> 'serviceTierSource')`;
const explicitTierSql = sql<number>`sum(case when ${log.requestedServiceTier} is not null and coalesce(${serviceTierSourceSql}, 'request') = 'request' then 1 else 0 end)::int`;
const implicitTierSql = sql<number>`sum(case when ${log.requestedServiceTier} is not null and ${serviceTierSourceSql} = 'coding-plan-default' then 1 else 0 end)::int`;

function hourWindow(targetHour: Date) {
	const start = new Date(targetHour);
	start.setUTCMinutes(0, 0, 0);
	return {
		start,
		end: new Date(start.getTime() + ONE_HOUR_MS),
		// Raw `sql` templates bind a JS Date as an ISO string with a trailing Z,
		// which never matches a `timestamp without time zone` column. The rest of
		// the worker avoids this by passing UTC strings and casting in SQL; the raw
		// query below has to do the same. The drizzle query builder is unaffected
		// because it applies the column's own typings.
		startUtc: formatUTCTimestamp(start),
	};
}

/**
 * Per (model, provider, selection reason) request counts for one hour.
 *
 * `candidateCount` sums the size of the candidate set each request was elected
 * from, so dividing it by `requestCount` gives the average number of mappings
 * the router actually got to choose between. A model whose candidate set has
 * quietly collapsed to one shows up here as an average of 1 with a selection
 * reason of `single-provider-available`, which is exactly the shape that makes a
 * well-scoring mapping look like it lost.
 */
async function aggregateElections(tx: Tx, targetHour: Date) {
	const { start, end } = hourWindow(targetHour);

	const rows = await tx
		.select({
			modelId: usedBaseModelSql.as("modelId"),
			providerId: log.usedProvider,
			selectionReason: selectionReasonSql.as("selectionReason"),
			requestCount: sql<number>`count(*)::int`.as("requestCount"),
			candidateCount:
				sql<number>`coalesce(sum(coalesce(jsonb_array_length(${routingMetadataJsonb} -> 'availableProviders'), 0)), 0)::int`.as(
					"candidateCount",
				),
			serviceTierExplicitCount: explicitTierSql.as("serviceTierExplicitCount"),
			serviceTierImplicitCount: implicitTierSql.as("serviceTierImplicitCount"),
		})
		.from(log)
		.where(
			and(
				gte(log.createdAt, start),
				lt(log.createdAt, end),
				// Same predicate the mapping and model rollups apply, so a request
				// retried onto the same provider counts as one election here too.
				excludeRecoveredSameProviderRegionRetry(),
			),
		)
		.groupBy(usedBaseModelSql, log.usedProvider, selectionReasonSql);

	const values = rows
		.filter((row) => row.modelId && row.providerId)
		.map((row) => ({ ...row, hourTimestamp: start }));

	for (let i = 0; i < values.length; i += UPSERT_CHUNK_SIZE) {
		const chunk = values.slice(i, i + UPSERT_CHUNK_SIZE);
		await tx
			.insert(routingElectionHourly)
			.values(chunk)
			.onConflictDoUpdate({
				target: [
					routingElectionHourly.hourTimestamp,
					routingElectionHourly.modelId,
					routingElectionHourly.providerId,
					routingElectionHourly.selectionReason,
				],
				set: {
					requestCount: sql`excluded.request_count`,
					candidateCount: sql`excluded.candidate_count`,
					serviceTierExplicitCount: sql`excluded.service_tier_explicit_count`,
					serviceTierImplicitCount: sql`excluded.service_tier_implicit_count`,
					updatedAt: new Date(),
				},
			});
	}

	return values.length;
}

/**
 * Per (model, provider, reason) exclusion counts for one hour, unioned from the
 * three places routing records an exclusion:
 *
 * - `filteredProviders[].codes` — capability, credential and service-tier drops
 * - `contentFilterExcludedProviders[]` — content-filter rerouting
 * - `providerScores[].rate_limited` — RPM-capped mappings
 *
 * The last two already existed in routing metadata, so they are mapped onto
 * exclusion codes here rather than duplicated into filteredProviders by the
 * gateway.
 *
 * Two counts come out of this, and they answer different questions.
 * `excludedCount` is per reason — "how often did this constraint fire" — and
 * the reasons sum to more than the requests when several fire at once.
 * `excludedDecisionCount` counts each request once no matter how many reasons
 * it tripped, and is the only one that can be turned into an eligibility rate.
 */
async function aggregateExclusions(tx: Tx, targetHour: Date) {
	const { start, startUtc } = hourWindow(targetHour);

	const reasonAllowlist = sql.raw(
		`array[${ROUTING_EXCLUSION_REASONS.map((reason) => `'${reason}'`).join(",")}]`,
	);

	// One row per (model, provider, reason) with the exclusion count, plus a
	// separate pass for the candidate denominator. Both are computed in SQL so the
	// worker never materializes per-request rows in memory.
	const rows = await tx.execute<{
		model_id: string | null;
		provider_id: string | null;
		reason: string;
		excluded_count: number;
		candidate_count: number;
		excluded_decision_count: number;
	}>(sql`
			with hour_logs as (
				select
					${log.id} as log_id,
					split_part(split_part(${log.usedModel}, '/', 2), ':', 1) as model_id,
					${log.routingMetadata}::jsonb as metadata
				from ${log}
				where ${log.createdAt} >= ${startUtc}::timestamp
					and ${log.createdAt} < ${startUtc}::timestamp + interval '1 hour'
					and ${log.routingMetadata} is not null
					and ${excludeRecoveredSameProviderRegionRetry()}
			),
			exclusions as (
				-- filteredProviders[].codes: the gateway's own exclusion record
				select
					hour_logs.log_id,
					hour_logs.model_id,
					entry ->> 'providerId' as provider_id,
					case when code = any(${reasonAllowlist}) then code else 'other' end as reason
				from hour_logs
				cross join lateral jsonb_array_elements(
					coalesce(hour_logs.metadata -> 'filteredProviders', '[]'::jsonb)
				) as entry
				cross join lateral jsonb_array_elements_text(
					coalesce(entry -> 'codes', '[]'::jsonb)
				) as code
				union all
				-- content-filter rerouting, recorded in its own metadata field
				select
					hour_logs.log_id,
					hour_logs.model_id,
					provider_id,
					'content_filter' as reason
				from hour_logs
				cross join lateral jsonb_array_elements_text(
					coalesce(hour_logs.metadata -> 'contentFilterExcludedProviders', '[]'::jsonb)
				) as provider_id
				union all
				-- rate-limited mappings, annotated on the score entries
				select
					hour_logs.log_id,
					hour_logs.model_id,
					score ->> 'providerId' as provider_id,
					'rate_limited' as reason
				from hour_logs
				cross join lateral jsonb_array_elements(
					coalesce(hour_logs.metadata -> 'providerScores', '[]'::jsonb)
				) as score
				where (score ->> 'rate_limited')::boolean is true
			),
			-- Every provider this model saw in a routing decision, whether it was
			-- kept or dropped. This is the denominator: without it an exclusion count
			-- cannot be turned into a rate.
			--
			-- Deduplicated per decision, because the branches below overlap: a
			-- rate-limited mapping is annotated on providerScores *and* may still be
			-- listed in availableProviders, and counting it twice would halve its
			-- exclusion rate. providerScores is unioned in because a mapping dropped
			-- for rate limiting is sometimes only ever recorded there — without this
			-- branch it has no denominator at all and every such mapping reports a
			-- flat 100% exclusion rate.
			candidates as (
				select distinct log_id, model_id, provider_id
				from (
					select hour_logs.log_id, hour_logs.model_id, provider_id
					from hour_logs
					cross join lateral jsonb_array_elements_text(
						coalesce(hour_logs.metadata -> 'availableProviders', '[]'::jsonb)
					) as provider_id
					union all
					select hour_logs.log_id, hour_logs.model_id, entry ->> 'providerId' as provider_id
					from hour_logs
					cross join lateral jsonb_array_elements(
						coalesce(hour_logs.metadata -> 'filteredProviders', '[]'::jsonb)
					) as entry
					union all
					select hour_logs.log_id, hour_logs.model_id, provider_id
					from hour_logs
					cross join lateral jsonb_array_elements_text(
						coalesce(hour_logs.metadata -> 'contentFilterExcludedProviders', '[]'::jsonb)
					) as provider_id
					union all
					select hour_logs.log_id, hour_logs.model_id, score ->> 'providerId' as provider_id
					from hour_logs
					cross join lateral jsonb_array_elements(
						coalesce(hour_logs.metadata -> 'providerScores', '[]'::jsonb)
					) as score
				) as all_candidates
			),
			candidate_counts as (
				select model_id, provider_id, count(*)::int as candidate_count
				from candidates
				where provider_id is not null
				group by model_id, provider_id
			),
			exclusion_counts as (
				-- distinct log_id per reason: a mapping listed twice for the same
				-- reason in one decision was still only excluded once.
				select model_id, provider_id, reason, count(distinct log_id)::int as excluded_count
				from exclusions
				where provider_id is not null
				group by model_id, provider_id, reason
			),
			-- Decisions the mapping was dropped from for any reason, counted once
			-- each. This is the eligibility numerator: summing the per-reason counts
			-- above double-counts a decision that fired several reasons at once, and
			-- would report a mapping as never eligible when it in fact served.
			excluded_decision_counts as (
				select model_id, provider_id, count(distinct log_id)::int as excluded_decision_count
				from exclusions
				where provider_id is not null
				group by model_id, provider_id
			)
			select
				exclusion_counts.model_id,
				exclusion_counts.provider_id,
				exclusion_counts.reason,
				exclusion_counts.excluded_count,
				coalesce(
					candidate_counts.candidate_count,
					excluded_decision_counts.excluded_decision_count
				) as candidate_count,
				excluded_decision_counts.excluded_decision_count
			from exclusion_counts
			join excluded_decision_counts
				on excluded_decision_counts.model_id = exclusion_counts.model_id
				and excluded_decision_counts.provider_id = exclusion_counts.provider_id
			left join candidate_counts
				on candidate_counts.model_id = exclusion_counts.model_id
				and candidate_counts.provider_id = exclusion_counts.provider_id
		`);

	const values = rows.rows
		.filter((row) => row.model_id && row.provider_id)
		.map((row) => ({
			hourTimestamp: start,
			modelId: row.model_id as string,
			providerId: row.provider_id as string,
			reason: row.reason,
			excludedCount: Number(row.excluded_count),
			candidateCount: Number(row.candidate_count),
			excludedDecisionCount: Number(row.excluded_decision_count),
		}));

	for (let i = 0; i < values.length; i += UPSERT_CHUNK_SIZE) {
		const chunk = values.slice(i, i + UPSERT_CHUNK_SIZE);
		await tx
			.insert(routingExclusionHourly)
			.values(chunk)
			.onConflictDoUpdate({
				target: [
					routingExclusionHourly.hourTimestamp,
					routingExclusionHourly.modelId,
					routingExclusionHourly.providerId,
					routingExclusionHourly.reason,
				],
				set: {
					excludedCount: sql`excluded.excluded_count`,
					candidateCount: sql`excluded.candidate_count`,
					excludedDecisionCount: sql`excluded.excluded_decision_count`,
					updatedAt: new Date(),
				},
			});
	}

	return values.length;
}

/**
 * Roll up one hour of routing decisions from log.routingMetadata.
 *
 * Reading `log` is deliberate and safe here despite the table's volume: the
 * fields used (routingMetadata, the service-tier columns) survive retention
 * stripping, this runs once per hour over a single hour's rows rather than per
 * dashboard request, and the resulting hourly rows are what the admin dashboard
 * queries. Backfilling an hour whose logs have already been pruned simply
 * produces no rows and leaves any existing ones untouched.
 *
 * Both aggregations share one transaction so the hour lands all-or-nothing.
 * Presence in routing_election_hourly is what tells the backfill an hour is
 * done; if the elections committed on their own and the exclusions then failed,
 * the hour would look complete and its exclusion rows would never be filled in.
 */
export async function calculateRoutingTelemetryForHour(targetHour: Date) {
	const { electionRows, exclusionRows } = await db.transaction(async (tx) => ({
		electionRows: await aggregateElections(tx, targetHour),
		exclusionRows: await aggregateExclusions(tx, targetHour),
	}));

	logger.debug(
		`Recorded routing telemetry for ${hourWindow(targetHour).start.toISOString()}`,
		{ electionRows, exclusionRows },
	);

	return { electionRows, exclusionRows };
}
