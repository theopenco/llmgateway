---
id: use-case-cyber-security
slug: cyber-security
date: 2026-10-25
title: Cyber security & AI security research
metaTitle: "LLM Gateway for Cyber Security — Code Audits, Log Triage, CTFs"
description: "Run AI security review, log triage, threat modelling, CTF solving and sandboxed malware analysis on one API. Frontier models for defensive work, open-weight models that do not refuse the rest, and a cost ledger for every request."
headline: "One key for every security model: frontier reasoning for the audit, open-weight models for the parts Claude and GPT refuse, and a ledger that shows what each scan cost."
summary: "Put code review, log triage, CTF solving and malware analysis behind one endpoint, route each task to the model that will actually finish it, and track the cost per pipeline."
benefits:
  - title: Frontier models for defensive review
    description: "Claude Opus 4.8, GPT-5.5 and Gemini 3.1 Pro for pull-request audits, threat models and pentest reports — the work where quality matters most and no classifier gets in the way."
  - title: Open-weight models that do not stop
    description: "DeepSeek V4, Kimi K3.1 Pro, GLM-5.2, Qwen3.7 Max and MiniMax M3 carry no cyber-specific refusal layer. Sandboxed malware analysis, CTF challenges and crash triage run to completion."
  - title: Route by task, not by vendor
    description: "Bulk log triage on a $0.15-per-million model, escalation of flagged findings to a frontier model, all on one key. Automatic fallback keeps a long scan alive through a provider outage."
  - title: A cost ledger per pipeline
    description: "Every request is logged with model, tokens, latency and dollar cost. Give the SAST bot, the log-triage job and the red-team agent separate keys and see what each one spends."
faqs:
  - question: Which AI model is best for cyber security?
    answer: "For defensive work — code review, log analysis, threat modelling, report writing — Claude Opus 4.8, GPT-5.5 and Gemini 3.1 Pro produce the most thorough results. For hands-on analysis of malware samples, CTF challenges or crash triage, open-weight models such as DeepSeek V4 Pro, Kimi K3.1 Pro, GLM-5.2 and Qwen3.7 Max finish the task because they are not wrapped in a cyber-specific refusal layer. The full list with live prices is at /models/cyber-security."
  - question: Why do Claude and ChatGPT refuse security prompts?
    answer: "Frontier labs run safety classifiers on cyber-adjacent requests. Anthropic's Claude Opus 5.5 launch post says the model ships with safeguards covering cybersecurity, and that cyber benchmark tasks the safeguards interrupted were completed by Claude Opus 4.8 instead. Since October 21, 2026, users have reported Opus 5.5 halting reverse-engineering answers mid-sentence. Anthropic runs a Cyber Verification Program for vetted practitioners; everyone else needs a model without the classifier."
  - question: Can I run security tooling like REA, Ghidra or a sandbox through the gateway?
    answer: "Yes. The gateway is OpenAI- and Anthropic-compatible, so agents that drive MCP tools — REA for binaries, a Ghidra or Hopper bridge, a Cuckoo or CAPE sandbox wrapper — work by pointing the agent at the gateway base URL. Every model on the cyber security list supports tool calling. Only analyse systems you own or are authorised to test."
  - question: How much does an AI security review cost?
    answer: "A 2,000-line pull request is roughly 25,000 input tokens. On DeepSeek V4.1 Flash that is well under a cent; on Claude Opus 4.8 at $5 per million input tokens it is about 13 cents before output. For a daily log pipeline, run the bulk pass on a budget model and escalate only what it flags — one key covers both and the ledger shows the split."
---

## Security has two kinds of prompts, and one model rarely serves both

Ask a frontier model to audit a pull request for SQL injection, write a threat model for a new service, or turn a pentest's raw findings into a report, and it does excellent work. Ask it to explain what a malware sample in your sandbox is doing, solve a CTF binary, or decide whether a crash is exploitable, and since the Claude Opus 5.5 release on September 22, 2026 there is a growing chance it stops partway through. Anthropic's launch notes say the model ships with cybersecurity safeguards, and that when those safeguards intervened in benchmark testing the tasks were completed by Claude Opus 4.8. Since October 21, 2026, users have reported Opus 5.5 halting reverse-engineering answers mid-sentence. OpenAI and Google apply similar classifiers.

**LLM Gateway** puts both kinds of model behind one endpoint, so a security team can use frontier reasoning where it is allowed and an open-weight model where it is needed, without a second vendor account for either.

## Use the model that will finish the task

The [cyber security models page](/models/cyber-security) lists both groups with live prices. A typical split:

| Task                                     | Model                             | Why                                                  |
| ---------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| Pull-request audit, threat model, report | Claude Opus 4.8, GPT-5.5          | Strongest reasoning; no classifier on defensive work |
| Daily log triage, alert summarisation    | DeepSeek V4.1 Flash, Qwen3.7 Plus | $0.15–$0.40 per million input tokens at bulk volume  |
| Sandboxed malware analysis, CTF, RE      | DeepSeek V4 Pro, Kimi K3.1 Pro    | No cyber refusal layer; 1M context; tool calling     |
| Exploit triage, crash classification     | GLM-5.2, Qwen3.7 Max, MiniMax M3  | Complete the analysis; strong code reasoning         |

Switching is a model string. The request shape does not change.

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [
      {"role": "system", "content": "You are a malware analyst. The sample runs in an isolated sandbox we own."},
      {"role": "user", "content": "Here is the Ghidra pseudocode for the sample'\''s entry point and its decoded strings. What does it persist, what does it exfiltrate, and which IOCs should we block?\n\n..."}
    ]
  }'
```

## Run the agents you already have

Security agents are MCP-driven: REA for binaries and apps, a Ghidra or Hopper bridge for native code, a sandbox wrapper for dynamic analysis, Semgrep or CodeQL for static scans. None of them care which model the agent talks to. Claude Code reads `ANTHROPIC_BASE_URL=https://api.llmgateway.io`; Codex, OpenCode, Cursor and Qwen Code read an OpenAI-compatible base URL. Every model on the cyber security list supports tool calling, so the agent's tools work unchanged. See the [reverse engineering use case](/use-cases/reverse-engineering) for the exact Claude Code and Codex config.

## Keep long scans alive and know what they cost

A full-repository audit or an overnight log sweep is hundreds of requests. Use a model ID without a provider prefix and the gateway retries on another provider when one rate-limits or errors, so the job finishes. Give each pipeline its own API key — the SAST bot, the triage job, the red-team agent — and the ledger shows model, tokens, latency and dollar cost per request, grouped by key. Prompt caching stops you paying full price for the same system prompt and rule set on every call.

## Stay inside the rules

Analyse systems you own or are authorised to test. Malware belongs in a sandbox, CTFs are built to be broken, and interoperability and security research carry explicit exemptions in many jurisdictions. The gateway logs what you send; keep client data out of prompts unless your engagement allows it, and use BYOK with your own provider keys when a contract requires it.

## Get started

Create a key, point your scanner or agent at `https://api.llmgateway.io/v1`, and pick a model from the [cyber security list](/models/cyber-security) for each job.
