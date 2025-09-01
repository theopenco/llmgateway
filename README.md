# LLM Gateway

LLM Gateway is an open-source API gateway for Large Language Models (LLMs). It acts as a middleware between your applications and various LLM providers, allowing you to:

- Route requests to multiple LLM providers (OpenAI, Anthropic, Google Vertex AI, and others)
- Manage API keys for different providers in one place
- Track token usage and costs across all your LLM interactions
- Analyze performance metrics to optimize your LLM usage
- Build lots of things on top!

## Features

- **Unified API Interface**: Compatible with the OpenAI API format for seamless migration
- **Usage Analytics**: Track requests, tokens used, response times, and costs
- **Multi-provider Support**: Connect to various LLM providers through a single gateway
- **Performance Monitoring**: Compare different models' performance and cost-effectiveness

## Getting Started

You can use LLM Gateway in two ways:

- **Hosted Version**: For immediate use without setup, visit [llmgateway.io](https://llmgateway.io) to create an account and get an API key.
- **Self-Hosted**: Deploy LLM Gateway on your own infrastructure for complete control over your data and configuration.

### Using LLM Gateway API

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -d '{
  "model": "gpt-4o",
  "messages": [
    {"role": "user", "content": "Hello, how are you?"}
  ]
}'
```

## Development Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start development servers:

   ```bash
   pnpm dev
   ```

3. Build for production:
   ```bash
   pnpm build
   ```

## Folder Structure

- `apps/ui`: Vite + React frontend
- `apps/api`: Hono backend
- `apps/gateway`: API gateway for routing LLM requests
- `apps/docs`: Documentation site
- `packages/db`: Drizzle ORM schema and migrations
- `packages/models`: Model and provider definitions
- `packages/shared`: Shared types and utilities

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
