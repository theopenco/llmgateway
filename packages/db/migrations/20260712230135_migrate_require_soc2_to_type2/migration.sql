-- Custom SQL migration file, put your code below! --

-- Before this change the compliance policy had a single `requireSoc2` flag that
-- accepted a SOC 2 report of any type (Type 1 or Type 2), but the dashboard
-- labelled it "SOC 2 (Type 2)". Existing policies were therefore configured with
-- the intent of requiring Type 2. Preserve that intent: convert every stored
-- `requireSoc2: true` into `requireSoc2Type2: true` and drop the old key. Rows
-- where the flag is absent/false, or the policy is NULL, are left untouched.
UPDATE "organization"
SET "provider_compliance_policy" = (
	(("provider_compliance_policy"::jsonb) - 'requireSoc2')
	|| jsonb_build_object('requireSoc2Type2', true)
)::json
WHERE ("provider_compliance_policy"::jsonb ->> 'requireSoc2') = 'true';
