---
name: changelog
description: Write a new LLM Gateway changelog entry. Use when the user says "changelog", "changelog entry", "write a changelog", "add a changelog", "announce this feature", or asks to document a shipped feature for the public changelog. Produces the dated markdown file under apps/ui/src/content/changelog plus a gpt-image-2 prompt for the OpenGraph image.
---

# Changelog

Write a public changelog entry for LLM Gateway, in the house style, and hand back a ready-to-run gpt-image-2 prompt for its OpenGraph image.

## What you need first

Before writing, make sure you understand the feature concretely. If the user only gave a feature name, find the facts — don't guess:

- Read the relevant docs page under `apps/docs/content/` (e.g. `features/<feature>.mdx`).
- Inspect the shipping commit/PR if one is referenced: `git show <sha> --stat`, then read the changed UI/API/gateway files for the exact user-facing behavior.
- Confirm plan gating (free vs Pro vs Enterprise), exact field names, error codes, and any limits. The changelog must be accurate — never invent prices, limits, or capabilities.

## Where entries live

- Entries: `apps/ui/src/content/changelog/<YYYY-MM-DD>-<kebab-slug>.md`
- Images: `apps/ui/public/changelog/<kebab-slug>.png`
- Schema is enforced by `apps/ui/content-collections.ts` — all frontmatter fields below are required (except `draft`).

## Step 1 — Pick the date, id, and slug

- **Date**: today, `YYYY-MM-DD`. Entries sort by date descending, so this puts the entry at the top.
- **id**: the next integer after the current highest. Find it with:
  ```bash
  grep -h '^id:' apps/ui/src/content/changelog/*.md | sed 's/[^0-9]//g' | sort -n | tail -1
  ```
  Use that number + 1, as a string.
- **slug**: short kebab-case, feature-focused (e.g. `custom-model-catalog`). The slug must match the filename suffix and the `image.src` filename, and becomes the URL `/changelog/<slug>`.

## Step 2 — Write the markdown file

Frontmatter (YAML), then the body. Entries are plain Markdown — **no MDX/JSX components** (no `<Callout>`); use bold inline notes instead.

```markdown
---
id: "<next-id>"
slug: "<slug>"
date: "<YYYY-MM-DD>"
title: "<Title Case, ~3–7 words>"
summary: "<1–3 sentences: what shipped, the concrete benefit, and the plan if gated. This is the OG description and the listing blurb.>"
image:
  src: "/changelog/<slug>.png"
  alt: "<Descriptive alt text: the feature and what the image shows>"
  width: 1536
  height: 1024
---

<Opening paragraph: the problem this solves, then the one-line statement of what shipped. Bold the feature name once.>

## <Section header — verb-led or outcome-led>

<Body. Prefer a table for field/option references and a fenced code block for an API example.>

---

**[<Docs link> →](https://docs.llmgateway.io/...)** | **[<Secondary CTA> →](https://llmgateway.io/...)**
```

### House style (match existing entries)

Read the two or three most recent files in `apps/ui/src/content/changelog/` before writing, and mirror their tone:

- **Lead with the problem, then the fix.** First paragraph names the pain; the next sentence states what shipped.
- **Benefits over features, specific over vague.** "about 50% cheaper", "rejected with `400` before any data leaves the gateway" — not "improved efficiency".
- **Confident and plain.** Active voice. No exclamation points. No "very/really/simply". No buzzwords ("streamline", "seamless", "revolutionary").
- **Show the API.** Include a realistic `curl` or JSON example when there's a request-level change. Use `https://api.llmgateway.io/v1/...` and `$LLM_GATEWAY_API_KEY`.
- **Use a table** for fields, options, strategies, or tiers.
- **State plan gating explicitly** (e.g. "Available on the **Enterprise plan**").
- **Close with a footer link line**: a docs link and one secondary CTA, separated by ` | `, each as `**[Label →](url)**`.
- Keep section headers in `##`. Keep it scannable — short paragraphs, bullets for lists of behaviors.

## Step 3 — Produce the OpenGraph image prompt

Hand the user a single, ready-to-paste **gpt-image-2** prompt that produces the OG image, plus where to save it.

**Resolution.** Target **1536×1024** (3:2 landscape). This is the recommended OpenGraph size for gpt-image-2: the dimensions are divisible by 16 (a gpt-image-2 requirement) and crop cleanly to the ~1.91:1 social card. Match the `width`/`height` in the frontmatter to whatever you generate. (Square `1024×1024` is acceptable for icon-style art but crops more on social cards — prefer landscape for OG.)

**Prompt guidance.** Write a *small summary* prompt — 2–4 sentences — in the **house image style**: a glossy 3D-rendered circuit-board scene, not a flat/minimal gradient backdrop. The prompt should:

- Set the scene: a dark navy computer circuit board in glossy 3D isometric perspective, with bright neon-teal light traces flowing across it toward a central raised chip.
- Put the feature's concept at the center: a glowing element mounted on the central chip (e.g. a glowing doorway for the gateway, a glowing key for API keys). Concept over literalism.
- Surround it with supporting glossy rounded 3D icons that fit the feature (chat bubbles, keys, charts, coins…) in vivid purple, lime green, and mint, each on small pedestals on the board.
- Add the render feel: subtle depth of field at the edges, soft reflections, premium 3D render, vibrant against the dark board.
- **Says "no text, no words, no letters, no UI chrome"** — AI image text is unreliable; the title lives in the page, not the image.
- Specifies the aspect: "wide 3:2 landscape composition, 1536×1024".

Output the prompt in a fenced block, then the save path, e.g.:

````
Prompt for gpt-image-2 (1536×1024):

```
A dark navy computer circuit board in glossy 3D isometric perspective, with
bright neon-teal light traces flowing across it toward a central raised chip.
On the chip sits a glowing <concept element>. Around it, glossy rounded 3D
<supporting icons> in vivid purple, lime green, and mint stand on small
pedestals on the board. Subtle depth of field at the edges, soft reflections,
premium 3D render. Wide 3:2 landscape composition, 1536×1024. No text, no
words, no letters, no UI chrome.
```

Save the result to: apps/ui/public/changelog/<slug>.png
````

Generate the image with gpt-image-2 (LLM Gateway playground, the Images API, or any gpt-image-2 client), then drop the PNG at that path. The entry references it via `image.src`; until the file exists the entry builds fine but the image 404s.

## Step 4 — Validate

```bash
pnpm format
turbo run build --filter=ui
```

`pnpm format` normalizes the markdown; the `ui` build fails if the frontmatter doesn't match the content-collections schema. Then commit (conventional commit, ≤50-char title), e.g. `docs(changelog): add custom model catalog entry`.
