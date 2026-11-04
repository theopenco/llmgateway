# docs

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Production build

Run `pnpm exec turbo run build --filter=docs` from the repository root.
Production uses Webpack to share compiled MDX across routes; Turbopack currently
emits a full copy per server entry. Development still uses Turbopack.

The build checks a 40 MiB budget for `.next/server` JavaScript, excluding source
maps. Investigate duplicated chunks before raising it. This is an app build
budget, not the final deployment bundle size.

## API reference

Build from the repository root with `pnpm exec turbo run build --filter=docs`.
This generates `openapi.json` and the API reference pages before Next.js builds.
The docs `dev` script also generates them before starting Next.js; run the core
build first (`pnpm build:core`, included in `pnpm setup`).
The server imports the generated schema into its bundle; `./openapi.json` remains
its document ID, not a runtime filesystem path. Keep that ID aligned with the
generated MDX when changing schema loading.

## Explore

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `app/layout.config.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |

### Fumadocs MDX

A `source.config.ts` config file has been included, you can customise different options like frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.vercel.app) - learn about Fumadocs
