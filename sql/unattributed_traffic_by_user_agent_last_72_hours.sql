-- Unattributed gateway traffic grouped by user agent, last 72 hours.
--
-- Purpose:
-- Find the traffic we failed to attribute to a source, bucketed by the
-- User-Agent that sent it. Rows with a populated user_agent but a null
-- source are a direct worklist of UA patterns worth teaching the gateway
-- to recognize.
--
-- Data source:
-- - log: per-request rows. This is one of the few questions that genuinely
--   cannot be answered from the hourly aggregation tables: they carry
--   `source` but not `user_agent`.
--
-- Notes:
-- - Uses snake_case column names to match the actual database schema.
-- - log.source is derived in apps/gateway/src/chat/chat.ts: the x-source
--   header first, then coding-agent detection from the User-Agent, then
--   X-Title, then HTTP-Referer. A null source means every one of those
--   missed.
-- - Organizations with data retention disabled prune their log rows, so
--   their traffic is invisible here and the absolute counts read low.
-- - api_origin is the gateway API surface the request came in through
--   (chat-completions, messages, responses, ai-sdk, embeddings, images,
--   videos, moderations, ocr, speech, transcriptions, rerank). It is null
--   on rows written before the column existed, so never filter on it
--   without allowing for nulls.
--
-- Tuning:
-- - Change interval '72 hours' to adjust the lookback window.
-- - Add `and l.api_origin in ('chat-completions', 'messages', 'responses',
--   'ai-sdk')` to narrow to the conversational surfaces where a coding
--   agent would show up.
-- - Join project -> organization and filter on organization.kind to exclude
--   DevPass or Chat traffic.

with unattributed as (
	select
		coalesce(nullif(l.user_agent, ''), '(no user-agent)') as user_agent,
		coalesce(l.api_origin, '(pre-column)') as api_origin,
		l.organization_id,
		l.project_id,
		l.api_key_id,
		l.cost,
		l.created_at
	from log l
	where l.created_at >= now() - interval '72 hours'
		and (l.source is null or l.source = '')
)
select
	user_agent,
	split_part(user_agent, '/', 1) as ua_product,
	count(*) as requests,
	count(distinct organization_id) as orgs,
	count(distinct project_id) as projects,
	count(distinct api_key_id) as api_keys,
	count(distinct api_origin) as api_origins,
	sum(cost)::numeric as total_cost_usd,
	min(created_at) as first_seen,
	max(created_at) as last_seen
from unattributed
group by user_agent
order by requests desc
limit 100;
