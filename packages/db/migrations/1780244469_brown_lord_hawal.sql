CREATE INDEX IF NOT EXISTS "log_project_id_session_id_idx" ON "log" ("project_id","session_id","created_at") WHERE session_id IS NOT NULL;
