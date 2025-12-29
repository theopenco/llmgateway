ALTER TABLE "project" ALTER COLUMN "mode" SET DEFAULT 'hybrid';

-- change all existing projects to hybrid
UPDATE "project" SET "mode" = 'hybrid';
