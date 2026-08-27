-- Active DevPass organizations grouped by owner email domain.
-- Cancel-at-period-end subscriptions remain active until dev_plan_expires_at.

with active_devpass_orgs as (
	select distinct
		o.id as organization_id,
		lower(split_part(trim(u.email), '@', 2)) as email_domain
	from organization o
	join user_organization uo
		on uo.organization_id = o.id
		and uo.role = 'owner'
	join "user" u on u.id = uo.user_id
	where o.kind = 'devpass'
	  and o.dev_plan <> 'none'
	  and o.dev_plan_stripe_subscription_id is not null
	  and (
		o.dev_plan_expires_at is null
		or o.dev_plan_expires_at > now()
	  )
)
select
	email_domain,
	count(*) as organization_count
from active_devpass_orgs
where email_domain <> ''
group by email_domain
order by organization_count desc, email_domain;

-- Active DevPass organizations sharing the owner email domain of one org.
-- Bind the target DevPass organization id as $1.

with target_domain as (
	select lower(split_part(trim(u.email), '@', 2)) as email_domain
	from organization o
	join user_organization uo
		on uo.organization_id = o.id
		and uo.role = 'owner'
	join "user" u on u.id = uo.user_id
	where o.id = $1
	  and o.kind = 'devpass'
	limit 1
),
active_devpass_orgs as (
	select distinct
		o.id as organization_id,
		lower(split_part(trim(u.email), '@', 2)) as email_domain
	from organization o
	join user_organization uo
		on uo.organization_id = o.id
		and uo.role = 'owner'
	join "user" u on u.id = uo.user_id
	where o.kind = 'devpass'
	  and o.dev_plan <> 'none'
	  and o.dev_plan_stripe_subscription_id is not null
	  and (
		o.dev_plan_expires_at is null
		or o.dev_plan_expires_at > now()
	  )
)
select
	a.email_domain,
	count(*) as organization_count
from active_devpass_orgs a
join target_domain t on t.email_domain = a.email_domain
where a.email_domain <> ''
group by a.email_domain
order by organization_count desc, a.email_domain;
