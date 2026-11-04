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

<!-- What you ran and what it showed: test command, request and response, screenshot, e2e run. An agent saying it is done is not verification. -->

## Rollback

<!-- How to undo this in production. The person who asked for the change signs this, not the agent that wrote it. -->

- [ ] A plain revert of the squash commit is safe. Otherwise, the steps (flag or env var to flip, contract migration to run first):
