---
id: blog-claude-code-llmgateway
slug: how-to-configure-claude-code-with-llmgateway
date: 2025-09-08
title: How to configure Claude Code to Use Any Model via LLMGateway
summary: Learn how to configure Claude Code to access any LLM model through LLMGateway's unified API, including models with tool calling support.
categories: ["Guides"]
image:
  src: "/blog/how-to-configure-claude-code-with-llmgateway.png"
  alt: "Configure Claude Code with LLMGateway"
  width: 2282
  height: 1198
---

Claude Code is a powerful CLI tool that can be configured to use any LLM model through LLMGateway's unified API. This guide shows you how to set up Claude Code to access models beyond Anthropic's offerings.

## Why Use LLMGateway with Claude Code?

- **Cost Savings**: Get 50% off for a limited time!
- **Model Diversity**: Access models from OpenAI, Google, Cohere, and more
- **Cost Optimization**: Choose the most cost-effective model for your tasks
- **Unified Interface**: Single configuration for all providers

## Configuration

Set these environment variables to configure Claude Code with LLMGateway:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=llmgtwy_.... # your llmgateway.io api key here
# optionally, choose your model, otherwise it will use the default Claude model via LLMGateway
export ANTHROPIC_MODEL=gpt-5 # choose your model on llmgateway which supports tool calls

# now run claude!
claude
```

### Getting Your API Key

1. Sign up at [llmgateway.io](https://llmgateway.io)
2. Create a project and generate an API key
3. Configure your preferred LLM provider keys in the dashboard

### Choosing a Model

Visit [llmgateway.io/models](https://llmgateway.io/models?filters=1&tools=true) to browse available models with tool calling support. Popular options include:

- `openai/gpt-5` - OpenAI's Flagship GPT-5 model
- `anthropic/claude-sonnet-4-20250514` - Anthropic's default model
- `glm-4.5v` - Similar performance with 50-70% cost savings over Anthropic

## Advanced Configuration

### Model Switching

You can easily switch models by updating the environment variable:

```bash
# Switch to GPT-4o Mini for cost savings
export ANTHROPIC_MODEL=openai/gpt-4o-mini

# Switch to Claude Sonnet for complex reasoning
export ANTHROPIC_MODEL=anthropic/claude-3-5-sonnet-20241022
```

To see the full list of models available to you, check out [models with tool calls](https://llmgateway.io/models?filters=1&tools=true)

### Persistent Configuration

Add the environment variables to your shell profile (`.bashrc`, `.zshrc`, or `.profile`) for persistent configuration:

```bash
echo 'export ANTHROPIC_BASE_URL=https://api.llmgateway.io' >> ~/.zshrc
echo 'export ANTHROPIC_AUTH_TOKEN=llmgtwy_your_key_here' >> ~/.zshrc
echo 'export ANTHROPIC_MODEL=openai/gpt-4o' >> ~/.zshrc
source ~/.zshrc
```

## Benefits

### Cost Management

Track usage and costs across all models in the LLMGateway dashboard. Compare costs between providers to optimize your spending.

### Performance Analytics

Monitor response times, token usage, and success rates to choose the best model for your workflows.

### Reliability

LLMGateway provides automatic failover and retry logic, ensuring Claude Code continues working even if a provider has issues.

## Next Steps

- Explore the [Models page](https://llmgateway.io/models) to discover new models
- Check out [Usage Analytics](https://llmgateway.io/analytics) to optimize costs
- Read more about [LLMGateway features](https://docs.llmgateway.io) in our documentation

With this configuration, Claude Code becomes a gateway to the entire ecosystem of LLM models, giving you the flexibility to choose the right tool for each task.
