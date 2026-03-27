-- Mapping history blended ranking for the last 30 days.
--
-- Purpose:
-- Rank model-provider mappings using a weighted blend of:
-- - price: lower is better
-- - latency: lower is better
-- - throughput: higher is better
--
-- Data source:
-- - model_provider_mapping_history: minute-level aggregated mapping metrics
-- - model_provider_mapping: lookup for current mapping metadata
--
-- Notes:
-- - Uses snake_case column names to match the actual database schema.
-- - Excludes mappings with low sample size via the HAVING clause.
-- - Uses cost_per_1k_tokens_usd as the price signal because it is usually
--   more stable than avg_cost_per_request_usd when request sizes vary.
-- - Latency follows the app's routing logic:
--   prefer total_time_to_first_reasoning_token when present, otherwise
--   fall back to total_time_to_first_token.
-- - The blended score uses min-max normalization per metric so values on
--   different scales can be combined safely.
--
-- Weighting:
-- - 50% price
-- - 25% latency
-- - 25% throughput
--
-- Tuning:
-- - Change interval '30 days' to adjust the lookback window.
-- - Change HAVING sum(mph.logs_count) >= 10 to tighten or loosen the
--   minimum request threshold.
-- - Adjust the weights in the final SELECT to prioritize cheaper, faster,
--   or higher-throughput mappings differently.

with mapping_breakdown as (
	select
		mph.model_provider_mapping_id,
		mph.model_id,
		mph.provider_id,
		mpm.model_name,
		sum(mph.logs_count) as requests,
		sum(mph.errors_count) as errors_count,
		sum(mph.cached_count) as cached_count,
		sum(mph.total_duration) as total_duration_ms,
		sum(mph.total_output_tokens) as total_output_tokens,
		sum(mph.total_tokens) as total_tokens,
		sum(mph.total_time_to_first_token) as total_time_to_first_token_ms,
		sum(mph.total_time_to_first_reasoning_token) as total_time_to_first_reasoning_token_ms,
		sum(mph.total_cost)::numeric as total_cost_usd
	from model_provider_mapping_history mph
	left join model_provider_mapping mpm
		on mpm.id = mph.model_provider_mapping_id
	where mph.minute_timestamp >= now() - interval '30 days'
	group by
		mph.model_provider_mapping_id,
		mph.model_id,
		mph.provider_id,
		mpm.model_name
	having sum(mph.logs_count) >= 10
),
metrics as (
	select
		model_provider_mapping_id,
		model_id,
		provider_id,
		model_name,
		requests,
		errors_count,
		cached_count,
		total_cost_usd,
		case
			when total_time_to_first_reasoning_token_ms > 0 and requests > 0
				then total_time_to_first_reasoning_token_ms::numeric / requests
			when total_time_to_first_token_ms > 0 and requests > 0
				then total_time_to_first_token_ms::numeric / requests
			else null
		end as avg_latency_ms,
		case
			when total_duration_ms > 0
				then total_output_tokens::numeric / total_duration_ms * 1000
			else null
		end as throughput_tokens_per_second,
		case
			when total_tokens > 0
				then total_cost_usd / total_tokens * 1000
			else null
		end as cost_per_1k_tokens_usd
	from mapping_breakdown
),
bounds as (
	select
		min(avg_latency_ms) as min_latency_ms,
		max(avg_latency_ms) as max_latency_ms,
		min(throughput_tokens_per_second) as min_throughput_tps,
		max(throughput_tokens_per_second) as max_throughput_tps,
		min(cost_per_1k_tokens_usd) as min_cost_per_1k_tokens_usd,
		max(cost_per_1k_tokens_usd) as max_cost_per_1k_tokens_usd
	from metrics
)
select
	m.model_provider_mapping_id,
	m.model_id,
	m.provider_id,
	m.model_name,
	m.requests,
	m.errors_count,
	m.cached_count,
	m.total_cost_usd,
	m.cost_per_1k_tokens_usd,
	m.avg_latency_ms,
	m.throughput_tokens_per_second,
	(
		0.25 * coalesce(
			case
				when b.max_throughput_tps > b.min_throughput_tps
					then (m.throughput_tokens_per_second - b.min_throughput_tps)
						/ (b.max_throughput_tps - b.min_throughput_tps)
				else 0.5
			end,
			0
		)
		+
		0.25 * coalesce(
			case
				when b.max_latency_ms > b.min_latency_ms
					then (b.max_latency_ms - m.avg_latency_ms)
						/ (b.max_latency_ms - b.min_latency_ms)
				else 0.5
			end,
			0
		)
		+
		0.50 * coalesce(
			case
				when b.max_cost_per_1k_tokens_usd > b.min_cost_per_1k_tokens_usd
					then (b.max_cost_per_1k_tokens_usd - m.cost_per_1k_tokens_usd)
						/ (b.max_cost_per_1k_tokens_usd - b.min_cost_per_1k_tokens_usd)
				else 0.5
			end,
			0
		)
	) as blended_score
from metrics m
cross join bounds b
order by blended_score desc, m.requests desc;
