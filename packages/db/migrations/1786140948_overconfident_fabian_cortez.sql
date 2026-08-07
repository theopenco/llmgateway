ALTER TABLE "routing_exclusion_hourly" ADD COLUMN "excluded_decision_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Rows aggregated before this column existed would otherwise sit at 0 and read
-- as "never excluded", i.e. 100% eligible — the exact inverse of the bug this
-- column fixes. The true decision count is not recoverable from this table, so
-- seed each row with its own reason count: the API reduces the column with
-- max() across a mapping-hour's reasons, which makes the seeded value the
-- largest single reason's count. That is a lower bound on decisions excluded,
-- and it is exact whenever one reason dominates the hour. The minutely rollup
-- rewrites the current and previous hour unconditionally, so recent hours are
-- replaced with real counts within minutes; older ones age out of the window.
UPDATE "routing_exclusion_hourly" SET "excluded_decision_count" = "excluded_count";
