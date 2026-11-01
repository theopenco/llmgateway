# UI web font subsets

`subset_fonts.py` cuts the fontsource files used by `apps/ui` down to what the site renders and splits each face in two:

- `*-core.woff2`: ASCII, curly quotes, dashes, ellipsis, NBSP and every character found in the content roots. Preloaded.
- `*-extended.woff2`: the rest of Latin-1 and Latin Extended-A that the source font can draw. Not preloaded; `unicode-range` makes the browser fetch it only when a page contains one of its characters.

Both files of a face share one `font-family`, so the generated fallback face (`adjustFontFallback`) sits after them in the stack and never draws an extended character before the real font.

The script is not part of the build. Its output is committed: `apps/ui/src/fonts/files/*.woff2`, the generated `apps/ui/src/fonts/site.ts` and `apps/ui/src/fonts/editorial.ts`, and `apps/ui/src/fonts/fonts.lock.json`.

## Run it

From the repo root:

```sh
python3 -m pip install -r apps/ui/scripts/fonts/requirements.txt
pnpm --filter ui fonts:subset   # regenerate
pnpm --filter ui fonts:check    # exits 1 when the committed output is stale
```

## When to rerun

Run `fonts:check` after any of these; rerun `fonts:subset` if it fails:

- Content gains a character outside ASCII (an accented name in a blog post, a new symbol). Characters missing from the core still render, but from the extended file, which costs a download and drops kerning at the boundary.
- A fontsource package is upgraded.
- A font is used at a new weight outside `usedAxes`, or with an OpenType feature not in `features` (for example `font-variant-numeric: diagonal-fractions`). Update `fonts.json` first. Out-of-range weights clamp to the nearest kept instance instead of rendering at the requested weight.
- A new face or font is added to the UI.

## What `fonts.json` encodes

Measured from a crawl of every page in the sitemap plus the auth pages (computed styles of every text node, pseudo-element and placeholder):

- Inter, Geist Mono and Plus Jakarta Sans render at 400–700 only, upright plus synthesized italic (bold inside italics included). The weight axis keeps the default (400) and its upper master, so the dropped lower half removes masters without re-rounding any outline.
- Instrument Serif (`editorial`) renders only the gate letters on the home page, upright. The italic face is kept but no longer preloaded.
- No page sets `font-feature-settings`, `font-variation-settings`, fractions or proportional figures; `tabular-nums` is used. Every page is `lang="en"`, so `locl` is dropped.
- Nothing uses `hyphens: auto`, and none of the sources contain U+2010, so automatic hyphenation behaviour is unchanged.
- None of the licenses declares a Reserved Font Name. If one does after an upgrade, the script stops until `renameTo` is set for that font.

## Checks the script runs

- Every kept glyph has the same outline and advance as the source at each used weight.
- Every character in each `unicode-range` shapes (HarfBuzz) to the same glyphs and positions as with the source font.
- Each `unicode-range` lists only characters present in that file's `cmap`.

Font tool quirks it works around, each found by pixel-diffing in Chrome on macOS:

- Bounding boxes are not recalculated: a smaller `head` bbox changes CoreText anti-aliasing.
- Glyph names are kept: a `post` table without names also changes anti-aliasing.
- Every file keeps the `X` glyph: CoreText rasterizes the rest of the font differently without it.
- Latin Extended-A letters the source draws by composing a base letter and a combining mark get a `cmap` entry and a leading `ccmp` decomposition. Chrome limits glyph lookups to the face's `unicode-range`, so the base letter in the core file cannot be borrowed.
- Output is deterministic (no timestamp recalculation), so `--check` can compare bytes.
