---
name: blog
description: Write and validate an LLM Gateway marketing blog post in the repository's current house style, including structured frontmatter and a gpt-image-2 OpenGraph image. Use when the user says "blog", "blog post", "write a blog post", "draft a blog", "add a blog post", "publish a blog", or "write an article" for the marketing site. For shipped-feature release notes use the `changelog` skill instead.
---

# Blog

Write a public blog post for LLM Gateway in the current repository style and
generate its OpenGraph image with **gpt-image-2**. Use the `changelog` skill for
short release notes.

## What you need first

Before writing, understand the topic concretely. Never invent prices, limits, capabilities, or quotes.

- If the post documents a feature, read the relevant docs page under `apps/docs/content/` and inspect the shipping PR/commit (`git show <sha> --stat`, then the changed UI/API/gateway files) to confirm exact behavior, field names, error codes, and **plan gating** (free vs Pro vs Enterprise).
- If it's a comparison or guide, gather the concrete facts you'll cite (real numbers, real provider names, real endpoints).
- Decide the **primary SEO keyword/phrase** the post should rank for (e.g. "API key rotation", "LLM orchestration"). It belongs in the title, the summary, an early paragraph, and at least one `##` header.

## Where entries live

- Entries: `apps/ui/src/content/blog/<YYYY-MM-DD>-<kebab-slug>.md`
- Images: `apps/ui/public/blog/<kebab-slug>.png`
- Schema is enforced by `apps/ui/content-collections.ts`. Required: `id`,
  `slug`, `date`, `title`, `summary`. Optional: `updatedAt`, `draft`, `categories`
  (defaults `[]`), `faqs` (defaults `[]`), and `image`.

## Step 1 — Pick the date, id, slug, categories

- **Date**: today, `YYYY-MM-DD`. Posts sort by date descending, so this puts it at the top of the listing.
- **slug**: short kebab-case, keyword-focused (e.g. `api-key-rotation`). For new
  posts, use it as the filename suffix and image filename; it becomes the URL
  `/blog/<slug>`.
- **id**: use `blog-<slug>` (e.g. `blog-api-key-rotation`), matching recent
  entries. Confirm the current convention with:
  ```bash
    rg --no-filename '^id:' apps/ui/src/content/blog/*.md | sort -u | tail -5
  ```
- **categories**: pick from the existing set so the listing filters stay clean — `Guides`, `Announcements`, `Product`, `Engineering`, `Integrations`. Combine when it fits (e.g. `["Guides", "Engineering"]`). Check current usage:
  ```bash
    rg --no-filename '^categories:' apps/ui/src/content/blog/*.md | sort | uniq -c | sort -rn
  ```

## Step 2 — Draft and verify the prose

Read the two or three most recent files in `apps/ui/src/content/blog/` before writing and mirror their structure and tone.

### House style (match existing posts)

- **Lead with the problem, then the fix.** Open by naming the pain concretely; then state what LLM Gateway does about it. Bold the product name once: **LLM Gateway**.
- **Benefits over features, specific over vague.** Real numbers, real endpoints, real provider names. No "seamless", "revolutionary", "streamline".
- **Confident and plain.** Active voice, short paragraphs, no exclamation points, no "very/really/simply".
- **Scannable structure.** `##` section headers (verb-led or outcome-led), bullets and tables for options/comparisons, fenced code blocks for any `curl`/JSON/diff example. Use `https://api.llmgateway.io/v1/...` and `$LLM_GATEWAY_API_KEY` in API examples.
- **State plan gating explicitly** when a capability is gated.
- **SEO conventions** (this is the main difference from changelog): work the primary keyword into the title, the `summary`, the first 1–2 paragraphs, and a header. Add 2–4 concise `faqs` frontmatter entries when the topic supports real search questions; the blog page renders these and their FAQ structured data. Link to related internal posts/docs with root-relative links (e.g. `/blog/soc2-type-ii`, `https://docs.llmgateway.io/...`).
- **Close with a CTA block**: 2–3 bullets linking to signup, the relevant docs, and one related post — e.g. `**[Try LLM Gateway free](https://llmgateway.io/signup)**`.
- Plain Markdown only — **no MDX/JSX components**.

