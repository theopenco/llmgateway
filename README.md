# LLM Gateway

LLM Gateway is an open-source API gateway for Large Language Models (LLMs). It acts as a middleware between your applications and various LLM providers, allowing you to:

- Route requests to multiple LLM providers (OpenAI, Anthropic, Google Vertex AI, and others)
- Manage API keys for different providers in one place
- Track token usage and costs across all your LLM interactions
- Analyze performance metrics to optimize your LLM usage

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

1. Install dependencies and set up the development environment:

   ```bash
   pnpm i && pnpm run setup
   ```

   This will install all dependencies, start Docker services, sync the database schema, and seed initial data.

   **Note for WSL2 users**: Ensure Docker Desktop is running with WSL integration enabled.

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

LLMGateway is available under a dual license:

- **Open Source**: Core functionality is licensed under AGPLv3 - see the [LICENSE](LICENSE) file for details.
- **Enterprise**: Commercial features in the `ee/` directory require an Enterprise license - see [ee/LICENSE](ee/LICENSE) for details.

### Enterprise features include:

- Advanced billing and subscription management
- Extended data retention (90 days vs 3 days)
- Provider API key management (Pro plan)
- Team and organization management
- Priority support
- And more to be defined

For enterprise licensing, please contact us at contact@llmgateway.io
