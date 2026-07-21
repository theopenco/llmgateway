# Catwalk contribution bundle: LLM Gateway as an official Crush provider

[Crush](https://github.com/charmbracelet/crush) loads its built-in provider and
model list from [charmbracelet/catwalk](https://github.com/charmbracelet/catwalk).
This directory contains everything needed to submit LLM Gateway as an official
provider there:

- `llmgateway.json` — the provider config in catwalk's schema, generated from
  our model catalogue by `scripts/generate-catwalk-provider.ts` (run
  `pnpm tsx scripts/generate-catwalk-provider.ts` to regenerate).
- `main.go` — a generator for catwalk's `cmd/llmgateway/` that rebuilds the
  config from the public `https://api.llmgateway.io/v1/models` endpoint, so
  catwalk maintainers can refresh the model list without our involvement
  (mirrors their `cmd/openrouter` tool).

## How to submit the catwalk PR

1. Fork and clone https://github.com/charmbracelet/catwalk.
2. Copy the files:
   - `llmgateway.json` → `internal/providers/configs/llmgateway.json`
   - `main.go` → `cmd/llmgateway/main.go`
3. Register the provider in `internal/providers/providers.go`:

   ```go
   //go:embed configs/llmgateway.json
   var llmGatewayConfig []byte
   ```

   ```go
   func llmGatewayProvider() catwalk.Provider {
   	return loadProviderFromConfig(llmGatewayConfig)
   }
   ```

   and add `llmGatewayProvider,` to the alphabetical tier of the
   `providerRegistry` list (between `ionetProvider` and `moonshotProvider`
   at the time of writing).

4. Optionally add the ID constant in `pkg/catwalk/provider.go`:

   ```go
   InferenceProviderLLMGateway InferenceProvider = "llmgateway"
   ```

5. Verify: `go run ./cmd/llmgateway` regenerates
   `internal/providers/configs/llmgateway.json`, and `go test ./...` passes.
6. Open the PR with the description below.

## Suggested PR description

> ### Add LLM Gateway provider
>
> This adds [LLM Gateway](https://llmgateway.io) as a provider.
>
> LLM Gateway is an open-source (AGPLv3, self-hostable) LLM API gateway that
> routes requests across many upstream providers through a single
> OpenAI-compatible API with automatic provider selection, failover, caching,
> and cost tracking. Source: https://github.com/theopenco/llmgateway
>
> - `internal/providers/configs/llmgateway.json`: provider config
>   (`openai-compat`, endpoint `https://api.llmgateway.io/v1`, key
>   `$LLMGATEWAY_API_KEY`). Model IDs are gateway-level IDs (no provider
>   prefix), which gives users automatic routing/failover across the upstream
>   providers serving each model.
> - `cmd/llmgateway/main.go`: generator that rebuilds the config from the
>   public models API (`GET https://api.llmgateway.io/v1/models`, no auth
>   required), following the `cmd/openrouter` pattern. Filters match the
>   OpenRouter generator: tool-calling support, text input/output, context
>   window ≥ 20k. Pricing in the API is per-token USD for the cheapest active
>   upstream, so `cost_per_1m_*` reflect the best available price.
>
> API keys can be created at https://llmgateway.io (the platform is also fully
> self-hostable).

## Maintenance

When the model catalogue changes materially (new flagship models, pricing
changes), regenerate `llmgateway.json` with
`pnpm tsx scripts/generate-catwalk-provider.ts` and either open a refresh PR to
catwalk or ask a maintainer to run `go run ./cmd/llmgateway`.
