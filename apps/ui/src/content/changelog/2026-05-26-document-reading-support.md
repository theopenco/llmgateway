---
id: "49"
slug: "document-reading-support"
date: "2026-05-26"
title: "Document Reading (PDFs & more)"
summary: "Send PDFs and text-family documents to Gemini models via the OpenAI-compatible `file` content block."
image:
  src: "/changelog/document-reading.png"
  alt: "LLM Gateway now supports document attachments on chat completions"
  width: 1024
  height: 1024
---

LLM Gateway now accepts **document attachments** on chat completions through OpenAI's `file` content block. Send a PDF (or other supported file type) as base64 `file_data` and the gateway forwards it to the model.

```bash
curl -X POST "https://api.llmgateway.io/v1/chat/completions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{
      "role": "user",
      "content": [
        { "type": "text", "text": "Summarize this document." },
        { "type": "file", "file": {
            "filename": "report.pdf",
            "file_data": "data:application/pdf;base64,JVBERi0xLjQK..."
        }}
      ]
    }]
  }'
```

- Initial support on **Google Gemini** via Google AI Studio
- New `document` capability flag on models — filter at [/models?filters=1&document=true](https://llmgateway.io/models?filters=1&document=true)
- Playground accepts file uploads and persists them across sessions and shares
- Clean `400` errors when a model doesn't accept the MIME type, instead of opaque upstream failures

**[Read the docs →](https://docs.llmgateway.io/features/documents)**
