---
name: core-web-vitals
description: Diagnose and improve Largest Contentful Paint, Interaction to Next Paint, and Cumulative Layout Shift in this repository's Next.js App Router frontends. Use when auditing Core Web Vitals, investigating LCP, INP, or CLS regressions, or changing frontend loading, responsiveness, image, font, or layout behavior for performance.
---

# Core Web Vitals

Measure the affected route before changing it. Do not apply generic performance
advice without identifying the actual LCP element, slow interaction, or layout
shift.

## Targets and evidence

Use Google's current thresholds at the 75th percentile:

| Metric | Good     | Poor     |
| ------ | -------- | -------- |
| LCP    | ≤ 2.5 s  | > 4 s    |
| INP    | ≤ 200 ms | > 500 ms |
| CLS    | ≤ 0.1    | > 0.25   |

Field data and lab data answer different questions. Check CrUX or PageSpeed
Insights for user impact, then reproduce locally with Chrome DevTools or a
repeatable browser trace. Lighthouse reports LCP and CLS, but cannot measure INP
without real interaction; use its Total Blocking Time only as a lab proxy.

Official references:

- [Web Vitals](https://web.dev/articles/vitals)
- [Optimize LCP](https://web.dev/articles/optimize-lcp)
- [Optimize INP](https://web.dev/articles/optimize-inp)
- [Optimize CLS](https://web.dev/articles/optimize-cls)

## Diagnose

1. Identify the affected app and route. Read its page, layout, loading boundary,
   client components, data queries, images, fonts, and third-party scripts.
2. Record a baseline on a production build with the same viewport, throttling,
   cache state, and interaction sequence used for the final comparison.
3. Use the trace to identify the cause:
   - LCP: server delay, resource discovery, resource load, or render delay.
   - INP: input delay, event-handler work, or presentation delay.
   - CLS: the shifting element and the element that changed its geometry.
4. Change the smallest cause supported by the trace.

## Repository-specific fixes

These apps use Next.js 16 App Router. Prefer Server Components and existing
TanStack Query patterns over client-side `useEffect` fetching.

For LCP:

- Keep above-the-fold content in the initial server-rendered response when
  possible. Use a nearby loading boundary only when streaming improves the
  observed route.
- Use `next/image` with correct `width` and `height`, or `fill` with a sized
  parent and an accurate `sizes` value.
- Next.js 16 deprecates the Image `priority` prop; use `preload` only for the
  measured LCP image. Do not preload multiple competing images.
- Remove request waterfalls and late client-only discovery shown in the trace.
- Do not await a slow API call in a page that has a loading state. Prefetch it
  without awaiting through `createServerQuery()` (`apps/ui/src/lib/server-query.ts`)
  and wrap the client in `HydrationBoundary`; the client query must build the
  same key. The data can land before hydration, so a `useQuery` consumer must
  render its loading state until `useHydrated()` is true, or React reports a
  hydration mismatch (#418). See the dashboard overview page.
- When the server already fetched what a client query loads, pass it as that
  query's `initialData` instead of rendering a skeleton first.

For TBT (lab proxy for INP on load):

- Hydration covers every element in the server HTML, including Server
  Component output. Wrap below-the-fold sections in `<Suspense>` so React
  hydrates them as separate low-priority units. An async component inside
  (such as a tweet card) needs its own sized fallback, or the section streams
  in empty and shifts the layout.
- A provider that wraps the page and changes its value after hydration (a
  fetch result, a browser-only detection) forces every Suspense boundary that
  has not hydrated yet to hydrate at that update's priority. React renders
  default and sync updates together, so this becomes one long blocking task.
  Set such state inside `startTransition` (see `TimeZoneProvider` and
  `ProviderMarksProvider` in `packages/shared`).
- `content-visibility: auto` with `contain-intrinsic-size: auto <guess>` on
  below-the-fold sections keeps their elements out of style and layout until
  they near the viewport (see the home page). Full-page screenshots leave
  those sections blank; compare viewport screenshots while scrolling instead.
- Measure with the API reachable. Some calls (provider marks) only cost main
  thread time when they succeed; when the local API is down, mock the public
  endpoints the page calls.
- posthog-js downloads `surveys.js` unless `disable_surveys: true` is set, even
  when the project has surveys off.

For INP:

- Trace the exact slow click, keypress, or tap. Reduce synchronous work in that
  path and avoid rerendering unrelated subtrees.
- Provide immediate visual feedback, then defer only work that is not required
  for the next paint.
- Virtualize or paginate large rendered collections when the trace shows DOM or
  reconciliation cost. Do not add memoization without a measured benefit.

For CLS:

- Reserve dimensions for images, video, embeds, skeletons, banners, and async
  content before they load.
- Keep loading and loaded states geometrically compatible.
- Animate `transform` and `opacity` when possible instead of layout dimensions.
- Inspect font fallback metrics before changing `font-display`; a blanket value
  is not a CLS fix.

## Verify

Build the affected app through Turbo, run the same trace again, and compare the
before/after measurements. Test relevant responsive breakpoints and both themes
when layout or assets differ.

Run `pnpm format` and the full `pnpm build` before handoff. Report the measured
baseline, the measured result, the route and conditions, and any field-data gap
that cannot be validated locally.
