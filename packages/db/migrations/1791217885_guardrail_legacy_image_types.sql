-- Image, file and audio parts are now checked against the stored allow-list.
-- Lists saved before that never needed an image entry (the dashboard default
-- had none), so give every list without one the default image types instead
-- of blocking those organizations' vision requests.
UPDATE "guardrail_config"
SET "allowed_file_types" = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'] || "allowed_file_types"
WHERE NOT EXISTS (
	SELECT 1
	FROM unnest("allowed_file_types") AS entry
	WHERE lower(entry) LIKE 'image/%'
		OR lower(ltrim(entry, '.')) IN ('jpg', 'jpeg', 'png', 'gif', 'webp')
);
