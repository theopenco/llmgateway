"use client";

import { ArrowUpRight, Check, Copy, Sparkles } from "lucide-react";
import { useTheme } from "next-themes";
import { usePostHog } from "posthog-js/react";
import { Fragment, useEffect, useState } from "react";

import { ProviderLogo } from "@/components/landing/provider-logo";
import { cn } from "@/lib/utils";

import type dimensions from "@/lib/provider-logo-dimensions.json";
import type { CSSProperties } from "react";
import type { BundledLanguage, Highlighter, ThemedToken } from "shiki";

const DOCS = "https://docs.llmgateway.io";
const API = "https://api.llmgateway.io/v1";

interface FeaturedModel {
	id: string;
	label: string;
	logo: keyof typeof dimensions;
}

const MODELS: FeaturedModel[] = [
	{ id: "gpt-5.5", label: "OpenAI", logo: "openai" },
	{ id: "claude-sonnet-5", label: "Anthropic", logo: "anthropic" },
	{ id: "gemini-3.1-pro-preview", label: "Gemini", logo: "google-ai-studio" },
	{ id: "grok-4-7", label: "xAI", logo: "xai" },
	{ id: "deepseek-v4-flash", label: "DeepSeek", logo: "deepseek" },
	{ id: "kimi-k3", label: "Kimi", logo: "moonshot" },
];

type Lang = BundledLanguage;

interface Snippet {
	label: string;
	lang: Lang;
	code: (model: string) => string;
	endpoint?: string;
	usesModel?: boolean;
}

interface Variant {
	label: string;
	file: string;
	docs: string;
	snippets: Snippet[];
	usesModel?: boolean;
}

interface Section {
	label: string;
	variants: Variant[];
}

const IMAGE_MODEL = "gemini-3-pro-image";

const tsClient = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${API}",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});`;

const pyClient = `import os
from openai import OpenAI

client = OpenAI(
    base_url="${API}",
    api_key=os.environ["LLM_GATEWAY_API_KEY"],
)`;

const curlHead = (path: string) => `curl ${API}${path} \\
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\
  -H "Content-Type: application/json" \\`;

