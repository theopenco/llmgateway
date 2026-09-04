"use client";

import {
	ArrowUpRight,
	BarChart3,
	User,
	Bot,
	Check,
	Copy,
	Image,
	MessageSquare,
	Server,
	Sparkles,
	Terminal,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useState, useCallback } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";

interface Tool {
	name: string;
	description: string;
	icon: typeof MessageSquare;
	parameters: string[];
	example: string;
}

const tools: Tool[] = [
	{
		name: "get-account",
		description:
			"See your connected account, project, access scope, and API key spending limits. Owners and admins can also check the credit balance.",
		icon: User,
		parameters: [],
		example: `{}`,
	},
	{
		name: "get-usage",
		description:
			"Track requests, tokens, costs, trends, and your most-used provider, model, and coding app. Defaults to the last 30 UTC dates.",
		icon: BarChart3,
		parameters: ["from", "to", "granularity"],
		example: `{ "granularity": "day" }`,
	},
	{
		name: "get-usage-breakdown",
		description:
			"Rank providers, models, coding apps, or API keys by requests, cost, or tokens. Page through the results to explore further.",
		icon: BarChart3,
		parameters: ["group_by", "sort_by", "from", "to", "limit", "offset"],
		example: `{
  "group_by": "app",
  "sort_by": "cost",
  "limit": 10
}`,
	},
	{
		name: "chat",
		description:
			"Send messages to a model from the live catalog. Use list-models to choose a model and inspect its pricing.",
		icon: MessageSquare,
		parameters: ["model", "messages", "temperature", "max_tokens"],
		example: `{
  "model": "MODEL_ID",
  "messages": [{ "role": "user", "content": "Hello!" }]
}`,
	},
	{
		name: "generate-image",
		description:
			"Generate images from text prompts using AI image models like Qwen Image. Returns images directly in the response.",
		icon: Image,
		parameters: ["prompt", "model", "size", "n"],
		example: `{
  "prompt": "A serene mountain landscape at sunset",
  "model": "qwen-image-plus",
  "size": "1024x1024"
}`,
	},
	{
		name: "generate-nano-banana",
		description:
			"Generate images with Gemini 3 Pro Image Preview. Returns inline image data. Set UPLOAD_DIR on the server to also save images to disk.",
		icon: Sparkles,
		parameters: ["prompt", "filename", "aspect_ratio"],
		example: `{
  "prompt": "A pixel-art cat sitting on a rainbow",
  "filename": "hero-image.png",
  "aspect_ratio": "16:9"
}`,
	},
	{
		name: "list-models",
		description:
			"Discover available models with their capabilities, pricing, and provider information.",
		icon: Server,
		parameters: [
			"family",
			"limit",
			"include_deactivated",
			"exclude_deprecated",
		],
		example: `{
    "limit": 10
}`,
	},
	{
		name: "list-image-models",
		description:
			"Get a list of all available image generation models with pricing and usage examples.",
		icon: Sparkles,
		parameters: [],
		example: `{}`,
	},
];

const configExamples = {
	claudeCodeCli: `claude mcp add --transport http --scope user llmgateway https://api.llmgateway.io/mcp \\
  --header "Authorization: Bearer YOUR_API_KEY"`,
	claudeCode: `{
  "mcpServers": {
    "llmgateway": {
      "url": "https://api.llmgateway.io/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`,
	codexCli: `codex mcp add llmgateway --url https://api.llmgateway.io/mcp \\
  --bearer-token-env-var LLM_GATEWAY_API_KEY`,
	codex: `[mcp_servers.llmgateway]
url = "https://api.llmgateway.io/mcp"
bearer_token_env_var = "LLM_GATEWAY_API_KEY"`,
	cursor: `{
  "mcpServers": {
    "llmgateway": {
      "url": "https://api.llmgateway.io/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`,
	curl: `curl -X POST https://api.llmgateway.io/mcp \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get-usage",
      "arguments": {}
    }
  }'`,
};

