---
id: "49"
slug: "grok-build-devpass-agents"
date: "2026-05-22"
title: "Grok Build 0.1 + DevPass works with 20+ coding agents"
summary: "xAI's new coding model Grok Build 0.1 lands in the gateway. DevPass now supports 20+ coding agents including Grok Build, Hermes, Kilo Code, and more."
image:
  src: "/changelog/grok-build-devpass-agents.png"
  alt: "Grok Build 0.1 and DevPass now supports 20+ coding agents"
  width: 1024
  height: 1024
---

## Grok Build 0.1

xAI's fast coding model trained specifically for agentic software engineering is now available through LLM Gateway.

```bash
xai/grok-build-0-1    # $1/M input, $2/M output — 256K context
```

Grok Build 0.1 powers xAI's [Grok Build CLI](https://x.ai) and is optimized for interactive coding agents, tool use, and multi-step development tasks. It supports text and image inputs with structured outputs and reasoning.

**[Try Grok Build in the Playground →](https://llmgateway.io/playground)**

---

## DevPass Now Works with 20+ Coding Agents

DevPass coding plans now automatically detect and allow traffic from all major coding agents — no configuration needed on your side.

**Supported agents:**

| Agent              | Detection                              |
| ------------------ | -------------------------------------- |
| Claude Code        | User-Agent                             |
| Codex CLI          | User-Agent                             |
| Grok Build         | User-Agent                             |
| Hermes Agent       | X-Source, User-Agent, X-Title, Referer |
| OpenCode           | User-Agent                             |
| Kilo Code          | User-Agent                             |
| Roo Code           | User-Agent                             |
| Cline              | User-Agent                             |
| Continue           | User-Agent                             |
| Cursor             | User-Agent                             |
| Windsurf / Codeium | User-Agent                             |
| Aider              | User-Agent                             |
| Zed AI             | User-Agent                             |
| GitHub Copilot     | User-Agent                             |
| n8n                | User-Agent                             |
| SoulForge          | User-Agent                             |
| Pi Agent           | User-Agent                             |
| OpenAI SDK         | User-Agent                             |
| Any \*claw fork    | User-Agent / x-source                  |

Detection uses a multi-layer approach: `x-source` header → User-Agent → X-Title → HTTP-Referer. If your tool sends any recognized signal, it just works.

**[Get DevPass →](https://devpass.llmgateway.io)** | **[View supported agents docs →](https://llmgateway.io/docs/features/coding-agents)**