### Frontmatter

```markdown
---
id: "blog-<slug>"
slug: "<slug>"
date: "<YYYY-MM-DD>"
title: "<Title with the primary keyword, ~4–9 words>"
summary: "<1–3 sentences with the keyword: the problem, what shipped/what the reader learns, and the plan if gated. This is the OG description and the listing blurb.>"
categories: ["<Category>"]
faqs:
  - question: "<Question>"
    answer: "<Direct answer>"
image:
  src: "/blog/<slug>.png"
  alt: "<Descriptive alt text including the concept the image shows>"
  width: 1536
  height: 1024
---

<body>
```

## Step 3 — Generate the OpenGraph image with gpt-image-2

The image is an **abstract, on-brand illustration with no text** — AI-rendered text and logos are unreliable, and the title already lives on the page. (If the user instead wants a branded card _with_ the headline/logo baked in, render it with the repo's `next/og` template system — see `apps/ui/src/lib/og.tsx` for the brand spec — rather than gpt-image-2.)

**Resolution.** Generate **1536×1024** (3:2 landscape), matching current blog
entries and the `GPT_IMAGE_SIZES` presets in
`apps/playground/src/lib/image-gen.ts`. Match `image.width` and `image.height`
to the generated file.

### Write the prompt

A 2–4 sentence prompt in the **house image style** — a glossy 3D-rendered circuit-board scene, not a flat/minimal gradient backdrop:

- Set the scene: a dark navy computer circuit board in glossy 3D isometric perspective, with bright neon-teal light traces flowing across it toward a central raised chip.
- Put the post's concept at the center: a glowing element mounted on the central chip (concept over literalism — e.g. a glowing doorway for the gateway, a glowing rotating key for key rotation), surrounded by supporting glossy rounded 3D icons that fit the topic (chat bubbles, keys, charts, coins…) in vivid purple, lime green, and mint, each on small pedestals on the board.
- Add the render feel: subtle depth of field at the edges, soft reflections, premium 3D render, vibrant against the dark board.
- **Reserves the top-left corner**: include "the top-left corner is intentionally empty clean negative space, with no logo, no icon, no wordmark and no brand text there." The real logo is composited in afterward (see "Always composite the official logo" below), never drawn by the model.
- **Ends with**: "no logos, no UI chrome. Wide 3:2 landscape composition, 1536×1024." (If you want a branded card, you may keep a short headline/subtitle in the prompt — gpt-image-2 renders short text well — but **never** the logo.)

### Generate it (LLM Gateway Images API, gpt-image-2)

Requires `LLM_GATEWAY_API_KEY` in the environment. Generate to a temp file first — the logo is composited in the next step:

```bash
curl -s https://api.llmgateway.io/v1/images/generations \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","size":"1536x1024","prompt":"<the prompt above, on one line>"}' \
| jq -r '.data[0].b64_json' | base64 -d > /tmp/<slug>-bg.png
```

View `/tmp/<slug>-bg.png` to confirm it's on-brand and the top-left is clear; regenerate with a tweaked prompt if not.

### Composite the official logo

Do not ask the image model to reproduce the logo. Overlay
`apps/ui/public/brand/logo-with-name-white.svg` with the checked-in helper:

```bash
.agents/skills/blog/scripts/composite-logo.sh \
  /tmp/<slug>-bg.png apps/ui/public/blog/<slug>.png
file apps/ui/public/blog/<slug>.png   # → PNG image data, 1536 x 1024
```

The helper checks for `rsvg-convert`, `ffmpeg`, and `ffprobe` before doing any
work and validates the output dimensions. View the final file to confirm the
wordmark sits cleanly in the top-left. Pass
`apps/ui/public/brand/logo-white.svg` as the optional third argument when only
the icon fits.

If the API key or required image tools are unavailable, do not claim the image
was generated. Hand back the exact prompt, missing precondition, and expected
output path.

## Step 4 — Validate

```bash
pnpm format
pnpm exec turbo run build --filter=ui
```

`pnpm format` normalizes the markdown; the `ui` build fails if the frontmatter doesn't match the content-collections schema. Then commit (conventional commit, ≤50-char title), e.g. `docs(blog): add api key rotation post`.
