---
id: "11"
slug: "ai-sdk-provider-v2"
date: "2025-08-07"
title: "AI SDK Provider v2.0 Released"
summary: "Released v2.0 of our @llmgateway/ai-sdk-provider npm package with improved Vercel AI SDK integration and simplified model access."
draft: true
image:
  src: "/changelog/ai-sdk-provider-v2.png"
  alt: "AI SDK Provider v2.0 package integration with code examples"
  width: 800
  height: 400
---

We're excited to announce the release of v2.0 of our [@llmgateway/ai-sdk-provider](https://www.npmjs.com/package/@llmgateway/ai-sdk-provider) npm package, making it even easier to integrate LLM Gateway with the Vercel AI SDK.

## 🚀 What's New in v2.0

Enhanced integration with the Vercel AI SDK for seamless model access across all our supported providers and models.

## 📦 Installation

```bash
npm install @llmgateway/ai-sdk-provider
```

## 🔧 Quick Start

Simple and intuitive API for accessing any model through our unified gateway:

```javascript
import { llmgateway } from "@llmgateway/ai-sdk-provider";
import { generateText } from "ai";

const { text } = await generateText({
  model: llmgateway("openai/gpt-4o"),
  prompt: `What's up?`,
});

console.log(`output: ${text}`);
```

## ✨ Key Features

**Unified Model Access**: Use any of our 40+ models with the same simple interface

**Provider Agnostic**: Switch between OpenAI, Anthropic, Groq, and other providers seamlessly

**Full AI SDK Compatibility**: Works with all Vercel AI SDK functions including `generateText`, `streamText`, and `generateObject`

**TypeScript Support**: Full type safety and IntelliSense support

## 🎯 Supported Models

Access all models using the familiar provider/model format:

- `openai/gpt-4o`
- `anthropic/claude-3-5-sonnet-20241022`
- `groq/llama-3.1-70b-versatile`
- And 40+ more models across 14+ providers

Check out the [full documentation](https://docs.llmgateway.io/quick-start#3--sdk-integrations) and explore the package on [npm](https://www.npmjs.com/package/@llmgateway/ai-sdk-provider?utm_source=llmgateway.io).
