# Instructions

## General

- when writing commit messages, always use the conventional commit messages format
- do not write useless comments about implemented changes
- never add unnecessary basic code comments
- always use pnpm for installing or managing dependencies and running scripts
- after adding features, make sure that the tests pass using `pnpm test:unit` and `pnpm test:e2e`
- after adding features, make sure that the build passes using `pnpm build`
- after adding features or editing files, make sure to format the code and ensure no linting errors using `pnpm format`
- after adding or adapting API routes, make sure to `pnpm generate` to re-generate the OpenAPI schemas.
- always ensure DRY principles to reuse code as much as possible
- Use localStorage instead of cookies for client-side data persistence.
- For smoke testing apps, build with 'pnpm build', run 'pnpm --filter=[app] --prod deploy dist/[app]' for each package, then run start.sh to verify 'pnpm start' works.

## Database operations

- use drizzle with the latest object syntax
- for DB changes, do not write manual migration files
- for read queries, always use `db().query.<table>.findMany()` or `db().query.<table>.findFirst()`
- do not apply any migrations, just use `pnpm push`
- if any tables or columns do not exist, run `pnpm push` to sync the schema to the database

## Packages

### apps/ui

This is a tanstack router project. Always use navigate() for navigation. Never use window.location.

### apps/docs

This is a NextJS project using Fumadocs.

### apps/gateway

This is a hono project. Always use hono+zod+openapi for validation and typesafety.

### apps/api

This is a hono project. Always use hono+zod+openapi for validation and typesafety.