const SECTIONS: Section[] = [
	{
		label: "API",
		variants: [
			{
				label: "AI SDK",
				file: "app.ts",
				docs: `${DOCS}/developers/ai-sdk`,
				usesModel: true,
				snippets: [
					{
						label: "TypeScript",
						lang: "typescript",
						code: (
							m,
						) => `import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { streamText } from "ai";

const llmgateway = createLLMGateway({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const result = streamText({
  model: llmgateway("${m}"),
  prompt: "Why is the sky blue?",
});`,
					},
				],
			},
			{
				label: "Chat Completions",
				file: "app",
				docs: `${DOCS}/v1_chat_completions`,
				usesModel: true,
				snippets: [
					{
						label: "TypeScript",
						lang: "typescript",
						endpoint: "POST /v1/chat/completions",
						code: (m) => `${tsClient}

const res = await client.chat.completions.create({
  model: "${m}",
  messages: [{ role: "user", content: "Why is the sky blue?" }],
});`,
					},
					{
						label: "Python",
						lang: "python",
						endpoint: "POST /v1/chat/completions",
						code: (m) => `${pyClient}

res = client.chat.completions.create(
    model="${m}",
    messages=[{"role": "user", "content": "Why is the sky blue?"}],
)`,
					},
				],
			},
			{
				label: "Responses",
				file: "app",
				docs: `${DOCS}/quick-start`,
				usesModel: true,
				snippets: [
					{
						label: "TypeScript",
						lang: "typescript",
						endpoint: "POST /v1/responses",
						code: (m) => `${tsClient}

const res = await client.responses.create({
  model: "${m}",
  input: "Why is the sky blue?",
});

console.log(res.output_text);`,
					},
					{
						label: "Python",
						lang: "python",
						endpoint: "POST /v1/responses",
						code: (m) => `${pyClient}

res = client.responses.create(
    model="${m}",
    input="Why is the sky blue?",
)

print(res.output_text)`,
					},
				],
			},
			{
				label: "Images",
				file: "app",
				docs: `${DOCS}/features/image-generation`,
				snippets: [
					{
						label: "TypeScript",
						lang: "typescript",
						endpoint: "POST /v1/images/generations",
						code: () => `${tsClient}

const image = await client.images.generate({
  model: "${IMAGE_MODEL}",
  prompt: "A lighthouse at dusk, watercolor",
  size: "1024x1024",
});`,
					},
					{
						label: "Python",
						lang: "python",
						endpoint: "POST /v1/images/generations",
						code: () => `${pyClient}

image = client.images.generate(
    model="${IMAGE_MODEL}",
    prompt="A lighthouse at dusk, watercolor",
    size="1024x1024",
)`,
					},
					{
						label: "Edits",
						lang: "bash",
						endpoint: "POST /v1/images/edits",
						code: () => `${curlHead("/images/edits")}
  -d '{
    "model": "${IMAGE_MODEL}",
    "prompt": "Turn this photo into a watercolor painting",
    "images": [{ "image_url": "https://example.com/photo.png" }]
  }'`,
					},
				],
			},
			{
				label: "cURL",
				file: "terminal",
				docs: `${DOCS}/quick-start`,
				usesModel: true,
				snippets: [
					{
						label: "Chat",
						lang: "bash",
						endpoint: "POST /v1/chat/completions",
						code: (m) => `${curlHead("/chat/completions")}
  -d '{
    "model": "${m}",
    "messages": [
      { "role": "user", "content": "Why is the sky blue?" }
    ]
  }'`,
					},
					{
						label: "Responses",
						lang: "bash",
						endpoint: "POST /v1/responses",
						code: (m) => `${curlHead("/responses")}
  -d '{
    "model": "${m}",
    "input": "Why is the sky blue?"
  }'`,
					},
					{
						label: "Images",
						lang: "bash",
						endpoint: "POST /v1/images/generations",
						usesModel: false,
						code: () => `${curlHead("/images/generations")}
  -d '{
    "model": "${IMAGE_MODEL}",
    "prompt": "A lighthouse at dusk, watercolor",
    "size": "1024x1024"
  }'`,
					},
					{
						label: "Image edits",
						lang: "bash",
						endpoint: "POST /v1/images/edits",
						usesModel: false,
						code: () => `${curlHead("/images/edits")}
  -d '{
    "model": "${IMAGE_MODEL}",
    "prompt": "Turn this photo into a watercolor painting",
    "images": [{ "image_url": "https://example.com/photo.png" }]
  }'`,
					},
				],
			},
			{
				label: "Any language",
				file: "main",
				docs: `${DOCS}/quick-start`,
				usesModel: true,
				snippets: [
					{
						label: "Go",
						lang: "go",
						code: (
							m,
						) => `config := openai.DefaultConfig(os.Getenv("LLM_GATEWAY_API_KEY"))
config.BaseURL = "${API}"
client := openai.NewClientWithConfig(config)

res, err := client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
    Model: "${m}",
    Messages: []openai.ChatCompletionMessage{
        {Role: openai.ChatMessageRoleUser, Content: "Why is the sky blue?"},
    },
})`,
					},
					{
						label: "Ruby",
						lang: "ruby",
						code: (m) => `require "openai"

client = OpenAI::Client.new(
  access_token: ENV["LLM_GATEWAY_API_KEY"],
  uri_base: "${API}"
)

res = client.chat(parameters: {
  model: "${m}",
  messages: [{ role: "user", content: "Why is the sky blue?" }]
})`,
					},
					{
						label: "PHP",
						lang: "php",
						code: (m) => `<?php
$client = OpenAI::factory()
    ->withApiKey(getenv('LLM_GATEWAY_API_KEY'))
    ->withBaseUri('${API}')
    ->make();

$res = $client->chat()->create([
    'model' => '${m}',
    'messages' => [['role' => 'user', 'content' => 'Why is the sky blue?']],
]);`,
					},
					{
						label: "Java",
						lang: "java",
						code: (m) => `OpenAIClient client = OpenAIOkHttpClient.builder()
    .apiKey(System.getenv("LLM_GATEWAY_API_KEY"))
    .baseUrl("${API}")
    .build();

ChatCompletion res = client.chat().completions().create(
    ChatCompletionCreateParams.builder()
        .model("${m}")
        .addUserMessage("Why is the sky blue?")
        .build());`,
					},
					{
						label: "Rust",
						lang: "rust",
						code: (m) => `let config = OpenAIConfig::new()
    .with_api_base("${API}")
    .with_api_key(std::env::var("LLM_GATEWAY_API_KEY")?);
let client = Client::with_config(config);

let req = CreateChatCompletionRequestArgs::default()
    .model("${m}")
    .messages([ChatCompletionRequestUserMessageArgs::default()
        .content("Why is the sky blue?")
        .build()?
        .into()])
    .build()?;
let res = client.chat().create(req).await?;`,
					},
				],
			},
		],
	},
	{
		label: "Coding agents",
		variants: [
			{
				label: "DevPass Code",
				file: "terminal",
				docs: "/guides/devpass-code",
				usesModel: true,
				snippets: [
					{
						label: "Shell",
						lang: "bash",
						code: (m) => `pnpm add -g devpass-code

# A key from llmgateway.io/dashboard or your DevPass plan
export LLMGATEWAY_API_KEY="your_api_key"

cd your-project
devpass-code --model llmgateway/${m}`,
					},
				],
			},
			{
				label: "CLI",
				file: "terminal",
				docs: `${DOCS}/developers/cli`,
				usesModel: true,
				snippets: [
					{
						label: "Shell",
						lang: "bash",
						code: (m) => `# Sign in once, or export LLMGATEWAY_API_KEY
npx @llmgateway/cli auth login --key

# Launch any coding agent, pre-wired to LLM Gateway
npx @llmgateway/cli launch -m ${m} claude
npx @llmgateway/cli launch -m ${m} codex
npx @llmgateway/cli launch -m ${m} opencode

# See every supported agent
npx @llmgateway/cli launch --list`,
					},
				],
			},
			{
				label: "Claude Code",
				file: "terminal",
				docs: "/guides/claude-code",
				usesModel: true,
				snippets: [
					{
						label: "Shell",
						lang: "bash",
						code: (m) => `export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=$LLMGATEWAY_API_KEY
export ANTHROPIC_MODEL=${m}

claude`,
					},
				],
			},
			{
				label: "Codex",
				file: "~/.codex/config.toml",
				docs: "/guides/codex-cli",
				usesModel: true,
				snippets: [
					{
						label: "TOML",
						lang: "toml",
						code: (m) => `model = "${m}"
model_provider = "llmgateway"

[model_providers.llmgateway]
name = "LLM Gateway"
base_url = "${API}"
env_key = "LLMGATEWAY_API_KEY"
wire_api = "responses"`,
					},
				],
			},
			{
				label: "OpenCode",
				file: "opencode.json",
				docs: "/guides/opencode",
				usesModel: true,
				snippets: [
					{
						label: "JSON",
						lang: "json",
						code: (m) => `{
  "provider": {
    "llmgateway": {
      "options": {
        "apiKey": "{env:LLMGATEWAY_API_KEY}"
      }
    }
  },
  "model": "llmgateway/${m}"
}`,
					},
				],
			},
			{
				label: "Empryo",
				file: "terminal",
				docs: "/guides/empryo",
				usesModel: true,
				snippets: [
					{
						label: "Shell",
						lang: "bash",
						code: (m) => `# Sign in with your LLM Gateway account
empryo --login llmgateway

# Or reuse an existing key
export LLM_GATEWAY_API_KEY="your_api_key"

cd your-project
empryo --headless --model llmgateway/${m} \\
  "Fix the failing test and run it again"`,
					},
				],
			},
		],
	},
	{
		label: "MCP",
		variants: [
			{
				label: "Claude Code",
				file: "terminal",
				docs: `${DOCS}/developers/mcp`,
				snippets: [
					{
						label: "Shell",
						lang: "bash",
						code: () => `claude mcp add --transport http --scope user \\
  llmgateway https://api.llmgateway.io/mcp \\
  --header "Authorization: Bearer $LLM_GATEWAY_API_KEY"`,
					},
				],
			},
			{
				label: "Codex",
				file: "terminal",
				docs: `${DOCS}/developers/mcp`,
				snippets: [
					{
						label: "Shell",
						lang: "bash",
						code: () => `codex mcp add llmgateway \\
  --url https://api.llmgateway.io/mcp \\
  --bearer-token-env-var LLM_GATEWAY_API_KEY`,
					},
				],
			},
			{
				label: "Cursor & others",
				file: "mcp.json",
				docs: `${DOCS}/developers/mcp`,
				snippets: [
					{
						label: "JSON",
						lang: "json",
						code: () => `{
  "mcpServers": {
    "llmgateway": {
      "url": "https://api.llmgateway.io/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`,
					},
				],
			},
		],
	},
];

