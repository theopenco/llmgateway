---
name: frontend
description: Build and change LLM Gateway Next.js frontends — apps/ui, apps/playground, apps/code, apps/airside, and ee/admin — including API calls, data fetching, navigation, dashboard routes, dialogs and popovers, charts, number formatting, and user settings. Use when editing React components or pages in those apps, adding a dashboard page, calling the API from the UI, or formatting displayed values.
---

# Frontend

## Data

- Call the Hono API only through the generated typed client: `useFetchClient()` or `useApi()` from `@/lib/fetch-client`. Regenerate it by running the `generate` script in `apps/api`, then in the app. Utility functions take the client as a parameter from the calling component.
- Backend logic lives in `apps/api`; frontends add no Next.js API routes and no server actions that call the API. A server action adds a hop with its own timeout, rejects instead of returning (leaving loading state stuck), and breaks after a deploy. Server actions are only for what the API cannot do, such as setting the app's own httpOnly cookies.
- Server components may read through the server API client (`createServerApiClient`) for SSR. Every write runs in the browser via `$api.useMutation`, followed by `router.refresh()` or a query invalidation.
- In `ee/admin`, a global `MutationCache` toasts every failed mutation: set `meta.errorMessage` for its wording, or `meta.inlineError` (or an `onError`) when the call site renders the error itself.
- Fetch data with TanStack Query, not `useEffect`.
- Capability flags from the API are `false` when unset (non-null columns), while `@llmgateway/models` definitions leave them `undefined`. Use `||` for fallbacks between flags on API data.
- Store user settings that are not in the database in cookies so SSR sees them.
- Frontend gates are UX only; the API endpoint enforces auth, verification, and permissions itself.

## Navigation and layout

- Use `next/link` for internal links and `next/navigation`'s router for programmatic navigation.
- Keep inline links in prose attached to nearby words with a non-breaking space or a short `whitespace-nowrap` wrapper.
- New org-level dashboard pages live under `apps/ui/src/app/dashboard/[orgId]/org/`; every other segment there is parsed as a `projectId`.
- Portaled popovers inside a `Dialog` use the shared `DialogSafePopover` (`packages/shared/src/components/ui/popover.tsx`), which stays inside the dialog's scroll lock.

## Display

- Format counts and chart values with `formatNumber`, `formatCompactNumber`, and `formatChartValue` from `@llmgateway/shared/number-format`. Keep date, currency, and CSV formatting separate.
- Format chart tooltip values with `ChartTooltipContent`'s `valueFormatter`; `formatter` replaces the whole row and drops series labels.

Before a PR, follow the screenshot rules in the `pull-request` skill.
