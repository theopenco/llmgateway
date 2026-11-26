ALTER TABLE "guardrail_config" ADD COLUMN "classifier_model" text DEFAULT 'jev-1.14.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "guardrail_config" ALTER COLUMN "system_rules" SET DEFAULT '{"prompt_injection":{"enabled":true,"action":"block","classifier":false},"jailbreak":{"enabled":true,"action":"block","classifier":false},"pii_detection":{"enabled":true,"action":"redact"},"secrets":{"enabled":true,"action":"block"},"file_types":{"enabled":true,"action":"block"},"document_leakage":{"enabled":false,"action":"warn"},"harmful_content":{"enabled":false,"action":"block","classifier":true}}';--> statement-breakpoint
-- The file rule used to ignore allowed_file_types and always allow these image
-- types. It now enforces the stored list, so keep them allowed on existing
-- configs to avoid blocking requests that passed before.
UPDATE "guardrail_config"
SET "allowed_file_types" = ARRAY(
	SELECT DISTINCT t
	FROM unnest(
		"allowed_file_types" || ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]
	) AS t
	ORDER BY t
)
-- An empty list allows every type and stays empty.
WHERE cardinality("allowed_file_types") > 0
	AND NOT ("allowed_file_types" @> ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]);