// Plain markdown content for AI agents
const aiAgentMarkdown = `# LLM Gateway MCP Server

## Endpoint
\`https://api.llmgateway.io/mcp\`

## Authentication
- Header: \`Authorization: Bearer YOUR_API_KEY\`
- Or: \`x-api-key: YOUR_API_KEY\`

## Protocol
- JSON-RPC 2.0
- MCP Version: 2024-11-05
- Transport: HTTP Streamable

## Usage Scope
Owners/admins see the connected project's usage. Developers see only their own keys in that project, including inactive-key history. A project key never grants access to another project or organization. Use get-account to inspect the scope. Analytics tools are read-only and do not generate billable model requests.

## Available Tools

### get-account
No parameters. Returns the connected user, organization, project, role, usage scope, API key usage/limits, and the organization credit balance (null for developers). No credentials are returned. Credit balance is not a DevPass plan allowance.

### get-usage
Returns request/token totals, errors, cache hits, inference cost, credits/BYOK cost split, storage cost, trends, and most-used provider/model/app by request count.
- from / to: optional inclusive UTC dates (YYYY-MM-DD); defaults to the last 30 dates, maximum 366 days
- granularity: day (default) or hour (maximum 31 days)
- Monetary fields end in Usd. Usage costs are not invoice totals; BYOK costs are billed by the provider.
- Results use hourly aggregates and can lag recent requests. Only buckets with activity appear in the series.
- Empty periods return zero totals and null rankings. Check updatedAt and appUsageCoverage before drawing conclusions.

### get-usage-breakdown
- group_by (required): provider, model, app, or api_key
- sort_by: requests (default), cost, or tokens
- from / to: same inclusive UTC date range as get-usage
- limit: 1-100 (default 10); offset: 0-10000 (default 0)
Returns rows with counts, tokens, costs, pagination.hasMore and coverage. App IDs come from request source attribution; unknown means no source was recorded. Historical per-key app data may be incomplete. No scope IDs are accepted as parameters.

### chat
Send messages to any LLM model.

**Parameters:**
- \`model\` (string, required): Model ID from list-models
- \`messages\` (array, required): Array of {role, content} objects
- \`temperature\` (number, optional): 0-2
- \`max_tokens\` (number, optional): Maximum tokens

**Example:**
\`\`\`json
{
  "name": "chat",
  "arguments": {
    "model": "MODEL_ID",
    "messages": [{"role": "user", "content": "Hello"}]
  }
}
\`\`\`

### generate-image
Generate images from text prompts.

**Parameters:**
- \`prompt\` (string, required): Image description
- \`model\` (string, optional): Default "qwen-image-plus"
- \`size\` (string, optional): Default "1024x1024"
- \`n\` (number, optional): 1-4 images, default 1

**Example:**
\`\`\`json
{
  "name": "generate-image",
  "arguments": {
    "prompt": "A sunset over mountains",
    "model": "qwen-image-max"
  }
}
\`\`\`

### generate-nano-banana
Generate images with Gemini 3 Pro Image Preview ("Nano Banana"). Returns inline image data. Images are only saved to disk when the server has UPLOAD_DIR configured.

**Parameters:**
- \`prompt\` (string, required): Image description
- \`filename\` (string, optional): Filename (no path separators). Default: nano-banana-{timestamp}.png
- \`aspect_ratio\` (string, optional): "1:1", "16:9", "4:3", or "5:4"

**Example:**
\`\`\`json
{
  "name": "generate-nano-banana",
  "arguments": {
    "prompt": "A pixel-art cat on a rainbow",
    "aspect_ratio": "16:9"
  }
}
\`\`\`

### list-models
List available LLM models.

**Parameters:**
- \`family\` (string, optional): Filter by model family
- \`limit\` (number, optional): Max results, default 20
- \`include_deactivated\` (boolean, optional): Include inactive models
- \`exclude_deprecated\` (boolean, optional): Exclude deprecated models

### list-image-models
List available image generation models. No parameters required.

## Catalog
See the live models and providers at https://llmgateway.io/models and https://llmgateway.io/providers.

## MCP Configuration

### Claude Code
\`\`\`bash
claude mcp add --transport http --scope user llmgateway https://api.llmgateway.io/mcp \\
  --header "Authorization: Bearer YOUR_API_KEY"
\`\`\`

### Codex
\`\`\`bash
codex mcp add llmgateway --url https://api.llmgateway.io/mcp \\
  --bearer-token-env-var LLM_GATEWAY_API_KEY
\`\`\`

### Cursor (~/.cursor/mcp.json)
\`\`\`json
{
  "mcpServers": {
    "llmgateway": {
      "url": "https://api.llmgateway.io/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
\`\`\`

## JSON-RPC Methods
- \`initialize\`: Handshake
- \`tools/list\`: List available tools
- \`tools/call\`: Execute a tool
- \`ping\`: Health check

## Links
- Documentation: https://docs.llmgateway.io/developers/mcp
- Models: https://llmgateway.io/models
- Dashboard: https://llmgateway.io/dashboard
- API Keys: https://llmgateway.io/dashboard/keys`;

