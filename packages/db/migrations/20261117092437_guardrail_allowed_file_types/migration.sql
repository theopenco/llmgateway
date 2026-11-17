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
