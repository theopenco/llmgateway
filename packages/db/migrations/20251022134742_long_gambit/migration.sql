-- Add billing_email column as nullable first
ALTER TABLE "organization" ADD COLUMN "billing_email" text;

-- Populate billing_email with the email of the first related user (by created_at)
UPDATE "organization" o
SET "billing_email" = (
  SELECT u.email
  FROM "user" u
  INNER JOIN "user_organization" uo ON u.id = uo.user_id
  WHERE uo.organization_id = o.id
  ORDER BY uo.created_at ASC
  LIMIT 1
);

-- Make the column NOT NULL after populating data
ALTER TABLE "organization" ALTER COLUMN "billing_email" SET NOT NULL;