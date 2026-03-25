# Docs App

This app powers the public documentation site for LLM Gateway.

## Local Development

From the repository root:

```bash
pnpm --filter docs dev
```

The docs app runs on `http://localhost:3005`.

If you have not set up the monorepo yet, run the root setup flow first:

```bash
pnpm i
pnpm run setup
```

## Common Commands

```bash
pnpm --filter docs dev
pnpm --filter docs build
pnpm --filter docs lint
pnpm --filter docs gen-docs
```

## Content Structure

- `content/`: hand-written documentation pages
- `content/(api)/`: generated API reference pages
- `app/`: Next.js routes and layouts
- `components/`: shared docs UI components
- `scripts/generate-docs.mjs`: regenerates API docs from the gateway OpenAPI spec

## Updating API Reference Docs

The API reference is generated from `apps/gateway/openapi.json`.

After changing the gateway OpenAPI output, regenerate the docs app content:

```bash
pnpm --filter docs gen-docs
```

Generated files are written to `content/(api)/`.
