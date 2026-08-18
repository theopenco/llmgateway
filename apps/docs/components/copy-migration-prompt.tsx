"use client";

import { Check, Copy } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

const DOCS_LINKS = `Read these docs first:
- Quick start: https://docs.llmgateway.io/quick-start
- Docs index for anything else: https://docs.llmgateway.io/llms.txt`;

const OUTRO = `When you're done, list every file you changed and anything that needs manual follow-up, like creating an API key at https://llmgateway.io/signup and rotating old secrets. Don't refactor unrelated code.`;

const prompts: Record<string, string> = {
	openrouter: `Migrate this codebase from OpenRouter to LLM Gateway.

${DOCS_LINKS}
- Migration guide: https://docs.llmgateway.io/migrations/openrouter

Then:
1. Find every OpenRouter usage: the base URL https://openrouter.ai/api/v1, the OPENROUTER_API_KEY env var, and OpenRouter-only headers like HTTP-Referer and X-Title.
2. Point the client at https://api.llmgateway.io/v1, read the key from LLM_GATEWAY_API_KEY, and drop the OpenRouter-only headers.
3. Keep model names as they are — LLM Gateway supports the same provider/model format.
4. Update .env.example and any README or docs that mention OpenRouter.

${OUTRO}`,
	"vercel-ai-gateway": `Migrate this codebase from the Vercel AI Gateway to LLM Gateway.

${DOCS_LINKS}
- Migration guide: https://docs.llmgateway.io/migrations/vercel-ai-gateway

Then:
1. Find every AI SDK provider in use (@ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google, the Vercel AI Gateway provider) and their env keys.
2. Install @llmgateway/ai-sdk-provider, create a single provider with createLLMGateway({ apiKey: process.env.LLM_GATEWAY_API_KEY }), and swap model calls like openai("gpt-5.2") to llmgateway("gpt-5.2").
3. Leave the rest of the AI SDK code (generateText, streamText, tools) unchanged — it works as-is.
4. Update .env.example and any README or docs that mention the old providers.

${OUTRO}`,
	litellm: `Migrate this codebase from our LiteLLM proxy to LLM Gateway.

${DOCS_LINKS}
- Migration guide: https://docs.llmgateway.io/migrations/litellm

Then:
1. Find every client that points at the LiteLLM proxy (base URLs like http://localhost:4000/v1), the LITELLM_API_KEY env var, and LiteLLM config files.
2. Point the OpenAI-compatible clients at https://api.llmgateway.io/v1 and read the key from LLM_GATEWAY_API_KEY. Model names can stay the same, or use provider-prefixed IDs like openai/gpt-5.2 to pin a provider.
3. Update .env.example and any README or docs that mention LiteLLM.
4. List the proxy infrastructure (config files, deploy manifests) that can be decommissioned once traffic is verified — but don't delete anything yet.

${OUTRO}`,
};

export function CopyMigrationPrompt({
	slug,
	provider,
}: {
	slug: string;
	provider: string;
}) {
	const posthog = usePostHog();
	const [copied, setCopied] = useState(false);

	const prompt = prompts[slug];
	if (!prompt) {
		return null;
	}

	const handleCopy = async () => {
		await navigator.clipboard.writeText(prompt);
		posthog.capture("docs_migration_prompt_copied", { migration: slug });
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="my-6 rounded-xl border border-fd-border bg-fd-card p-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="my-0 text-sm font-semibold text-fd-foreground">
						Let your AI agent do the migration
					</p>
					<p className="my-0 mt-1 text-[13px] leading-relaxed text-fd-muted-foreground">
						Copy this prompt into Claude Code, Cursor, or any coding agent — it
						reads our docs and handles the migration from {provider} for you.
					</p>
				</div>
				<button
					type="button"
					onClick={handleCopy}
					className="inline-flex w-fit shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
				>
					{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
					{copied ? "Copied!" : "Copy prompt"}
				</button>
			</div>
		</div>
	);
}
