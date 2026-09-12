# Backfill routing metadata cleanup

Deploy the worker's 30-day cleanup change first. This separate, operator-run
backfill also clears expired rows already marked `data_retention_cleaned_up`.
It changes only `routing_metadata`; it does not reset retention flags or delete
logs. Installing the SQL does not run the backfill.

Ensure any required historical routing rollups are complete first: cleared
routing details cannot be reconstructed. Existing aggregation rows are retained.

Install using a database connection selected explicitly for this operation:

```sh
psql "$CLEANUP_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/cleanup-log-routing-metadata.sql
```

Run with autocommit enabled, outside `BEGIN` and without `psql --single-transaction`:

```sql
CALL maintenance.cleanup_log_routing_metadata(
	batch_size => 1000,
	pause_seconds => 1,
	max_batches => 1000
);

SELECT cutoff, scanned_rows, cleared_rows, completed, updated_at
FROM maintenance.log_routing_metadata_cleanup;
```

Each call examines up to one million rows, committing every 1,000 and pausing
one second between batches. Repeat the call until `completed` is true. Use one
runner; cancel or disconnect to stop, then repeat the call to resume. A lock
wait longer than one second aborts the call; earlier batches stay committed and
the failed batch is retried on the next call. Reinstalling the SQL preserves
progress.

The procedure walks the existing `log` primary-key index with `id > last_id`,
without `OFFSET`, a new index, or repeated scans from the beginning. It limits
rows **before** checking age and non-null metadata, so batches with no matches
still advance. Its fixed cutoff is 30 days before the first call, in UTC; the
worker handles rows that expire afterward. Run after historical imports finish;
backdated rows inserted behind the cursor require a new pass.

A billion examined rows need at least about 11.6 days at these defaults, plus
query time. Increase the pause or reduce the batch size if database latency,
WAL volume, replica lag, or vacuum backlog rises. Updates create dead tuples;
allow autovacuum to reclaim them. This does not immediately shrink the table's
files, and `VACUUM FULL` would take an exclusive table lock.

After completion, remove only these maintenance objects if desired:

```sql
DROP PROCEDURE maintenance.cleanup_log_routing_metadata(integer, double precision, integer);
DROP TABLE maintenance.log_routing_metadata_cleanup;
```

PostgreSQL [procedures support per-batch commits](https://www.postgresql.org/docs/17/plpgsql-transactions.html);
ordinary functions cannot provide this transaction boundary. See also
[routine vacuuming](https://www.postgresql.org/docs/17/routine-vacuuming.html).
