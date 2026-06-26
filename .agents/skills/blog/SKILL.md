---
name: blog
description: Write a new LLM Gateway blog post in the house style, draft the prose with the copywriting skill, and generate its OpenGraph image with gpt-image-2. Use when the user says "blog", "blog post", "write a blog post", "draft a blog", "add a blog post", "publish a blog", or "write an article" for the marketing site. For shipped-feature release notes use the `changelog` skill instead.
---

# Blog

Write a public blog post for LLM Gateway, in the house style, with the prose drafted/polished by the `copywriting` skill, and generate its OpenGraph image with **gpt-image-2**.

This skill is the blog counterpart of the `changelog` skill. The difference: blog posts are longer SEO/marketing content (guides, comparisons, announcements, engineering deep-dives) rather than short release notes, the prose is run through the `copywriting` skill, and the image is **generated** here (not just handed off as a prompt).

## What you need first

Before writing, understand the topic concretely. Never invent prices, limits, capabilities, or quotes.

- If the post documents a feature, read the relevant docs page under `apps/docs/content/` and inspect the shipping PR/commit (`git show <sha> --stat`, then the changed UI/API/gateway files) to confirm exact behavior, field names, error codes, and **plan gating** (free vs Pro vs Enterprise).
- If it's a comparison or guide, gather the concrete facts you'll cite (real numbers, real provider names, real endpoints).
- Decide the **primary SEO keyword/phrase** the post should rank for (e.g. "API key rotation", "LLM orchestration"). It belongs in the title, the summary, an early paragraph, and at least one `##` header.

## Where entries live

- Entries: `apps/ui/src/content/blog/<YYYY-MM-DD>-<kebab-slug>.md`
- Images: `apps/ui/public/blog/<kebab-slug>.png`
- Schema is enforced by `apps/ui/content-collections.ts`. Required: `id`, `slug`, `date`, `title`, `summary`. Optional: `draft`, `categories` (defaults `[]`), `image` (`src`/`alt`/`width`/`height`).

## Step 1 — Pick the date, id, slug, categories

- **Date**: today, `YYYY-MM-DD`. Posts sort by date descending, so this puts it at the top of the listing.
- **slug**: short kebab-case, keyword-focused (e.g. `api-key-rotation`). Must match the filename suffix and the `image.src` filename, and becomes the URL `/blog/<slug>`.
- **id**: the string `blog-<slug>` (e.g. `blog-api-key-rotation`). This is the convention for every existing post — confirm with:
  ```bash
  grep -h '^id:' apps/ui/src/content/blog/*.md | sort | uniq | tail -5
  ```
- **categories**: pick from the existing set so the listing filters stay clean — `Guides`, `Announcements`, `Product`, `Engineering`, `Integrations`. Combine when it fits (e.g. `["Guides", "Engineering"]`). Check current usage:
  ```bash
  grep -h '^categories:' apps/ui/src/content/blog/*.md | sort | uniq -c | sort -rn
  ```

## Step 2 — Draft the prose with the copywriting skill

Invoke the **`copywriting`** skill (via the Skill tool) to draft and tighten the body copy. Give it: the topic, the primary keyword, the target reader, the key facts you gathered, and the LLM Gateway voice notes below. Iterate on its output, then drop the result into the markdown body.

Read the two or three most recent files in `apps/ui/src/content/blog/` before writing and mirror their structure and tone.

### House style (match existing posts)

- **Lead with the problem, then the fix.** Open by naming the pain concretely; then state what LLM Gateway does about it. Bold the product name once: **LLM Gateway**.
- **Benefits over features, specific over vague.** Real numbers, real endpoints, real provider names. No "seamless", "revolutionary", "streamline".
- **Confident and plain.** Active voice, short paragraphs, no exclamation points, no "very/really/simply".
- **Scannable structure.** `##` section headers (verb-led or outcome-led), bullets and tables for options/comparisons, fenced code blocks for any `curl`/JSON/diff example. Use `https://api.llmgateway.io/v1/...` and `$LLM_GATEWAY_API_KEY` in API examples.
- **State plan gating explicitly** when a capability is gated.
- **SEO conventions** (this is the main difference from changelog): work the primary keyword into the title, the `summary`, the first 1–2 paragraphs, and a header. Add a short **"Frequently Asked Questions"** section with 2–4 `###` question headers near the end (these target long-tail queries). Link to related internal posts/docs with root-relative links (e.g. `/blog/soc2-type-ii`, `https://docs.llmgateway.io/...`).
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
image:
  src: "/blog/<slug>.png"
  alt: "<Descriptive alt text including the concept the image shows>"
  width: 1536
  height: 1024
---

<body — the copywriting-skill output>
```

## Step 3 — Generate the OpenGraph image with gpt-image-2

The image is an **abstract, on-brand illustration with no text** — AI-rendered text and logos are unreliable, and the title already lives on the page. (If the user instead wants a branded card *with* the headline/logo baked in, render it with the repo's `next/og` template system — see `apps/ui/src/lib/og.tsx` for the brand spec — rather than gpt-image-2.)

**Resolution.** Generate **1536×1024** (3:2 landscape). gpt-image-2 supports `1024x1024`, `1536x1024`, `1024x1536`; landscape crops cleanly to the ~1.91:1 social card. Match `image.width`/`height` in the frontmatter to what you generate.

### Write the prompt

A 2–4 sentence prompt that:

- Describes a clean, modern, **abstract** tech illustration conveying the post's concept (concept over literalism — e.g. interlocking rotating keys and a shield for key rotation; a hub routing glowing streams to many nodes for orchestration).
- Bakes in the **LLM Gateway brand feel** (from `apps/ui/src/lib/og.tsx`): near-black background, a soft cyan glow (`rgb(56,189,248)`) in one corner and a soft violet glow (`rgb(139,92,246)`) in the opposite corner, subtle depth and glow, generous negative space, premium and minimal, balanced as a backdrop behind a headline.
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

### Always composite the official logo (never let gpt-image-2 draw it)

gpt-image-2 **cannot** reproduce the LLM Gateway logo — it hallucinates a wrong mark. So always overlay the real asset. Render the white wordmark lockup (`apps/ui/public/brand/logo-with-name-white.svg`) and composite it into the reserved top-left corner. Needs `rsvg-convert` and ImageMagick (`magick`):

```bash
rsvg-convert -h 84 apps/ui/public/brand/logo-with-name-white.svg -o /tmp/llmgw-logo.png
magick /tmp/<slug>-bg.png /tmp/llmgw-logo.png -geometry +72+72 -composite apps/ui/public/blog/<slug>.png
file apps/ui/public/blog/<slug>.png   # → PNG image data, 1536 x 1024
```

View the final file to confirm the real logo sits cleanly in the top-left. (Use `apps/ui/public/brand/logo-white.svg` for just the icon mark if a wordmark doesn't fit the composition.)

**If no key is available**, fall back to handing off: output the prompt in a fenced block (keeping the "top-left empty" instruction) plus the two composite commands, and tell the user to generate the background and run the composite, dropping the result at `apps/ui/public/blog/<slug>.png`. The post builds fine without the file; the image just 404s until it exists.

## Step 4 — Validate

```bash
pnpm format
turbo run build --filter=ui
```

`pnpm format` normalizes the markdown; the `ui` build fails if the frontmatter doesn't match the content-collections schema. Then commit (conventional commit, ≤50-char title), e.g. `docs(blog): add api key rotation post`.
