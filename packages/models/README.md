# @llmgateway/models

Model and provider definitions for [LLM Gateway](https://llmgateway.io) - the unified API for all LLM providers.

## Installation

```bash
npm install @llmgateway/models
```

## Usage

### Models

The `models` array contains all supported LLM models with their pricing and provider mappings:

```typescript
import { models } from "@llmgateway/models";

// Find a specific model
const gpt4 = models.find((m) => m.id === "gpt-4o");

console.log(gpt4.id); // "gpt-4o"
console.log(gpt4.family); // "openai"
console.log(gpt4.contextSize); // 128000
console.log(gpt4.providers); // Provider mappings with pricing
```

#### Model Properties

| Property            | Type                     | Description                                    |
| ------------------- | ------------------------ | ---------------------------------------------- |
| `id`                | `string`                 | Unique model identifier                        |
| `family`            | `string`                 | Model family (openai, anthropic, google, etc.) |
| `contextSize`       | `number`                 | Maximum context window in tokens               |
| `maxOutput`         | `number`                 | Maximum output tokens                          |
| `providers`         | `ProviderModelMapping[]` | Available providers with pricing               |
| `supportsImages`    | `boolean`                | Whether model supports image inputs            |
| `supportsTools`     | `boolean`                | Whether model supports tool/function calling   |
| `supportsReasoning` | `boolean`                | Whether model supports extended reasoning      |
| `free`              | `boolean`                | Whether model is free to use                   |

#### Provider Mapping Properties

| Property           | Type     | Description                        |
| ------------------ | -------- | ---------------------------------- |
| `providerId`       | `string` | Provider identifier                |
| `modelName`        | `string` | Model name at the provider         |
| `inputPrice`       | `number` | Price per input token (USD)        |
| `outputPrice`      | `number` | Price per output token (USD)       |
| `cachedInputPrice` | `number` | Price per cached input token (USD) |
| `contextSize`      | `number` | Provider-specific context size     |
| `maxOutput`        | `number` | Provider-specific max output       |

### Providers

The `providers` array contains all supported LLM providers:

```typescript
import { providers } from "@llmgateway/models";

// List all providers
providers.forEach((p) => {
  console.log(`${p.name}: ${p.description}`);
});

// Find a specific provider
const openai = providers.find((p) => p.id === "openai");
console.log(openai.name); // "OpenAI"
console.log(openai.website); // "https://openai.com"
```

#### Provider Properties

| Property      | Type      | Description                         |
| ------------- | --------- | ----------------------------------- |
| `id`          | `string`  | Unique provider identifier          |
| `name`        | `string`  | Display name                        |
| `description` | `string`  | Provider description                |
| `website`     | `string`  | Provider website URL                |
| `streaming`   | `boolean` | Whether provider supports streaming |
| `color`       | `string`  | Brand color (hex)                   |

## Supported Providers

- OpenAI
- Anthropic
- Google AI Studio
- Google Vertex AI
- Azure OpenAI
- AWS Bedrock
- Mistral
- DeepSeek
- xAI (Grok)
- Perplexity
- And more...

## Full Model List

For the complete list of models with live pricing, visit [llmgateway.io/models](https://llmgateway.io/models).

## License

See [LICENSE](https://github.com/theopenco/llmgateway/blob/main/LICENSE) for details.
