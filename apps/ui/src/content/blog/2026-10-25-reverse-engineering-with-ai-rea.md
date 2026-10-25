---
id: "blog-reverse-engineering-with-ai-rea"
slug: "reverse-engineering-with-ai-rea"
date: "2026-10-25"
title: "Reverse Engineering With AI: REA Setup When Claude Refuses"
summary: "A guide to reverse engineering with AI agents using REA (Reverse Engineer Anything): what it inspects, how to set it up with Claude Code, Codex or OpenCode, why Claude Opus 5.5 and ChatGPT now stop mid-analysis, and which open-weight models (DeepSeek V4, Kimi K3.1, GLM-5.2, Qwen3.7) finish the job through one API key."
categories: ["Guides", "Engineering"]
faqs:
  - question: "What is REA (Reverse Engineer Anything)?"
    answer: "REA is an MIT-licensed MCP server and CLI, published on npm as rea-agents, that gives coding agents tools to reverse engineer software without its source code. It inspects native binaries through Hopper, Ghidra or IDA, and statically analyses JavaScript and Electron apps, .NET assemblies, Go and Rust binaries, firmware images, Unity IL2CPP metadata, WASM and more. Results include the evidence and limitations behind each conclusion. The GitHub repository morluto/rea has over 380,000 stars."
  - question: "Why does Claude refuse reverse engineering requests?"
    answer: "Since October 21, 2026, users on r/Claude have reported that Claude Opus 5.5 starts analysing a target, then a safety guardrail halts the response mid-sentence and it will not reproduce the write-up when reworded. Anthropic has not announced a change. Opus 5.5 launched on September 22, 2026 with safeguards covering cybersecurity, and Anthropic's launch notes state that cyber benchmark tasks the safeguards interrupted were completed by Claude Opus 4.8 instead. Reverse engineering overlaps with security research, which those safeguards cover."
  - question: "Which AI models work best for reverse engineering?"
    answer: "DeepSeek V4 Pro and Kimi K3.1 Pro are the strongest open-weight choices: both reason well over decompiler pseudocode, support tool calling for Ghidra and Hopper bridges, and hold a 1M-token context. GLM-5.2, Qwen3.7 Max and MiniMax M3 are close behind, and DeepSeek V4.1 Flash at $0.15 per million input tokens is the budget pick for bulk function naming. None of them carry a cyber-specific refusal layer."
  - question: "How do I use REA with a non-Anthropic model?"
    answer: "REA registers an MCP server with your agent and does not care which model the agent talks to. For Claude Code, export ANTHROPIC_BASE_URL=https://api.llmgateway.io, ANTHROPIC_AUTH_TOKEN with your LLM Gateway key, and ANTHROPIC_MODEL=deepseek-v4-pro. For Codex, add an llmgateway model provider with base_url https://api.llmgateway.io/v1 and wire_api responses in ~/.codex/config.toml. Ghidra, Hopper and IDA keep running locally."
image:
  src: "/blog/reverse-engineering-with-ai-rea.png"
  alt: "LLM Gateway blog card: Reverse engineering with AI, REA setup when Claude refuses"
  width: 1200
  height: 630
---

