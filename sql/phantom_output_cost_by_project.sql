-- Phantom output cost audit, scoped to one account's projects.
--
-- Purpose:
-- Find log rows whose billed output cost is far above what the recorded
-- completion tokens would cost at the served service tier's output rate —
-- "cost without tokens" rows, e.g. interrupted streams that were billed on
-- an estimated output count that was never written back to
-- completion_tokens.
--
-- Fill in before running:
-- - the account email in the proj CTE (and the org kind if not devpass)
-- - used_model and the per-token output rates in the tier CASE; the rates
--   below are for openai/gpt-5.6-sol (flex $15/M, priority $60/M,
--   standard $30/M)
-- - the created_at lower bound
-- - the timezone offset in created_at_local (set to the reporter's local
--   timezone so rows line up with their screenshots/reports)
--
-- Performance:
-- - proj is MATERIALIZED so resolving the project ids is the first node of
--   the query plan; the lateral join then probes a project_id-leading log
--   index (log_project_id_created_at_idx or log_project_id_used_model_idx)
--   once per project instead of hash-joining against a scan of log.
-- - Keep the created_at lower bound so the index prunes by time as well
--   (retention pruning removes very old rows anyway).
--
-- Reading the results:
-- - The 1.6x headroom keeps legitimate rows out: org discounts only lower
--   real costs, and the long-context pricing tier tops out at 1.5x the base
--   output rate (pricing_tier is selected so those stand out if present).
-- - Suspect rows show large output_cost with small/zero completion_tokens,
--   typically canceled = true or an error-ish unified_finish_reason, and
--   estimated_cost = true.
-- - excess_output_cost is the per-row over-billed amount; the second query
--   totals it for a refund figure.

with proj as materialized (
	select p.id
	from "user" u
	join user_organization uo on uo.user_id = u.id
	join organization o on o.id = uo.organization_id
	join project p on p.organization_id = o.id
	where u.email = 'customer@example.com'
	  and o.kind = 'devpass'
)
select
	l.id,
	l.created_at,
	l.created_at + interval '9 hours' as created_at_local,
	l.used_service_tier,
	l.pricing_tier,
	l.unified_finish_reason,
	l.canceled,
	l.streamed,
	l.estimated_cost,
	l.prompt_tokens,
	l.completion_tokens,
	l.reasoning_tokens,
	round(l.output_cost::numeric, 6) as output_cost,
	round(
		(coalesce(l.completion_tokens, '0')::numeric * l.output_rate)::numeric,
		6
	) as expected_output_cost,
	round(
		(
			l.output_cost::numeric
			- coalesce(l.completion_tokens, '0')::numeric * l.output_rate
		)::numeric,
		6
	) as excess_output_cost
from proj
cross join lateral (
	select
		ll.*,
		case ll.used_service_tier
			when 'flex' then 0.000015
			when 'priority' then 0.00006
			else 0.00003
		end as output_rate
	from log ll
	where ll.project_id = proj.id
	  and ll.created_at >= '2026-08-01'
	  and ll.used_model = 'openai/gpt-5.6-sol'
	  and ll.output_cost is not null
	  and ll.output_cost > 0
) l
where l.output_cost::numeric
	> coalesce(l.completion_tokens, '0')::numeric * l.output_rate * 1.6
order by l.created_at;

-- Totals over the same phantom rows (count + refund amount).

with proj as materialized (
	select p.id
	from "user" u
	join user_organization uo on uo.user_id = u.id
	join organization o on o.id = uo.organization_id
	join project p on p.organization_id = o.id
	where u.email = 'customer@example.com'
	  and o.kind = 'devpass'
)
select
	count(*) as phantom_rows,
	round(
		sum(
			l.output_cost::numeric
			- coalesce(l.completion_tokens, '0')::numeric * l.output_rate
		)::numeric,
		4
	) as total_excess_output_cost
from proj
cross join lateral (
	select
		ll.output_cost,
		ll.completion_tokens,
		case ll.used_service_tier
			when 'flex' then 0.000015
			when 'priority' then 0.00006
			else 0.00003
		end as output_rate
	from log ll
	where ll.project_id = proj.id
	  and ll.created_at >= '2026-08-01'
	  and ll.used_model = 'openai/gpt-5.6-sol'
	  and ll.output_cost is not null
	  and ll.output_cost > 0
) l
where l.output_cost::numeric
	> coalesce(l.completion_tokens, '0')::numeric * l.output_rate * 1.6;
