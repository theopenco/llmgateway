-- Operator-run backfill; installing this file does not update logs.
-- See cleanup-log-routing-metadata.md before calling the procedure.
CREATE SCHEMA IF NOT EXISTS maintenance;

CREATE TABLE IF NOT EXISTS maintenance.log_routing_metadata_cleanup (
	singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
	cutoff timestamp NOT NULL,
	last_id text NOT NULL DEFAULT '',
	stop_id text NOT NULL,
	scanned_rows bigint NOT NULL DEFAULT 0,
	cleared_rows bigint NOT NULL DEFAULT 0,
	completed boolean NOT NULL DEFAULT false,
	updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE PROCEDURE maintenance.cleanup_log_routing_metadata(
	batch_size integer DEFAULT 1000,
	pause_seconds double precision DEFAULT 1,
	max_batches integer DEFAULT 1000
)
LANGUAGE plpgsql
AS $$
DECLARE
	progress maintenance.log_routing_metadata_cleanup%ROWTYPE;
	batch_ids text[];
	cleared integer;
BEGIN
	IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 10000
		OR pause_seconds IS NULL OR pause_seconds NOT BETWEEN 0 AND 60
		OR max_batches IS NULL OR max_batches < 1 THEN
		RAISE EXCEPTION 'Use batch_size 1..10000, pause_seconds 0..60, and max_batches >= 1';
	END IF;

	-- Freeze the cutoff and upper bound on the first call, including on resume.
	INSERT INTO maintenance.log_routing_metadata_cleanup (cutoff, stop_id)
	VALUES (
		(clock_timestamp() AT TIME ZONE 'UTC') - interval '30 days',
		coalesce((SELECT id FROM public.log ORDER BY id DESC LIMIT 1), '')
	)
	ON CONFLICT (singleton) DO NOTHING;

	FOR batch_number IN 1..max_batches LOOP
		PERFORM set_config('lock_timeout', '1s', true);
		SELECT * INTO STRICT progress
		FROM maintenance.log_routing_metadata_cleanup
		WHERE singleton
		FOR UPDATE NOWAIT;

		IF progress.completed THEN
			COMMIT;
			RETURN;
		END IF;

		-- Limit examined rows before filtering metadata/age, so sparse matches
		-- cannot cause an unbounded scan. Generated log IDs are nonempty.
		SELECT array_agg(id ORDER BY id) INTO batch_ids
		FROM (
			SELECT id FROM public.log
			WHERE id > progress.last_id AND id <= progress.stop_id
			ORDER BY id
			LIMIT batch_size
		) AS batch;

		IF batch_ids IS NULL THEN
			UPDATE maintenance.log_routing_metadata_cleanup
			SET completed = true, updated_at = clock_timestamp()
			WHERE singleton;
			COMMIT;
			RETURN;
		END IF;

		-- Do not skip locked rows: advancing the cursor would lose them.
		UPDATE public.log
		SET routing_metadata = NULL
		WHERE id = ANY(batch_ids)
			AND created_at < progress.cutoff
			AND routing_metadata IS NOT NULL;
		GET DIAGNOSTICS cleared = ROW_COUNT;

		UPDATE maintenance.log_routing_metadata_cleanup
		SET last_id = batch_ids[cardinality(batch_ids)],
			scanned_rows = scanned_rows + cardinality(batch_ids),
			cleared_rows = cleared_rows + cleared,
			updated_at = clock_timestamp()
		WHERE singleton;

		-- The checkpoint and updates commit together; sleep holds no row locks.
		COMMIT;
		IF batch_number < max_batches THEN
			PERFORM pg_sleep(pause_seconds);
		END IF;
	END LOOP;
END;
$$;
