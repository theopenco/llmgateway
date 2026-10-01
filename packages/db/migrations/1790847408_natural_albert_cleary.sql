ALTER TABLE "user_organization" ADD COLUMN "role_assignment_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Roles a group mapping granted stay revocable; every other role is manual.
UPDATE "user_organization" AS uo
SET "role_assignment_source" = 'sso'
WHERE EXISTS (
	SELECT 1
	FROM "scim_group_member" gm
	INNER JOIN "scim_group" g ON g."id" = gm."scim_group_id"
	INNER JOIN "sso_role_mapping" m
		ON m."organization_id" = g."organization_id"
		AND m."group_name" = g."display_name"
	WHERE gm."user_id" = uo."user_id"
		AND g."organization_id" = uo."organization_id"
		AND m."role" = uo."role"
);
