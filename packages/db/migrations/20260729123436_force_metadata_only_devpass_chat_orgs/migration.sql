-- Custom SQL migration file, put your code below! --

-- Data retention is no longer offered on DevPass or Chat: those products never
-- store request/response payloads, and the setting has been removed from their
-- dashboards. Force every existing DevPass/Chat org to metadata-only. Regular
-- PAYG/dashboard organizations (kind = 'default') keep whatever they configured.
UPDATE "organization"
SET "retention_level" = 'none'
WHERE "kind" IN ('devpass', 'chat')
	AND "retention_level" <> 'none';
