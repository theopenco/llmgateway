---
id: "blog-generate-svg-with-ai"
slug: "generate-svg-with-ai"
date: "2026-11-05"
title: "How to Generate SVGs with AI Through One API"
summary: "Generate SVG icons, logos, stickers, and illustrations with AI using OpenAI's GPT Image 2.6 through LLM Gateway. One request with output_format: svg returns an editable vector file, billed from reported usage on your existing gateway key."
categories: ["Guides", "Product"]
faqs:
  - question: "Can AI generate SVG files directly?"
    answer: "Yes. OpenAI's GPT Image 2.6 Sunburst and Flare return SVG when you set output_format to svg on /v1/images/generations. The model renders a reference image and an authoring model writes the vector document, so you get real paths and shapes, not a traced bitmap."
  - question: "Which models can generate SVG on LLM Gateway?"
    answer: "openai/gpt-image-2.6-sunburst for detailed work and openai/gpt-image-2.6-flare for fast iteration. Requesting svg from another model returns a 400 before any provider is called."
  - question: "How much does AI SVG generation cost?"
    answer: "Each SVG request bills the image tokens of the reference image at GPT Image 2.6 rates ($5 per million text input tokens and $30 per million image output tokens) plus the authoring model's tokens at that model's rates. The response's usage.cost shows the total for every request."
  - question: "Can I edit an existing SVG with AI?"
    answer: "Not through the image edit endpoint: OpenAI does not accept SVG as an edit input or return SVG from edits. Generate a new SVG with a revised prompt, or edit the returned file by hand, since it is plain XML."
image:
  src: "/blog/generate-svg-with-ai.png"
  alt: "LLM Gateway card for the guide on generating SVGs with AI"
  width: 1200
  height: 630
---

Image models have produced pixels for years. That works for photos and fails
for the graphics product teams ship most: icons, logos, stickers, and spot
illustrations. Those need to scale from a favicon to a billboard, change color
with the theme, and live in a repository as code. Until now, the path was a
PNG from a model followed by a tracing tool, which loses detail and leaves
messy paths.

You can now **generate SVGs with AI** in one request. OpenAI's GPT Image 2.6
returns vector output natively, and **LLM Gateway** exposes it on the same
`/v1/images/generations` endpoint and API key you already use.

## Generate an SVG with AI in one request

Set `output_format` to `svg`:

```bash
curl https://api.llmgateway.io/v1/images/generations \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-image-2.6-flare",
    "prompt": "A minimal line icon of a paper airplane, single stroke color, no background",
    "output_format": "svg",
    "quality": "medium"
  }' | jq -r '.data[0].b64_json' | base64 --decode > paper-airplane.svg
```

The response has the usual images shape. `data[0].b64_json` is the base64 of a
UTF-8 SVG document, and `output_format` echoes `"svg"`:

```json
{
  "created": 1762344000,
  "data": [
    {
      "b64_json": "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIC4uLg=="
    }
  ],
  "output_format": "svg"
}
```

The response also carries `usage` with the token counts and `usage.cost`, the
billed cost of the request in USD.

The same request works from the OpenAI SDK by pointing `baseURL` at the
gateway:

```ts
import OpenAI from "openai";
import { writeFile } from "node:fs/promises";

const client = new OpenAI({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
  baseURL: "https://api.llmgateway.io/v1",
});

const result = await client.images.generate({
  model: "openai/gpt-image-2.6-sunburst",
  prompt: "A flat bakery logo: a golden loaf above the words Field & Flour",
  output_format: "svg",
});

await writeFile("logo.svg", Buffer.from(result.data[0].b64_json!, "base64"));
```

## Sunburst or Flare

| Model                           | Pick it for                                                   |
| ------------------------------- | ------------------------------------------------------------- |
| `openai/gpt-image-2.6-flare`    | Fast iteration: icon sets, sticker drafts, exploring styles   |
| `openai/gpt-image-2.6-sunburst` | Detailed work: logos with lettering, illustrations with depth |

Start with Flare to find a direction, then run the final prompt on Sunburst.
`quality` controls the reference image the SVG is drawn from, so `low` or
`medium` is usually enough for flat icons.

## Prompts that produce clean vectors

SVG output rewards prompts that describe a graphic, not a photo:

- **Name the style.** "Flat", "line icon", "two-color", "geometric", and
  "sticker with a white outline" lead to fewer, cleaner paths.
- **Limit the palette.** "Three colors: navy, coral, cream" keeps the file small
  and easy to retheme.
- **Say what to leave out.** "No background, no shadows, no gradients" avoids
  shapes you would delete by hand.
- **Spell out the text.** Logos with lettering come out best when the exact
  words are in quotes in the prompt.

## What you get back, and the limits

The SVG is static vector content: paths, shapes, and colors, with no scripts,
external resources, or embedded raster images. That makes it safe to inline in
HTML or commit to a design system after your usual review.

A few rules come from the upstream API. The gateway rejects an SVG request
with `n` above 1, with `output_compression`, or for a model without SVG output
with a `400` before any provider is called:

- `n` must be `1`.
- `output_compression` and streaming are not available for SVG.
- SVG is a generation format. `/v1/images/edits` returns raster images, and an
  SVG is not accepted as an edit input.
- Only GPT Image 2.6 models return SVG. `model: "auto"` routes to a raster
  model, so name the model explicitly.

In chat completions, set `image_config.output_format` to `"svg"`, and the image
arrives as a `data:image/svg+xml;base64,...` URL in `message.images`.

## What AI SVG generation costs

An SVG request does two pieces of work. OpenAI renders a reference image with
GPT Image 2.6, then an authoring model writes the SVG. LLM Gateway bills both
from the usage OpenAI reports:

- the reference image at GPT Image 2.6 rates: $5 per million text input tokens
  and $30 per million image output tokens;
- the authoring model's input and output tokens at that model's published
  rates.

Both are included in `usage.cost` on the response and in the request log, so
you can see what each icon cost. The
[models page](https://llmgateway.io/models?filters=1&imageGeneration=true) lists
current prices, and per-key budgets cap a batch job that generates more icons
than planned.

## Why run it through LLM Gateway

- **One key for every image model.** Use GPT Image 2.6 for vectors, Gemini or
  Seedream for photos, and switch with the `model` field.
- **Cost on every response.** `usage.cost` and the request log show what each
  generation billed, including the SVG authoring tokens.
- **Limits that hold.** Budgets per organization, project, and API key stop a
  runaway loop.

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Read the SVG output docs](https://docs.llmgateway.io/features/image-generation#svg-output)**
- **[See the GPT Image 2.6 changelog](/changelog/gpt-image-2-6-svg)**