const LANGS: Lang[] = [
	"typescript",
	"python",
	"bash",
	"go",
	"ruby",
	"php",
	"java",
	"rust",
	"toml",
	"json",
];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
	highlighterPromise ??= import("shiki").then(({ createHighlighter }) =>
		createHighlighter({
			langs: LANGS,
			themes: ["github-light", "vitesse-dark"],
		}),
	);
	return highlighterPromise;
}

function tokenStyle(token: ThemedToken): CSSProperties {
	const fontStyle = token.fontStyle ?? 0;
	return {
		color: token.color,
		fontStyle: fontStyle & 1 ? "italic" : undefined,
		fontWeight: fontStyle & 2 ? 600 : undefined,
	};
}

function agentPrompt(
	section: Section,
	variant: Variant,
	snippet: Snippet,
	code: string,
) {
	const names: Record<string, string> = {
		CLI: "the LLM Gateway CLI (@llmgateway/cli)",
		"Any language": snippet.label,
		"Cursor & others": "Cursor or another MCP client",
	};
	const target =
		names[variant.label] ??
		(variant.snippets.length > 1
			? `${variant.label} (${snippet.label})`
			: variant.label);
	const task =
		section.label === "API"
			? `Integrate LLM Gateway into this project using ${target}.`
			: section.label === "MCP"
				? `Connect ${target} to the LLM Gateway MCP server.`
				: `Set up ${target} to use LLM Gateway.`;
	const env = /LLM_?GATEWAY_API_KEY/.exec(code)?.[0];
	const key = env
		? `The snippet reads the API key from the ${env} environment variable. Use exactly that name, set it outside version control, and never hardcode the key.`
		: "Replace YOUR_API_KEY with the user's LLM Gateway API key and keep that file out of version control.";
	const docs = variant.docs.startsWith("/")
		? `https://llmgateway.io${variant.docs}`
		: variant.docs;
	return `${task}

LLM Gateway is an OpenAI-compatible gateway at ${API} that routes to 200+ models with one API key. Create a key at https://llmgateway.io/dashboard. ${key}

Reference snippet:

\`\`\`${snippet.lang}
${code}
\`\`\`

Docs: ${docs}
Full docs index for agents: ${DOCS}/llms.txt
Model catalogue: https://llmgateway.io/models`;
}

