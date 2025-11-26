---
id: "1"
slug: "gateway-v1-launch"
date: "2025-05-01"
title: "LLM Gateway v1.0 Launch"
summary: "The unified AI gateway is here! Access 30+ models from 8 providers through one OpenAI-compatible API with transparent pricing and powerful analytics."
image:
  src: "/opengraph.png"
  alt: "LLM Gateway v1.0 launch featuring multi-provider support and unified API"
  width: 1768
  height: 677
---

🎉 **Welcome to LLM Gateway v1.0!** We're excited to launch the most comprehensive AI gateway platform, bringing together 30+ leading AI models from 8 providers under one unified, developer-friendly API.

## 🌟 Unified Multi-Provider Access

### Single API for All Providers

Access the best AI models through one consistent interface:

**OpenAI-compatible API** Drop-in replacement for OpenAI's API

**Unified `/v1/chat/completions` endpoint** Same endpoint for all providers

**Consistent authentication** One API key for all models

**Standard response format** Predictable JSON responses across providers

### 8 Supported Providers

We launch with comprehensive provider support:

[See all models supported](/models)

## 🚀 Intelligent Request Routing

Smart routing ensures optimal performance:

**Automatic failover** Seamless switching when providers are down

**Load balancing** Distribute requests across multiple providers

**Cost optimization** Route to most cost-effective provider

**Auto model selection** Use `llmgateway/auto` for intelligent model routing

### Provider-Specific Routing

Fine-grained control over model selection:

```javascript
// Use specific provider
model: "openai/gpt-4o";
model: "anthropic/claude-3-5-sonnet";
model: "google-ai-studio/gemini-2.0-flash";

// Automatic routing
model: "llmgateway/auto";
```

## 💳 Flexible Billing System

### Credit-Based Usage

Simple, transparent pricing:

**Pay-as-you-go** Only pay for what you use

**No monthly minimums** Perfect for experimentation

**Transparent pricing** See exact costs before making requests

**Auto top-up** Never run out of credits with configurable thresholds

### Three Project Modes

Choose the billing approach that works for you:

**Credits Mode** - Use our credit system with transparent pricing

**API Keys Mode** - Use your own provider API keys (Pro plan)

**Hybrid Mode** - Automatic fallback between API keys and credits

## 📊 Comprehensive Analytics

### Real-Time Monitoring

Track every API call with detailed insights:

**Request logs** Complete request/response data with 30-day retention

**Performance metrics** Response times, success rates, and error tracking

**Cost analytics** Real-time spending across all providers

**Usage patterns** Identify peak usage times and optimization opportunities

### Advanced Filtering

Multi-dimensional analytics:

**Date ranges** Custom time periods from hours to months

**Provider comparison** Performance across different providers

**Model utilization** See which models are most popular

**Error analysis** Detailed error tracking and debugging

## 🔧 Pro Plan Features

### Use Your Own API Keys

The biggest Pro feature - use your own provider keys **without any surcharges**:

**Direct cost control** Pay providers directly at their rates

**0% LLM Gateway fees** No markup on your API key usage

**Hybrid mode** Automatic fallback to credits when keys hit limits

**Full transparency** See exactly what you're paying each provider

### Enhanced Billing Management

**Flexible billing** Monthly ($50) or yearly ($500, save 20%)

**Auto top-up** Configurable credit thresholds and amounts

**Transaction history** Complete payment records and invoices

**Subscription management** Easy upgrades, downgrades, and cancellations

## 🎯 Getting Started

### Quick Setup

Start using LLM Gateway in minutes:

**Sign up** - Create your free account at [llmgateway.io](/)

**Get API key** - Generate your authentication key

**Make first request** - Start with $5 free credits

**Explore models** - Try different providers and models

### Free Tier Benefits

Generous free tier to get started:

**$5 free credits** Enough for thousands of requests

**All providers** Access to every supported provider

**Full features** No limitations on functionality

**3-day data retention** Request logs and analytics

### OpenAI Drop-in Replacement

Migrate existing applications effortlessly:

```javascript
// Just change the base URL - everything else stays the same
const openai = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: "your-llmgateway-key",
});
```

## 🔒 Enterprise Security

Built with security in mind:

**SOC 2 compliance** Enterprise security standards

**TLS encryption** All data encrypted in transit

**API key authentication** Secure access control

**GDPR compliant** Privacy-first data handling

## 🌐 High Availability

Reliable service you can depend on:

**99.9% uptime SLA** Reliable service guarantee

**Multi-region deployment** Global availability

**Automatic scaling** Handle traffic spikes seamlessly

**Proactive monitoring** Real-time issue detection and resolution

---

LLM Gateway makes it easier than ever to build with AI. **[Get started today](/)** and experience the future of AI development!