Reverse engineering with AI used to mean pasting Hex-Rays output into a chat window and hoping. [REA](https://github.com/morluto/rea), short for Reverse Engineer Anything, replaced that with an agent workflow: an MCP server that lets Claude Code, Codex, Cursor, Gemini CLI, OpenCode or Qwen Code open a binary, trace a feature through Ghidra or Hopper, and come back with evidence. It has 380,000+ GitHub stars and a Discord full of people recompiling games and porting apps.

Then, on October 21, 2026, the model most of them were using started stopping. This post covers what REA does, how to set it up, why Claude Opus 5.5 and ChatGPT now halt reverse-engineering requests, and which models you can put behind the same agent to keep the analysis going. **LLM Gateway** is the piece that makes the swap a one-line change.

## What REA inspects

REA is an MIT-licensed MCP server and CLI, installed from npm as `rea-agents`. Analysis runs locally. Each result ships with the evidence and the limitations behind it, so the agent can say "this function reads the config at offset 0x3f20, here is the cross-reference" rather than guessing.

| Target                            | What REA returns                                                           | Engine                     |
| --------------------------------- | -------------------------------------------------------------------------- | -------------------------- |
| Native binaries (ELF, PE, Mach-O) | Pseudocode, assembly, strings, symbols, calls and references               | Hopper, Ghidra or IDA      |
| JavaScript and Electron apps      | Modules, imports, source maps, routes, IPC and native add-on relationships | Built-in, no engine needed |
| .NET assemblies                   | Metadata, CIL instructions, declared native dependencies                   | Built-in, static only      |
| Go and Rust binaries              | Compiler version, modules, crate names, dependency edges                   | Built-in static inspection |
| Firmware images                   | Regions, extraction results and native-analysis handoffs                   | Binwalk or Unblob on Linux |
| Unity IL2CPP, Godot PCK           | Assembly images, type and method names; archive inventory                  | Built-in                   |
| GPU code objects, model files     | CUDA/HIP kernels, PTX; GGUF and safetensors metadata                       | Built-in                   |
| WASM                              | Sections, imports, exports, decoded WAT                                    | WABT                       |

The prompt the README suggests is the whole pitch: "Understand how search works in the Notes app, show me the evidence, and build a similar feature for my project."

## Set up REA in two commands

```bash
npx rea-agents setup
```

Setup detects your agents, shows the proposed changes, and waits for approval before writing anything. It registers the MCP server, installs a matching skill (into `~/.claude/skills` for Claude Code), and can install Hopper to `~/Applications` on macOS if you let it. Ghidra 12.1.x and IDA use existing installations. Restart the agent afterward.

For a one-off from the terminal, static JavaScript analysis needs no engine:

```bash
npx -y rea-agents@latest analyze-javascript-application /path/to/app --json
```

REA requires Node.js 22.23.4+, 24.22.1+ or 26.12.1+. On Linux, native tool launches need a procps-compatible `ps` on the path.

## Why Claude and ChatGPT stop mid-analysis

On October 21, 2026, a thread on r/Claude reported that Claude Opus 5.5 begins researching a target, then a safety guardrail interrupts the response mid-sentence. In one example the model told the user a safety check had stopped its reply and that it could not produce the write-up again, even reworded. Kotaku picked the story up and reported that Anthropic has not announced or released a new version of Opus 5.5; the pattern is user reports, not a documented change.

The context is in Anthropic's own launch notes. Opus 5.5 shipped on September 22, 2026 with the safeguards developed for its most capable systems, covering biology and cybersecurity. The benchmark footnotes state that when those safeguards intervened during testing, cybersecurity tasks were completed by Claude Opus 4.8 instead. Reverse engineering overlaps with security research, which is squarely inside that scope. Anthropic also said it would expand its Cyber Verification Program so vetted practitioners can use the model; everyone else gets the classifier.

ChatGPT behaves the same way on decompiler output and exploit questions, and has for longer: a paragraph of hedging, an offer to discuss "general principles of memory safety", or a flat refusal. The model has the knowledge. A refusal layer in front of it decides you cannot have it.

Why now is speculation. Kotaku's writer pointed at the wave of AI-assisted game decompilations and the DMCA notices filling GitHub's logs, and at browser ports of commercial games. Others on X linked it to people [modding Samsung TVs with Claude](/blog/hack-samsung-tv-home-screen-with-ai). Whatever the trigger, the practical result is the same: a 1,200-function trace that dies at function 300.

## Models that finish the job

Open-weight models from Chinese labs carry no cyber-specific refusal layer, and the current generation is strong enough at code reasoning to replace Opus for most RE work. The [reverse engineering models page](/models/reverse-engineering) tracks live prices; every model on it supports tool calling, which REA needs for its MCP tools.

| Model               | Input / output per 1M tokens | Context | Why it fits                                                      |
| ------------------- | ---------------------------: | ------: | ---------------------------------------------------------------- |
| DeepSeek V4 Pro     |                $0.43 / $0.87 |      1M | Best open-weight reasoning over pseudocode; whole-binary context |
| Kimi K3.1 Pro       |               $2.00 / $10.00 |      1M | Strongest agentic behaviour in long tool loops                   |
| GLM-5.2             |                $1.40 / $4.40 |      1M | Reliable function naming and cross-reference following           |
| Qwen3.7 Max         |                $2.50 / $7.50 |    983K | Strong on obfuscated JavaScript and .NET                         |
| MiniMax M3          |                $0.60 / $2.40 |    512K | Good value for Electron and web app analysis                     |
| Qwen3 Coder Next    |                $0.11 / $0.68 |    262K | Cheapest tool-calling coder for reimplementation passes          |
| DeepSeek V4.1 Flash |                $0.15 / $0.60 |      1M | Bulk naming and string classification for cents                  |

Among Western models, Grok 4.3 and Gemini 3.1 Pro complete most RE tasks, GPT-5.3 Codex still does well on decompilation when the refusal layer lets it through, and Claude Opus 4.8 is the model Anthropic's own benchmarks fell back to. Claude Opus 5.5 is the one to avoid until Anthropic says otherwise.

A million-token context is not a luxury here. A Ghidra export of a mid-sized binary (pseudocode, strings, cross-references) runs to hundreds of thousands of tokens. On a 128K model the agent reads a window and guesses at the rest.

## Swap the model, keep REA

REA registers with the agent, not with the model, so the swap is a base URL and a key. Claude Code speaks Anthropic's Messages API, which the gateway serves at `/v1/messages`:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY
export ANTHROPIC_MODEL=deepseek-v4-pro
export ANTHROPIC_SMALL_FAST_MODEL=deepseek-v4.1-flash
claude
```

Codex uses the Responses API through a named provider in `~/.codex/config.toml`:

```toml
model = "kimi-k3.1-pro"
model_provider = "llmgateway"

[model_providers.llmgateway]
name = "LLM Gateway"
base_url = "https://api.llmgateway.io/v1"
env_key = "LLM_GATEWAY_API_KEY"
wire_api = "responses"
```

OpenCode, Cursor and Qwen Code take an OpenAI-compatible base URL of `https://api.llmgateway.io/v1` in their provider settings. Then run the same REA prompt that stopped yesterday.

Two gateway features matter for long RE sessions. Prompt caching means the fiftieth question about the same Ghidra export does not pay full price for the export again. And a model ID without a provider prefix gets automatic fallback, so a provider outage three hours into a trace does not end the session.

## Keep the bulk pass cheap

Most of an RE session is bulk work: naming functions, classifying strings, summarising what each module imports. That belongs on DeepSeek V4.1 Flash, not on a $10-per-million model. Give the bulk pass and the final write-up different keys, read the per-request ledger, and you will see the split. In [the Samsung TV project](/blog/hack-samsung-tv-home-screen-with-ai), 893 lookup calls on DeepSeek V4.1 Flash cost $3.53 against $118.51 for the builder model.

## Stay on the right side of the line

REA's maintainers published a [plain-language guide](https://github.com/morluto/rea/discussions/2304) to what is fine and what needs permission, and it is worth reading before you publish anything. Your own code, open-source software, malware in a sandbox and CTF challenges are generally fine. Interoperability and security research carry explicit exemptions in many jurisdictions. Copying closed-source code into a product, circumventing DRM, or probing systems you do not own is where it stops being legal, and publishers are already filing DMCA takedowns over AI-assisted game decompilations.

- **[Try LLM Gateway free](https://llmgateway.io/signup)**: one key for DeepSeek, Kimi, GLM, Qwen and 200+ models, with a cost ledger for every call.
- **[Best models for reverse engineering](/models/reverse-engineering)** and **[best models for cyber security](/models/cyber-security)**, with live prices and tool support.
- **[Anthropic-compatible endpoint docs](https://docs.llmgateway.io/features/anthropic-endpoint)** for the Claude Code setup in detail.
