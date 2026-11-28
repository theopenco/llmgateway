-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "referral_referred_organization_id_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "follow_up_email_organization_id_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "dev_plan_cancellation_feedback_organization_id_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "master_key_token_hash_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "end_customer_project_id_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "chat_plan_cancellation_feedback_organization_id_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "user_project_user_organization_id_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "scim_token_token_hash_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by lounge_point_event_user_id_created_at_idx
DROP INDEX IF EXISTS "lounge_point_event_user_id_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "organization_team_project_team_id_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "email_unsubscribe_email_idx";--> statement-breakpoint
-- migrate:contract not unique, covered by a unique index
DROP INDEX IF EXISTS "prompt_project_id_idx";
