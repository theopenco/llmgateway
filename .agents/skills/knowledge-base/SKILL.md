---
name: knowledge-base
description: Write a new LLM Gateway docs Knowledge base page under apps/docs/content/learn with light and dark dashboard screenshots. Use when the user asks for a knowledge base page, KB page, learn page, or documentation for a dashboard or playground page with screenshots.
---

# Knowledge Base Page

Write a docs "Knowledge base" page for a dashboard or playground page, take matching light/dark screenshots against local dev, and register the page in the section index.

Each Knowledge base page documents exactly one page of the product UI:

- Page: `apps/docs/content/learn/<slug>.mdx`
- Screenshots: `apps/docs/public/learn/<slug>-light.png` + `apps/docs/public/learn/<slug>-dark.png` (plus `<slug>-<detail>-{light,dark}.png` pairs for dialogs/sub-views)
- Registration: the `pages` array in `apps/docs/content/learn/meta.json` AND the bullet list in `apps/docs/content/learn/index.mdx`

## Prerequisites

- Use the `verify` skill to start a seeded, worktree-specific stack. Use
  `UI_URL` and `PLAYGROUND_URL` when set; otherwise construct each URL from its
  matching port variable, whose default is documented in `AGENTS.md`.
- Use an available browser automation tool. For a local Playwright script,
  `@playwright/test` is declared by `apps/ui` and `apps/playground`.
- Every seeded account's password is its own email (password == email):
  - `admin@example.com` — default org (`test-org-id`, project `test-project-id`) for most pages
  - `enterprise@example.com` — enterprise org (`enterprise-org-id`, project `enterprise-project-id`) for Enterprise-gated pages (Master Keys, Member Analytics, …)
- URL patterns: project pages are `/dashboard/<orgId>/<projectId>/<page>` and
  org pages are `/dashboard/<orgId>/org/<page>`.

## Step 1 — Understand the page

Never write from guesswork. Read the actual UI implementation first:

- Find the route under `apps/ui/src/app/dashboard` or `apps/playground/src/app`
  and read the page plus its main components.
- Note every column, field, action, dialog, empty state, limit, and plan gate the page exposes. Tables and callouts in the doc must match the real UI exactly — never invent fields, limits, or prices.
- Check whether the seeded data actually populates the page. If a table renders empty, seed or create data through the UI/API first so the screenshot shows a realistic state.

## Step 2 — Take screenshots

Match the established look of the existing shots in `apps/docs/public/learn/`:

1. Resize the viewport to **1440×900**.
2. Log in at `<UI_URL>/login` as the appropriate seeded user, then navigate to
   the target page.
3. **Collapse the sidebar to icons**: click the "Toggle Sidebar" button in the header.
4. **Hide dev chrome** by evaluating this CSS in the page (the chat-support
   bubble stays visible):

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

5. Capture a full-page PNG for the main page as `<slug>-light.png`. Capture
   dialogs or focused sub-views at viewport size as `<slug>-<detail>-light.png`.
6. Set `localStorage.setItem("theme", "dark")`, reload, reapply step 4, and
   repeat as `<slug>-dark.png` and `<slug>-<detail>-dark.png`. Confirm
   `document.documentElement.classList.contains("dark")` before capture.
7. Save or move the PNGs into `apps/docs/public/learn/`.

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

1. `apps/docs/content/learn/meta.json`: add `"<slug>"` to the `pages` array in
   the existing product section and ordering that matches the documented UI.
2. `apps/docs/content/learn/index.mdx`: add a bullet in the corresponding
   existing section:

   ```
   - [**<Page Name>**](/learn/<slug>) — <Short blurb> (Enterprise)
   ```

   Append `(Enterprise)` only when the page is Enterprise-gated.

## Step 5 — Validate and commit

```bash
pnpm format
pnpm exec turbo run build --filter=docs
```

The docs build checks frontmatter and imports. Separately inspect both
registration files in the diff. If the docs server is running, visually
spot-check both themes at `<DOCS_URL>/learn/<slug>`.

Commit with a conventional message (≤50-char title), e.g. `docs(learn): add master keys knowledge base page`. Include the PNGs in the same commit.
