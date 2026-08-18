interface MigrationPromptParts {
	intro: string;
	steps: string;
	outro?: string;
}

const DEFAULT_OUTRO =
	"When you're done, list every file you changed and anything that needs manual follow-up, like creating an API key at https://llmgateway.io/signup and rotating old secrets. Don't refactor unrelated code.";

const promptParts: Record<string, MigrationPromptParts> = {
	openrouter: {
		intro: "Migrate this codebase from OpenRouter to LLM Gateway.",
		steps: `1. Find every OpenRouter usage: the base URL https://openrouter.ai/api/v1, the OPENROUTER_API_KEY env var, and OpenRouter-only headers like HTTP-Referer and X-Title.
2. Point the client at https://api.llmgateway.io/v1, read the key from LLM_GATEWAY_API_KEY, and drop the OpenRouter-only headers.
3. Keep model names as they are — LLM Gateway supports the same provider/model format.
4. Update .env.example and any README or docs that mention OpenRouter.`,
	},
	"vercel-ai-gateway": {
		intro: "Migrate this codebase from the Vercel AI Gateway to LLM Gateway.",
		steps: `1. Find every AI SDK provider in use (@ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google, the Vercel AI Gateway provider) and their env keys.
2. Install @llmgateway/ai-sdk-provider, create a single provider with createLLMGateway({ apiKey: process.env.LLM_GATEWAY_API_KEY }), and swap model calls like openai("gpt-5.2") to llmgateway("gpt-5.2").
3. Leave the rest of the AI SDK code (generateText, streamText, tools) unchanged — it works as-is.
4. Update .env.example and any README or docs that mention the old providers.`,
	},
	litellm: {
		intro: "Migrate this codebase from our LiteLLM proxy to LLM Gateway.",
		steps: `1. Find every client that points at the LiteLLM proxy (base URLs like http://localhost:4000/v1), the LITELLM_API_KEY env var, and LiteLLM config files.
2. Point the OpenAI-compatible clients at https://api.llmgateway.io/v1 and read the key from LLM_GATEWAY_API_KEY. Model names can stay the same, or use provider-prefixed IDs like openai/gpt-5.2 to pin a provider.
3. Update .env.example and any README or docs that mention LiteLLM.
4. List the proxy infrastructure (config files, deploy manifests) that can be decommissioned once traffic is verified — but don't delete anything yet.`,
	},
	portkey: {
		intro: "Migrate this codebase from Portkey to LLM Gateway.",
		steps: `1. Find every Portkey usage: the portkey-ai SDK, the base URL https://api.portkey.ai/v1, x-portkey-* headers, and virtual keys or config IDs.
2. Replace them with the standard OpenAI SDK pointed at https://api.llmgateway.io/v1, authenticated with a Bearer token from LLM_GATEWAY_API_KEY — no custom headers or virtual keys.
3. Pick providers via the model ID (e.g. openai/gpt-5.2) or use the bare model ID for smart routing. Note that provider keys move to the LLM Gateway dashboard under Settings > Provider Keys.
4. Update .env.example and any README or docs that mention Portkey.`,
	},
	"github-copilot": {
		intro:
			"Move this project's AI coding workflows off GitHub Copilot's metered AI Credits and onto LLM Gateway.",
		steps: `1. Ask me which coding agent I want (DevPass Code, Claude Code, Cline, Continue, or Codex CLI) and set it up to run through the gateway — for Claude Code that means setting ANTHROPIC_BASE_URL=https://api.llmgateway.io and ANTHROPIC_AUTH_TOKEN to my LLM Gateway API key.
2. If this repo runs Copilot code review in CI, replace it with a workflow that reviews diffs via https://api.llmgateway.io/v1/chat/completions.
3. Tell me which spend caps to set (per organization, project, and API key) in the LLM Gateway dashboard before rollout.`,
		outro:
			"I'll create an API key at https://llmgateway.io/signup. Inline completions can stay on Copilot's flat-fee plan — only chat and agentic workflows move. Don't refactor unrelated code.",
	},
};

export function getMigrationPrompt(slug: string, fromProvider: string): string {
	const parts = promptParts[slug] ?? {
		intro: `Migrate this codebase from ${fromProvider} to LLM Gateway.`,
		steps: `1. Find every place this codebase calls ${fromProvider}: base URLs, SDK clients, env vars, and custom headers.
2. Point the OpenAI-compatible client at https://api.llmgateway.io/v1 and read the key from LLM_GATEWAY_API_KEY.
3. Update .env.example and any README or docs that mention ${fromProvider}.`,
	};

	return `${parts.intro}

Read these docs first:
- Migration guide: https://llmgateway.io/migration/${slug}
- Quick start: https://docs.llmgateway.io/quick-start
- Docs index for anything else: https://docs.llmgateway.io/llms.txt

Then:
${parts.steps}

${parts.outro ?? DEFAULT_OUTRO}`;
}
