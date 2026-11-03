"use client";

import { CodePanel } from "@/components/home/code-panel";
import { usePostHog } from "@/lib/posthog";

import type { BundledLanguage } from "shiki";

const FILE_BY_LANG: Record<string, string> = {
	typescript: "app.ts",
	bash: "terminal",
	json: "request.json",
	markdown: "SKILL.md",
};

function agentPrompt(
	feature: string,
	lang: string,
	code: string,
	docs: string,
) {
	const env = /LLM_?GATEWAY_API_KEY/.exec(code)?.[0];
	const key = env
		? `The snippet reads the API key from the ${env} environment variable. Use exactly that name, set it outside version control, and never hardcode the key.`
		: "Keep the user's LLM Gateway API key out of version control.";
	return `Use LLM Gateway's ${feature} feature in this project.

LLM Gateway is an OpenAI-compatible gateway at https://api.llmgateway.io/v1 that routes to 200+ models with one API key. Create a key at https://llmgateway.io/dashboard. ${key}

Reference snippet:

\`\`\`${lang}
${code}
\`\`\`

Docs: ${docs}
Full docs index for agents: https://docs.llmgateway.io/llms.txt`;
}

export function FeatureCode({
	slug,
	feature,
	title,
	language,
	code,
	docsHref,
}: {
	slug: string;
	feature: string;
	title: string;
	language: string;
	code: string;
	docsHref: string;
}) {
	const posthog = usePostHog();
	return (
		<div className="overflow-hidden rounded-2xl border border-black/10 bg-white p-2 text-[#1f1f24] shadow-[0_30px_80px_-40px_rgba(17,17,19,0.35)] dark:border-white/10 dark:bg-[#0b0b0e] dark:text-[#e8e6df] dark:shadow-2xl">
			<CodePanel
				header={
					<div className="flex border-b border-black/[0.08] p-1.5 dark:border-white/[0.08]">
						<span className="rounded-lg bg-black/[0.06] px-3 py-1.5 text-[13px] font-medium text-foreground dark:bg-white/10">
							{title}
						</span>
					</div>
				}
				file={FILE_BY_LANG[language] ?? "snippet"}
				lang={language as BundledLanguage}
				code={code}
				agentPrompt={agentPrompt(feature, language, code, docsHref)}
				docsHref={docsHref}
				docsLabel="Read docs"
				codeClassName="max-h-[440px]"
				onCopy={(kind) =>
					posthog.capture("snippet_copied", {
						location: "feature_page",
						kind,
						feature: slug,
					})
				}
			/>
		</div>
	);
}
