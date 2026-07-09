---
name: knowledge-base
description: Write a new LLM Gateway docs Knowledge base page (apps/docs/content/learn) with light + dark dashboard screenshots. Use when the user says "knowledge base page", "KB page", "learn page", "document the <X> dashboard page", or asks for docs covering a dashboard or playground page with screenshots.
---

# Knowledge Base Page

Write a docs "Knowledge base" page for a dashboard or playground page, take matching light/dark screenshots against local dev, and register the page in the section index.

Each Knowledge base page documents exactly one page of the product UI:

- Page: `apps/docs/content/learn/<slug>.mdx`
- Screenshots: `apps/docs/public/learn/<slug>-light.png` + `apps/docs/public/learn/<slug>-dark.png` (plus `<slug>-<detail>-{light,dark}.png` pairs for dialogs/sub-views)
- Registration: the `pages` array in `apps/docs/content/learn/meta.json` AND the bullet list in `apps/docs/content/learn/index.mdx`

## Prerequisites

- The dev stack must be running (`pnpm dev`): UI on :3002, Playground on :3003, with a seeded DB (`pnpm run setup` if stale).
- Playwright MCP for screenshots.
- Every seeded account's password is its own email (password == email):
  - `admin@example.com` — default org (`test-org-id`, project `test-project-id`) for most pages
  - `enterprise@example.com` — enterprise org (`enterprise-org-id`, project `enterprise-project-id`) for Enterprise-gated pages (Master Keys, Member Analytics, …)
- URL patterns: project pages are `/dashboard/<orgId>/<projectId>/<page>`, org pages are `/dashboard/<orgId>/org/<page>`, playground pages live on :3003.

## Step 1 — Understand the page

Never write from guesswork. Read the actual UI implementation first:

- Find the route under `apps/ui/src/app/dashboard/[orgId]/...` (or `apps/playground/src/app/...`) and read the page + its main components.
- Note every column, field, action, dialog, empty state, limit, and plan gate the page exposes. Tables and callouts in the doc must match the real UI exactly — never invent fields, limits, or prices.
- Check whether the seeded data actually populates the page. If a table renders empty, seed or create data through the UI/API first so the screenshot shows a realistic state.

## Step 2 — Take screenshots (Playwright MCP)

Match the established look of the existing shots in `apps/docs/public/learn/`:

1. Resize the viewport to **1440×900** (`browser_resize`).
2. Log in at `http://localhost:3002/login` as the appropriate seeded user, then navigate to the target page.
3. **Collapse the sidebar to icons**: click the "Toggle Sidebar" button in the header.
4. **Hide dev chrome** via `browser_evaluate` (the chat-support bubble stays visible — that is intentional):

   ```js
   () => {
     const style = document.createElement("style");
     style.textContent =
       "button[aria-label='Open Tanstack query devtools'], nextjs-portal, [data-nextjs-dev-tools-button], [data-next-badge-root] { display: none !important; }";
     document.head.appendChild(style);
     const tsq = document.querySelector(
       "button[aria-label='Open Tanstack query devtools']",
     );
     if (tsq) {
       const holder = tsq.closest("div");
       if (holder) holder.style.display = "none";
     }
   };
   ```

5. **Light shots**: `browser_take_screenshot` with `{ type: "png", scale: "css", fullPage: true, filename: "<slug>-light.png" }` for the main page. For dialogs or focused sub-views, open them and take a viewport shot (no `fullPage`) named `<slug>-<detail>-light.png`.
6. **Dark shots**: `browser_evaluate` → `localStorage.setItem("theme", "dark")`, navigate to the page again (full reload), re-inject the CSS from step 4 (and re-collapse the sidebar if it reset), then repeat the same screenshots as `<slug>-dark.png` / `<slug>-<detail>-dark.png`. Verify dark mode took effect (`document.documentElement.classList.contains("dark")`).
7. Move the PNGs from the Playwright output directory (the tool result shows the saved path) into `apps/docs/public/learn/`.

Do not compress the PNGs manually — calibre/image-actions optimizes them automatically on the PR.

Every `<basePath>` referenced from MDX MUST have both a `-light.png` and a `-dark.png`, or one theme renders a broken image.

## Step 3 — Write the MDX page

Read one or two recent pages in `apps/docs/content/learn/` (e.g. `master-keys.mdx`) and mirror their tone. Structure:

```mdx
---
title: <Page Name as it appears in the dashboard nav>
description: <One line: what the page lets you do>
icon: <LucideIconName, e.g. KeyRound, ChartBar, Activity>
---

import { Callout } from "fumadocs-ui/components/callout";
import { ThemedImage } from "@/components/themed-image";

<Opening paragraph: what the page is for and why you'd use it — one or two
sentences, benefit-led.>

<ThemedImage alt="<Page Name>" basePath="/learn/<slug>" />

## <Task-led section, e.g. "Creating a Master Key">

<Short instructions. Bold UI element names like **Create Master Key**.>

<ThemedImage alt="<Detail>" basePath="/learn/<slug>-<detail>" />
```

House style:

- **One `<ThemedImage>` right after the intro** showing the whole page; more for dialogs/sub-views where they help.
- **Use a table** for column/field references (Field | Description).
- **Callouts**: `type="info"` for plan gating ("Available on the [**Enterprise plan**](https://llmgateway.io/enterprise)…"), `type="warning"` for one-time secrets or destructive actions.
- **State real limits and behaviors** (exact counts, status codes, prefixes) taken from the code in Step 1.
- **Cross-link** related Knowledge base pages (`/learn/<slug>`) and feature docs (`/features/<slug>`) where they exist.
- No screenshots of raw JSON/API responses — show a `bash`/`curl` fenced block instead when the page has an API angle.

## Step 4 — Register the page

Both registrations are required — the page is invisible in the sidebar and the index without them:

1. `apps/docs/content/learn/meta.json`: add `"<slug>"` to the `pages` array, positioned to mirror the dashboard sidebar order (project pages → org pages → playground).
2. `apps/docs/content/learn/index.mdx`: add a bullet in the matching section (**Project Pages** / **Organization Pages** / **Playground**):

   ```
   - [**<Page Name>**](/learn/<slug>) — <Short blurb> (Enterprise)
   ```

   Append `(Enterprise)` only when the page is Enterprise-gated.

## Step 5 — Validate and commit

```bash
pnpm format
turbo run build --filter=docs
```

The docs build fails on broken frontmatter, bad imports, or missing meta entries. Visually spot-check both themes at `http://localhost:3005/learn/<slug>` if the docs dev server is running.

Commit with a conventional message (≤50-char title), e.g. `docs(learn): add master keys knowledge base page`. Include the PNGs in the same commit.