export function McpContent() {
	const [copiedConfig, setCopiedConfig] = useState<string | null>(null);

	const copyToClipboard = useCallback((text: string, key: string) => {
		void navigator.clipboard.writeText(text);
		setCopiedConfig(key);
		setTimeout(() => setCopiedConfig(null), 2000);
	}, []);

	return (
		<Tabs defaultValue="humans" className="w-full">
			<div className="flex justify-center mb-8">
				<TabsList className="grid w-full max-w-md grid-cols-2">
					<TabsTrigger value="humans" className="gap-2">
						<Zap className="h-4 w-4" />
						For Humans
					</TabsTrigger>
					<TabsTrigger value="agents" className="gap-2">
						<Bot className="h-4 w-4" />
						For AI Agents
					</TabsTrigger>
				</TabsList>
			</div>

			<TabsContent value="humans" className="space-y-16">
				{/* Hero Features */}
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
					{[
						{
							icon: Server,
							title: "Model Access",
							description: "Discover and use models from the live catalog",
						},
						{
							icon: Image,
							title: "Image Generation",
							description: "Generate images directly from your AI assistant",
						},
						{
							icon: BarChart3,
							title: "Usage & Costs",
							description: "Explore spending, trends, and your most-used apps",
						},
						{
							icon: Terminal,
							title: "Easy Setup",
							description: "Works with Claude Code, Cursor, and any MCP client",
						},
					].map((feature) => (
						<Card
							key={feature.title}
							className="p-6 bg-gradient-to-br from-background to-muted/30 border-0 shadow-lg"
						>
							<feature.icon className="h-8 w-8 text-primary mb-3" />
							<h3 className="font-semibold mb-1">{feature.title}</h3>
							<p className="text-sm text-muted-foreground">
								{feature.description}
							</p>
						</Card>
					))}
				</div>

				{/* Available Tools */}
				<div>
					<h2 className="text-2xl font-bold text-center mb-8">
						Available Tools
					</h2>
					<div className="grid gap-6 sm:grid-cols-2 max-w-4xl mx-auto">
						{tools.map((tool) => (
							<Card
								key={tool.name}
								className="group relative overflow-hidden border-0 bg-gradient-to-br from-background to-muted/30 shadow-xl hover:shadow-2xl transition-all duration-500"
							>
								<div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
								<div className="relative p-6 space-y-4">
									<div className="flex items-center gap-3">
										<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg">
											<tool.icon className="h-6 w-6 text-primary-foreground" />
										</div>
										<div>
											<h3 className="text-lg font-bold font-mono">
												{tool.name}
											</h3>
											<div className="flex gap-1 flex-wrap mt-1">
												{tool.parameters.length === 0 ? (
													<Badge variant="outline" className="text-xs">
														No params
													</Badge>
												) : (
													<>
														{tool.parameters.slice(0, 3).map((param) => (
															<Badge
																key={param}
																variant="secondary"
																className="text-xs"
															>
																{param}
															</Badge>
														))}
													</>
												)}
												{tool.parameters.length > 3 && (
													<Badge variant="secondary" className="text-xs">
														+{tool.parameters.length - 3}
													</Badge>
												)}
											</div>
										</div>
									</div>
									<p className="text-sm text-muted-foreground">
										{tool.description}
									</p>
									<div className="relative">
										<pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto">
											<code>{tool.example}</code>
										</pre>
									</div>
								</div>
								<div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-primary/50 to-transparent transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left" />
							</Card>
						))}
					</div>
				</div>

				<div className="max-w-3xl mx-auto space-y-4 text-center">
					<h2 className="text-2xl font-bold">Ask about your usage</h2>
					<p className="text-muted-foreground">
						“What did I spend this month?” “Which model do I use most?” “Which
						coding app costs the most?”
					</p>
					<p className="text-sm text-muted-foreground">
						Owners and admins see the connected project. Developers see their
						own keys in that project. Analytics calls are read-only and have no
						model charges. Hourly statistics may lag recent requests; results
						flag incomplete app history.
					</p>
				</div>

				{/* Quick Start */}
				<div>
					<h2 className="text-2xl font-bold text-center mb-8">Quick Start</h2>
					<div className="max-w-3xl mx-auto space-y-6">
						{/* Claude Code */}
						<Card className="p-6 border-0 shadow-xl bg-gradient-to-br from-background to-muted/30">
							<div className="flex items-center justify-between mb-4">
								<div className="flex items-center gap-2">
									<Terminal className="h-5 w-5 text-primary" />
									<span className="font-semibold">Claude Code</span>
								</div>
								<Button
									variant="ghost"
									size="sm"
									onClick={() =>
										copyToClipboard(configExamples.claudeCodeCli, "claude-cli")
									}
								>
									{copiedConfig === "claude-cli" ? (
										<Check className="h-4 w-4" />
									) : (
										<Copy className="h-4 w-4" />
									)}
								</Button>
							</div>
							<pre className="bg-muted/50 rounded-lg p-4 text-sm overflow-x-auto">
								<code>{configExamples.claudeCodeCli}</code>
							</pre>
							<p className="text-sm text-muted-foreground mt-3">
								Run this command in your terminal to add the MCP server
								globally.
							</p>
							<details className="mt-4">
								<summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
									Alternative: Manual JSON configuration
								</summary>
								<div className="mt-3">
									<div className="flex items-center justify-between mb-2">
										<span className="text-xs text-muted-foreground">
											Add to{" "}
											<code className="bg-muted px-1 rounded">
												~/.claude.json
											</code>
										</span>
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												copyToClipboard(configExamples.claudeCode, "claude")
											}
										>
											{copiedConfig === "claude" ? (
												<Check className="h-3 w-3" />
											) : (
												<Copy className="h-3 w-3" />
											)}
										</Button>
									</div>
									<pre className="bg-muted/50 rounded-lg p-4 text-sm overflow-x-auto">
										<code>{configExamples.claudeCode}</code>
									</pre>
								</div>
							</details>
						</Card>

						{/* Codex */}
						<Card className="p-6 border-0 shadow-xl bg-gradient-to-br from-background to-muted/30">
							<div className="flex items-center justify-between mb-4">
								<div className="flex items-center gap-2">
									<Terminal className="h-5 w-5 text-primary" />
									<span className="font-semibold">Codex</span>
								</div>
								<Button
									variant="ghost"
									size="sm"
									onClick={() =>
										copyToClipboard(configExamples.codexCli, "codex-cli")
									}
								>
									{copiedConfig === "codex-cli" ? (
										<Check className="h-4 w-4" />
									) : (
										<Copy className="h-4 w-4" />
									)}
								</Button>
							</div>
							<pre className="bg-muted/50 rounded-lg p-4 text-sm overflow-x-auto">
								<code>{configExamples.codexCli}</code>
							</pre>
							<p className="text-sm text-muted-foreground mt-3">
								Set{" "}
								<code className="bg-muted px-1 rounded">
									LLM_GATEWAY_API_KEY
								</code>{" "}
								env var first, then run this command.
							</p>
							<details className="mt-4">
								<summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
									Alternative: Manual TOML configuration
								</summary>
								<div className="mt-3">
									<div className="flex items-center justify-between mb-2">
										<span className="text-xs text-muted-foreground">
											Add to{" "}
											<code className="bg-muted px-1 rounded">
												~/.codex/config.toml
											</code>
										</span>
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												copyToClipboard(configExamples.codex, "codex")
											}
										>
											{copiedConfig === "codex" ? (
												<Check className="h-3 w-3" />
											) : (
												<Copy className="h-3 w-3" />
											)}
										</Button>
									</div>
									<pre className="bg-muted/50 rounded-lg p-4 text-sm overflow-x-auto">
										<code>{configExamples.codex}</code>
									</pre>
								</div>
							</details>
						</Card>

						{/* Cursor */}
						<Card className="p-6 border-0 shadow-xl bg-gradient-to-br from-background to-muted/30">
							<div className="flex items-center justify-between mb-4">
								<div className="flex items-center gap-2">
									<Terminal className="h-5 w-5 text-primary" />
									<span className="font-semibold">Cursor</span>
								</div>
								<Button
									variant="ghost"
									size="sm"
									onClick={() =>
										copyToClipboard(configExamples.cursor, "cursor")
									}
								>
									{copiedConfig === "cursor" ? (
										<Check className="h-4 w-4" />
									) : (
										<Copy className="h-4 w-4" />
									)}
								</Button>
							</div>
							<pre className="bg-muted/50 rounded-lg p-4 text-sm overflow-x-auto">
								<code>{configExamples.cursor}</code>
							</pre>
							<p className="text-sm text-muted-foreground mt-3">
								Add to{" "}
								<code className="bg-muted px-1 rounded">
									~/.cursor/mcp.json
								</code>
							</p>
						</Card>

						{/* Direct API Call */}
						<Card className="p-6 border-0 shadow-xl bg-gradient-to-br from-background to-muted/30">
							<div className="flex items-center justify-between mb-4">
								<div className="flex items-center gap-2">
									<Terminal className="h-5 w-5 text-primary" />
									<span className="font-semibold">Direct API Call</span>
								</div>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => copyToClipboard(configExamples.curl, "curl")}
								>
									{copiedConfig === "curl" ? (
										<Check className="h-4 w-4" />
									) : (
										<Copy className="h-4 w-4" />
									)}
								</Button>
							</div>
							<pre className="bg-muted/50 rounded-lg p-4 text-sm overflow-x-auto">
								<code>{configExamples.curl}</code>
							</pre>
						</Card>
					</div>
				</div>

				{/* CTA */}
				<div className="text-center space-y-6">
					<h2 className="text-2xl font-bold">Ready to get started?</h2>
					<p className="text-muted-foreground max-w-lg mx-auto">
						Get your API key and start using LLM Gateway with your favorite AI
						assistant.
					</p>
					<div className="flex gap-4 justify-center flex-wrap">
						<Button asChild size="lg">
							<Link href="/dashboard/keys">
								Get API Key
								<ArrowUpRight className="ml-2 h-4 w-4" />
							</Link>
						</Button>
						<Button asChild variant="outline" size="lg">
							<Link href="https://docs.llmgateway.io/developers/mcp">
								Read Documentation
								<ArrowUpRight className="ml-2 h-4 w-4" />
							</Link>
						</Button>
					</div>
				</div>
			</TabsContent>

			<TabsContent value="agents" className="space-y-8">
				<Card className="p-6 border-0 shadow-xl bg-gradient-to-br from-background to-muted/30">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<Bot className="h-5 w-5 text-primary" />
							<span className="font-semibold">
								MCP Server Reference (Plain Markdown)
							</span>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => copyToClipboard(aiAgentMarkdown, "markdown")}
						>
							{copiedConfig === "markdown" ? (
								<>
									<Check className="h-4 w-4 mr-2" />
									Copied
								</>
							) : (
								<>
									<Copy className="h-4 w-4 mr-2" />
									Copy All
								</>
							)}
						</Button>
					</div>
					<div className="bg-muted/50 rounded-lg p-6 font-mono text-sm whitespace-pre-wrap overflow-x-auto max-h-[70vh] overflow-y-auto">
						{aiAgentMarkdown}
					</div>
				</Card>

				<p className="text-center text-muted-foreground text-sm">
					This plain markdown format is optimized for AI agents and LLMs to
					parse and understand.
				</p>
			</TabsContent>
		</Tabs>
	);
}
