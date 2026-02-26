# Fix: /v1/images/generations URL-based image handling

## Problem

The `/v1/images/generations` endpoint returns a 500 error for providers that return image URLs instead of base64 data URIs (Z.AI, Alibaba, ByteDance). The `extractImagesFromChatResponse` function only matches `data:mime;base64,...` format, silently dropping URL-based images.

Users get charged but receive no image.

## Solution

Make `extractImagesFromChatResponse` async and use the existing `processImageUrl` utility to fetch URL-based images and convert them to base64 before returning to the client.

## Changes

**File**: `apps/gateway/src/images/images.ts`

1. Make `extractImagesFromChatResponse` async
2. In the `images[]` loop, when `img.image_url.url` is not a `data:` URI, call `processImageUrl()` to fetch and convert to base64
3. Add `await` at both call sites (generations handler line 372, edits handler line 675)

## Unchanged

- `data:` URI regex path (Google/Gemini) - untouched
- Content string parsing fallback - untouched
- Error handling pattern (HTTPException propagation)
- Response schema (`b64_json` only)
- Image edits endpoint logic

## Providers

| Provider | Format | Before | After |
|----------|--------|--------|-------|
| Google/Gemini | `data:image/png;base64,...` | Works | Works (unchanged) |
| Z.AI | `https://mfile.z.ai/...` | Broken | Fixed |
| Alibaba | `https://...` URL | Broken | Fixed |
| ByteDance | `https://...` URL | Broken | Fixed |
