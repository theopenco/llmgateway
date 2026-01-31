---
id: "38"
slug: "agents-templates-cli"
date: "2026-01-30"
title: "AI Agent skills, Agents, Templates & CLI"
summary: "Build AI-powered applications faster with pre-built agents, production-ready templates, and a new CLI tool for scaffolding projects."
image:
  src: "/changelog/agents-templates.png"
  alt: "LLM Gateway agents and templates showcase"
  width: 1408
  height: 768
---

We're excited to introduce a new ecosystem for building AI-powered applications with **LLM Gateway**.

## AI Agents

[Agents](https://llmgateway.io/agents) are pre-built AI agents with tool calling capabilities, ready to integrate and extend for your specific needs.

### Weather Agent

Our first featured agent demonstrates:

- **Tool Calling** — intelligent function execution
- **Real-time Data** — live weather information retrieval
- **Natural Language** — conversational interactions

Built with TypeScript, AI SDK, and OpenAI. Clone it from GitHub and customize for your use case.

**More agents coming soon** — [request an agent](https://github.com/theopenco/llmgateway-templates/issues) you'd like to see.

## Templates

[Templates](https://llmgateway.io/templates) are production-ready starter projects. Clone, customize, and deploy.

### Image Generation Template

Generate images with AI using multiple providers:

- **Multi-Provider Support** — DALL-E, Stable Diffusion, and more
- **Unified API** — single interface for all providers
- **Full-Stack** — Next.js 16 + React 19

**More templates coming soon** — [request a template](https://github.com/theopenco/llmgateway-templates/issues) you'd like to see.

## LLM Gateway CLI

A new command-line tool for scaffolding and managing LLM Gateway projects.

### Quick Start

```bash
npx @llmgateway/cli init
```

### Features

- **Project Scaffolding** — initialize projects from templates
- **Model Discovery** — filter models by capability or provider
- **Extensions** — add tools and API routes to existing projects
- **Development Server** — local development with hot reload
- **Authentication** — secure API key management

### Commands

```bash
# Initialize a new project
npx @llmgateway/cli init --template image-generation --name my-app

# List available templates
npx @llmgateway/cli list

# Browse models
npx @llmgateway/cli models

# Add tools or routes
npx @llmgateway/cli add

# Start dev server
npx @llmgateway/cli dev
```

Read the [CLI documentation](/docs/guides/cli) for more details.

## Agent Skills

We also released [agent-skills](https://github.com/theopenco/agent-skills) — packaged instructions and guidelines for AI coding agents, optimized for use with LLM Gateway and the AI SDK.

Currently includes an **Image Generation skill** covering API integration, frontend rendering, error handling, and performance optimization.

Read the [Agent Skills documentation](/docs/guides/agent-skills) for more details.
