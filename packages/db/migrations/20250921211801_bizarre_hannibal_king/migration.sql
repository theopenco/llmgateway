CREATE INDEX IF NOT EXISTS "log_project_id_created_at_idx" ON "log" USING btree ("project_id","created_at");
