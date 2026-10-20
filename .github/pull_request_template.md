## Summary

<!-- Problem first, then the approach. -->

## Database migration

<!-- Delete this section if the PR adds no migration. -->

- [ ] Each statement on an existing table takes its lock briefly (no table rewrite, full scan, or long backfill under ACCESS EXCLUSIVE)
- [ ] Index changes on existing tables use `IF [NOT] EXISTS`; the `CONCURRENTLY` commands to run before deploy are listed below
- [ ] `pnpm migrations:lint` passes; any `-- migrate:reviewed` comment states why the statement is safe
- [ ] Deployed code works both before and after the migration (expand/contract)

Manual steps before deploy:

## Verification
