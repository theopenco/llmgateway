---
id: use-case-healthcare
slug: healthcare
date: 2026-11-20
title: LLM gateway for healthcare
metaTitle: "LLM Gateway for Healthcare — Control Where Patient Data Goes"
description: "An LLM gateway for healthcare teams: restrict which providers receive requests, redact sensitive data with guardrails, control payload retention, and self-host the gateway in your own infrastructure."
headline: "Decide which providers can receive a request, and what data is allowed to leave."
summary: "Provider compliance policies, guardrails, retention controls, audit logs, and a self-hostable core for teams handling sensitive health data."
benefits:
  - title: Restrict routing to approved providers
    description: "Provider compliance policies on the Enterprise plan limit routing to providers that meet the requirements you set, and fail closed when none do."
  - title: Redact before data leaves
    description: "Enterprise guardrails can detect and redact personal data in a prompt before the request reaches a model provider."
  - title: Control what the gateway stores
    description: "Each organization chooses whether the gateway retains request payloads."
  - title: Run it in your own infrastructure
    description: "The AGPLv3 core can be self-hosted, so requests pass through infrastructure you operate."
faqs:
  - question: Is LLM Gateway HIPAA compliant?
    answer: "LLM Gateway holds a SOC 2 Type II report. It does not by itself make an application HIPAA compliant: you remain responsible for your agreements with each model provider and for how protected health information is handled. Contact us to discuss enterprise terms for your use case."
  - question: Can we control which model providers receive our requests?
    answer: "Yes. Provider compliance policies, available on the Enterprise plan, restrict routing to providers that meet the requirements you choose. If no provider qualifies, the request is rejected instead of being sent elsewhere."
  - question: Can sensitive data be removed from prompts automatically?
    answer: "Guardrails on the Enterprise plan can detect personal data in a request and block or redact it before the request reaches a provider."
  - question: Does the gateway store prompts and responses?
    answer: "That is configurable per organization. You choose whether request payloads are retained, and the open-source core can be self-hosted if you need requests to stay inside your own infrastructure."
---

## Sensitive data needs a controlled path to the model

Healthcare teams want what LLMs offer: summarizing notes, drafting messages, answering questions over documents. The obstacle is control. Each provider has different retention terms, and a direct integration gives every developer the ability to send any data to any model.

An **LLM gateway for healthcare** puts one control point in front of every model. **LLM Gateway** lets you decide which providers are allowed, what is redacted, and what is stored.

## Restrict which providers can be used

[Provider compliance policies](https://docs.llmgateway.io/features/compliance) are available on the **Enterprise plan**. You set requirements, and routing is limited to providers that meet them. When none qualify, the request is rejected.

## Redact before the request leaves

[Guardrails](https://docs.llmgateway.io/features/guardrails), also on the **Enterprise plan**, inspect prompts for personal data and can block or redact matches before a provider sees them.

## Control retention and keep an audit trail

Choose per organization whether the gateway stores request payloads; see [data retention](https://docs.llmgateway.io/features/data-retention). Audit logs on the **Enterprise plan** record configuration and access changes for review.

## Self-host when requests must stay inside

The core gateway is open source under AGPLv3 and can run in your own infrastructure.

## What the gateway does not do

LLM Gateway is infrastructure, not a compliance certification for your product. Your agreements with model providers, and how you handle protected health information, remain your responsibility. LLM Gateway itself holds a [SOC 2 Type II report](/blog/soc2-type-ii).

- **[Talk to us about Enterprise](https://llmgateway.io/enterprise)**
- **[Read the compliance checklist](/blog/llm-compliance-checklist)**
- **[Read the docs](https://docs.llmgateway.io/features/compliance)**
