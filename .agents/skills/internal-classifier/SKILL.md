---
name: internal-classifier
description: Export the self-hosted internal content-filter classifier's verdicts (passes and blocks, with prompt fingerprints) from production, and build the pseudonymized sample sent to the classifier vendor. Use when asked for a classifier export, verdict or fingerprint dump, a sample for the classifier admins or vendor, or to check classifier results over a time window.
---

# Internal classifier export

The classifier keeps no state. Every verdict, passes included, is stored on the
request's `log.gateway_content_filter_response` (internal classifier entries
have `model: "internal-classifier"`) and is cleared by log retention after 30
days. Fingerprints are present only while the classifier runs with its hash-all
option. See the `gateway` skill for how the gateway calls it.

## Admin dashboard export

Content Filter page → "Internal classifier checks", backed by
`GET /admin/content-filter/internal-checks/export`
(`apps/api/src/routes/admin-internal-classifier-checks.ts`): up to 24 hours per
download, real request and organization ids. Its CSV formula guard prefixes `'`
to `minhash_b64` values starting with `+`, so do not send dashboard downloads to
the vendor; use the scripts below.

## Vendor sample

Load the `database` skill first: this reads `log` in production. The scripts
read only the content filter columns, never prompts or completions, inside a
read-only transaction, through `log_content_filter_created_at_idx`.

1. **Dump.** Needs `kubectl` access to the production cluster. Run per window of
   about 20 minutes (~9k rows); longer `kubectl exec` streams drop and are
   retried from scratch:

   ```bash
   KUBE_CONTEXT=<production context> sh .agents/skills/internal-classifier/scripts/fetch.sh \
     "2026-10-27 15:00:00" "2026-10-27 15:20:00" <dir>/raw-1500.ndjson.gz
   ```

   Times are UTC, `[from, to)`. Each file ends with `{"__total": N}`.
   Retried attempts are skipped: the final attempt carries the same verdicts and
   the model that served the request.

2. **Convert** with the admin export's own code. It imports workspace packages
   from their `dist/`, so run `pnpm build:core` first on a fresh checkout:

   ```bash
   pnpm exec tsx --tsconfig apps/api/tsconfig.json \
     .agents/skills/internal-classifier/scripts/convert.mts <out> <dir>/raw-*.ndjson.gz
   ```

   - `<out>/send/checks.csv`: one row per verdict in the vendor audit CSV's
     column order (`ts` … `band_keys`, `account_id`, `decision`), then
     `request_key` and `chunk_index`. Request ids are replaced by `request_key`,
     organization ids by `acct-NNN` (`acct-001` = most checks).
   - `<out>/send/rule-summary.csv`, `<out>/send/hourly.csv`.
   - `<out>/internal/export-all.csv` and `<out>/internal/account-pseudonyms.csv`
     hold real ids. Never send them.

   It prints totals for the README.

3. **README.** Write `<out>/send/README.md`: window, classifier image digest and
   cyber profile (from the running deployment), whether fingerprints were on,
   the file list and column notes below, the totals, and the questions for the
   vendor. Then `cd <out> && zip -qr -9 <name>.zip send`.

Keep `<out>` and the dumps outside the repository or under `.context/`.

## Column notes

- `ts` is when the gateway logged the request (microseconds), not the
  classifier's clock.
- `rule` is empty on passes; `reasons` can still list signals that fired.
- `fp_status=too_short` rows have empty hash columns and no `minhash_b64`.
- `chunk_index` is 0 unless the content filter reads the whole conversation and
  splits it into several classify calls.