const FILE_BY_LANG: Partial<Record<Lang, string>> = {
	typescript: "app.ts",
	python: "app.py",
	bash: "terminal",
	go: "main.go",
	ruby: "app.rb",
	php: "app.php",
	java: "Main.java",
	rust: "main.rs",
};

function fileName(variant: Variant, snippet: Snippet) {
	if (snippet.lang === "toml" || snippet.lang === "json") {
		return variant.file;
	}
	return FILE_BY_LANG[snippet.lang] ?? variant.file;
}

function Tab({
	active,
	onClick,
	children,
	size = "md",
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
	size?: "md" | "sm" | "xs";
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onClick}
			className={cn(
				"shrink-0 whitespace-nowrap rounded-lg font-medium transition-colors",
				size === "md"
					? "px-3.5 py-2 text-sm"
					: size === "sm"
						? "px-3 py-1.5 text-[13px]"
						: "px-2.5 py-1 text-xs",
				active
					? "bg-black/[0.06] text-foreground dark:bg-white/10"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

export function DeveloperSnippet() {
	const posthog = usePostHog();
	const { resolvedTheme } = useTheme();
	const [sectionIdx, setSectionIdx] = useState(0);
	const [variantIdx, setVariantIdx] = useState(0);
	const [snippetIdx, setSnippetIdx] = useState(0);
	const [model, setModel] = useState(MODELS[1].id);
	const [copied, setCopied] = useState<"code" | "agent" | null>(null);
	const [highlighted, setHighlighted] = useState<{
		key: string;
		tokens: ThemedToken[][];
	} | null>(null);

	const section = SECTIONS[sectionIdx];
	const variant = section.variants[variantIdx] ?? section.variants[0];
	const snippet = variant.snippets[snippetIdx] ?? variant.snippets[0];
	const code = snippet.code(model);
	const theme = resolvedTheme === "dark" ? "vitesse-dark" : "github-light";
	const key = `${theme}\u0000${snippet.lang}\u0000${code}`;
	const tokens = highlighted?.key === key ? highlighted.tokens : null;

	useEffect(() => {
		let cancelled = false;
		void getHighlighter()
			.then((highlighter) => {
				if (cancelled) {
					return;
				}
				const result = highlighter.codeToTokens(code, {
					lang: snippet.lang,
					theme,
				});
				setHighlighted({ key, tokens: result.tokens });
			})
			.catch(() => {
				if (!cancelled) {
					setHighlighted(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [code, snippet.lang, theme, key]);

	const lines = code.split("\n");
	const docsExternal = !variant.docs.startsWith("/");

	const copy = async (kind: "code" | "agent") => {
		const text =
			kind === "code" ? code : agentPrompt(section, variant, snippet, code);
		try {
			await navigator.clipboard.writeText(text);
			setCopied(kind);
			posthog.capture("snippet_copied", {
				location: "home_developers",
				kind,
				section: section.label,
				variant: variant.label,
				snippet: snippet.label,
				model,
			});
			setTimeout(() => setCopied(null), 1600);
		} catch {
			setCopied(null);
		}
	};

	return (
		<div>
			<div className="overflow-hidden rounded-2xl border border-black/10 bg-white text-[#1f1f24] shadow-[0_30px_80px_-40px_rgba(17,17,19,0.35)] dark:border-white/10 dark:bg-[#0b0b0e] dark:text-[#e8e6df] dark:shadow-2xl">
				<div
					role="tablist"
					aria-label="Integration"
					className="flex gap-1 overflow-x-auto p-2 [scrollbar-width:none]"
				>
					{SECTIONS.map((s, i) => (
						<Tab
							key={s.label}
							active={i === sectionIdx}
							onClick={() => {
								setSectionIdx(i);
								setVariantIdx(0);
								setSnippetIdx(0);
							}}
						>
							{s.label}
						</Tab>
					))}
				</div>

				<div className="mx-2 mb-2 overflow-hidden rounded-xl border border-black/[0.08] bg-[#fafaf9] dark:border-white/[0.08] dark:bg-[#111114]">
					<div
						role="tablist"
						aria-label={`${section.label} options`}
						className="flex gap-0.5 overflow-x-auto border-b border-black/[0.08] p-1.5 [scrollbar-width:none] dark:border-white/[0.08]"
					>
						{section.variants.map((v, i) => (
							<Tab
								key={v.label}
								size="sm"
								active={v === variant}
								onClick={() => {
									setVariantIdx(i);
									setSnippetIdx(0);
								}}
							>
								{v.label}
							</Tab>
						))}
					</div>

					<div>
						<div className="flex min-h-11 items-center gap-3 px-3 pt-2 font-mono text-[11px] text-black/45 dark:text-white/45">
							<span className="shrink-0 pl-2">
								{fileName(variant, snippet)}
							</span>
							{snippet.endpoint && (
								<span className="truncate rounded-md border border-black/10 bg-white px-2 py-0.5 text-black/65 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
									{snippet.endpoint}
								</span>
							)}
							<div className="ml-auto flex shrink-0 items-center gap-1">
								{variant.snippets.length > 1 && (
									<div
										role="tablist"
										aria-label="Variant"
										className="flex gap-0.5 overflow-x-auto font-sans [scrollbar-width:none]"
									>
										{variant.snippets.map((sn, i) => (
											<Tab
												key={sn.label}
												size="xs"
												active={sn === snippet}
												onClick={() => setSnippetIdx(i)}
											>
												{sn.label}
											</Tab>
										))}
									</div>
								)}
								<button
									type="button"
									onClick={() => void copy("code")}
									aria-label="Copy code"
									className="ml-1 rounded-md border border-black/10 bg-white/80 p-1.5 text-black/50 transition-colors hover:text-black dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:text-white"
								>
									{copied === "code" ? (
										<Check className="size-3.5" />
									) : (
										<Copy className="size-3.5" />
									)}
								</button>
							</div>
						</div>
						<pre className="h-[300px] overflow-auto px-5 pb-5 pt-2 font-mono text-[13px] leading-6">
							<code className="grid grid-cols-[auto_1fr] gap-x-5">
								{lines.map((line, i) => (
									<Fragment key={i}>
										<span className="select-none text-right text-black/25 dark:text-white/25">
											{i + 1}
										</span>
										<span className="whitespace-pre">
											{tokens?.[i]
												? tokens[i].map((t, j) => (
														<span key={j} style={tokenStyle(t)}>
															{t.content}
														</span>
													))
												: line}
											{line === "" ? " " : null}
										</span>
									</Fragment>
								))}
							</code>
						</pre>
					</div>

					<div className="flex items-center justify-between gap-4 border-t border-black/[0.08] px-4 py-3 text-sm dark:border-white/[0.08]">
						<button
							type="button"
							onClick={() => void copy("agent")}
							className="inline-flex items-center gap-2 font-medium text-black/70 transition-colors hover:text-black dark:text-white/70 dark:hover:text-white"
						>
							{copied === "agent" ? (
								<Check className="size-4" />
							) : (
								<Sparkles className="size-4" />
							)}
							{copied === "agent" ? "Prompt copied" : "Copy for agent"}
						</button>
						<a
							href={variant.docs}
							target={docsExternal ? "_blank" : undefined}
							rel={docsExternal ? "noopener noreferrer" : undefined}
							className="inline-flex items-center gap-1 text-black/50 transition-colors hover:text-black dark:text-white/50 dark:hover:text-white"
						>
							{docsExternal ? "Read docs" : "Read guide"}
							<ArrowUpRight className="size-4" />
						</a>
					</div>
				</div>
			</div>

			<div
				role="radiogroup"
				aria-label="Model"
				className={cn(
					"mt-4 flex flex-wrap items-center gap-1.5 transition-opacity",
					!(snippet.usesModel ?? variant.usesModel) &&
						"pointer-events-none opacity-40",
				)}
			>
				{MODELS.map((m) => (
					<button
						key={m.id}
						type="button"
						role="radio"
						aria-checked={m.id === model}
						title={m.id}
						onClick={() => setModel(m.id)}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
							m.id === model
								? "border-foreground/40 bg-card text-foreground"
								: "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground",
						)}
					>
						<ProviderLogo
							provider={m.logo}
							className="h-3.5 w-auto max-w-[18px] object-contain"
						/>
						{m.label}
					</button>
				))}
				<a
					href="/models"
					className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
				>
					All models
					<ArrowUpRight className="size-3.5" />
				</a>
			</div>
		</div>
	);
}
