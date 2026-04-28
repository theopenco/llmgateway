# OpenAI gpt-image-2 — direct API behaviour

Notes from probing `https://api.openai.com/v1/images/generations` and
`https://api.openai.com/v1/images/edits` with `model=gpt-image-2`.
Captured 2026-04-28.

## Endpoints

- Generations: `POST /v1/images/generations` (JSON body)
- Edits: `POST /v1/images/edits` (multipart/form-data, with `image=@...`)

## Request parameters

| Field   | Type    | Notes                                                                                                                            |
| ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| model   | string  | `gpt-image-2`                                                                                                                    |
| prompt  | string  | Required.                                                                                                                        |
| size    | string  | `WxH` in pixels, or `auto`. See size constraints below.                                                                          |
| quality | string  | `low` \| `medium` \| `high` \| `auto`. Default when omitted is `low`. Any other value (e.g. `standard`) → 400 `invalid_value`.   |
| n       | integer | Optional, number of images.                                                                                                      |
| image   | binary  | Edits endpoint only. `image` for one input, `image[]` for multiple.                                                              |

There is no `1k` / `2k` / `4k` preset — those are not understood by the model. `size` must be a literal `WxH` (or `auto`).

## Size constraints (sent as `size=WxH`)

The API enforces three rules and returns
`type: "image_generation_user_error"`, `code: "invalid_value"`, `param: "size"`
when any of them fails.

1. **Both width and height must be divisible by 16.**
   - `1500x1500` → `Width and height must both be divisible by 16.`
2. **Longest edge must be ≤ 3840.**
   - `4096x4096` → `The longest edge must be less than or equal to 3840.`
3. **Pixel budget (W × H) must be within model bounds.**
   - Below the minimum: `Requested resolution is below the current minimum pixel budget.`
   - Above the maximum: `Requested resolution exceeds the current pixel budget.`

Empirical pixel-budget bounds:

| Size          | Pixels      | Result                  |
| ------------- | ----------- | ----------------------- |
| 768 × 768     | 589,824     | below min budget        |
| 800 × 800     | 640,000     | below min budget        |
| 816 × 816     | 665,856     | OK                      |
| 832 × 832     | 692,224     | OK                      |
| 896 × 896     | 802,816     | OK                      |
| 1024 × 1024   | 1,048,576   | OK                      |
| 3072 × 2160   | 6,635,520   | OK                      |
| 3840 × 2160   | 8,294,400   | OK (max edge = 3840)    |
| 3008 × 3008   | 9,048,064   | exceeds max budget      |
| 3072 × 3072   | 9,437,184   | exceeds max budget      |
| 3840 × 2832   | 10,874,880  | exceeds max budget      |

So in practice: ~666k px ≤ W·H ≤ ~8.3M px, with `max(W, H) ≤ 3840` and both
sides divisible by 16. `size: "auto"` is also accepted and the API picks a
size for you (we observed it returning `1254x1254` for an unconstrained prompt
even though 1254 is not divisible by 16, i.e. the divisibility rule applies
only to user-supplied sizes).

## Quality

Accepted: `low | medium | high | auto`. Anything else is rejected with HTTP 400
and `code: "invalid_value"`. When `quality` is omitted the response reports
`quality: "low"`. `auto` also collapsed to `low` in our test prompt — the
"auto" choice depends on the prompt/size, but the response always echoes the
resolved value, so callers should read it from the response rather than
assuming.

## Response shape

`POST /v1/images/generations` (b64 elided):

```json
{
  "created": 1777371362,
  "background": "opaque",
  "data": [{}],
  "output_format": "png",
  "quality": "low",
  "size": "3072x2160",
  "usage": {
    "input_tokens": 14,
    "input_tokens_details": { "image_tokens": 0, "text_tokens": 14 },
    "output_tokens": 380,
    "output_tokens_details": { "image_tokens": 380, "text_tokens": 0 },
    "total_tokens": 394
  }
}
```

Each entry in `data` carries the image as `b64_json` (default) or `url`,
depending on `response_format`. `quality` and `size` in the top-level body
echo what the model actually used (relevant when `auto` was sent).

### Token accounting

`usage` is split into text and image tokens for both input and output:

- `input_tokens_details.text_tokens` — tokens from the prompt.
- `input_tokens_details.image_tokens` — tokens from input images on the
  edits endpoint (0 for pure generations).
- `output_tokens_details.image_tokens` — tokens charged for the generated
  image (this is what `imageOutputPrice` should price against).
- `output_tokens_details.text_tokens` — always 0 in our tests; gpt-image-2
  does not return text output.

Observed output image-token counts (n=1):

| Size        | Quality | Output image tokens |
| ----------- | ------- | ------------------- |
| 768 × 1024  | low     | 134                 |
| 1024 × 768  | low     | 134                 |
| 896 × 896   | low     | 180                 |
| 960 × 960   | low     | 187                 |
| 1024 × 1024 | low     | 196                 |
| 1024 × 1024 | medium  | 1,756               |
| 1024 × 1024 | high    | 7,024               |
| 1024 × 1024 | auto    | 196 (resolved low)  |
| 2048 × 2048 | low     | 397                 |
| 3840 × 2160 | low     | 371                 |
| 2160 × 3840 | low     | 371                 |
| 3072 × 2160 | low     | 380                 |

Quality dominates the output token count by an order of magnitude:
`low ≈ 200`, `medium ≈ 1.7k`, `high ≈ 7k` at 1024².

### Edits endpoint

Calling `/v1/images/edits` with one ~80 kB JPEG attached as `image`:

```json
"usage": {
  "input_tokens": 524,
  "input_tokens_details": { "image_tokens": 512, "text_tokens": 12 },
  "output_tokens": 196,
  "output_tokens_details": { "image_tokens": 196, "text_tokens": 0 },
  "total_tokens": 720
}
```

So the input image is tokenised and billed via
`input_tokens_details.image_tokens` — that's the field to price against
`inputPrice` (text input remains in `text_tokens`).

## Implications for our gateway

- Drop the `1k` / `2k` / `4k` preset mapping for OpenAI image models. Pass
  `size` straight through to OpenAI as `WxH`, only rejecting `auto` /
  literal `WxH` server-side. Fail with a 4xx (mirroring OpenAI's
  `invalid_value`) when neither pattern matches, before we burn an upstream
  call.
- `quality` should be passed through verbatim from the user — only validate
  it against the `low|medium|high|auto` set.
- For accurate cost attribution, price `output_tokens_details.image_tokens`
  against `imageOutputPrice`, and `input_tokens_details.image_tokens` against
  `inputPrice` (or a future `imageInputPrice` if we want to split it). Don't
  rely on the bare `output_tokens` total because text output tokens for this
  model are always 0 today but the field exists.
