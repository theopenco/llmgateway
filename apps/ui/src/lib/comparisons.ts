export type ComparisonCategory =
	"AI gateways & routers" | "Cloud model platforms" | "Coding assistants";

export interface Comparison {
	sources: { label: string; href: string }[];
	slug: string;
	competitor: string;
	category: ComparisonCategory;
	positioning: string;
	openSource: string;
	selfHostable: string;
	keyDifference: string;
	betterForThem: string;
	migrationSlug?: string;
}

export const comparisons: Comparison[] = [
	{
		slug: "open-router",
		competitor: "OpenRouter",
		category: "AI gateways & routers",
		positioning:
			"A hosted model marketplace with routing, analytics, workspaces and prepaid credits. Standard and Business have different fees and regional controls.",
		openSource: "No",
		selfHostable: "No",
		keyDifference:
			"LLM Gateway offers a self-hostable core and no BYOK platform fee; OpenRouter offers a managed marketplace with plan-dependent BYOK allowances.",
		betterForThem:
			"You want a hosted marketplace, its routing tools and regional controls, with no gateway infrastructure to operate.",
		migrationSlug: "openrouter",
		sources: [
			{ label: "Pricing and plans", href: "https://openrouter.ai/pricing" },
			{
				label: "BYOK fees and policies",
				href: "https://openrouter.ai/docs/guides/overview/auth/byok",
			},
			{ label: "Product announcements", href: "https://openrouter.ai/blog/" },
		],
	},
	{
		slug: "portkey",
		competitor: "Portkey",
		category: "AI gateways & routers",
		positioning:
			"An AI gateway and operations platform with prompt management, tracing, guardrails and MCP governance. Palo Alto Networks acquired Portkey in May 2026.",
		openSource: "Gateway (MIT)",
		selfHostable: "OSS gateway; enterprise private deployments",
		keyDifference:
			"Both can be self-hosted. Compare licensing, deployment scope, prompt operations and log-volume pricing against LLM Gateway's credit or BYOK model.",
		betterForThem:
			"You want prompt operations, semantic caching and agent governance alongside routing, with hosted or enterprise private deployment options.",
		migrationSlug: "portkey",
		sources: [
			{ label: "Hosted pricing", href: "https://portkey.ai/pricing" },
			{
				label: "Open-source gateway",
				href: "https://github.com/Portkey-AI/gateway",
			},
			{
				label: "MCP gateway",
				href: "https://portkey.ai/blog/introducing-the-mcp-gateway/",
			},
			{
				label: "Acquisition announcement",
				href: "https://www.paloaltonetworks.com/company/press/2026/palo-alto-networks-completes-acquisition-of-portkey-to-secure-ai-agents",
			},
		],
	},
	{
		slug: "litellm",
		competitor: "LiteLLM",
		category: "AI gateways & routers",
		positioning:
			"An open-source Python SDK and gateway with an Admin UI, virtual keys, budgets, a playground and observability integrations.",
		openSource: "Core (MIT); commercial Enterprise",
		selfHostable: "Yes",
		keyDifference:
			"LLM Gateway offers managed hosting and prepaid inference; LiteLLM gives you a Python SDK and a gateway you operate with your own providers.",
		betterForThem:
			"Your team wants Python-level extensibility and can operate the gateway, database, monitoring and upgrades.",
		migrationSlug: "litellm",
		sources: [
			{ label: "Pricing and editions", href: "https://www.litellm.ai/pricing" },
			{
				label: "Enterprise controls",
				href: "https://docs.litellm.ai/docs/enterprise",
			},
			{
				label: "Admin UI quickstart",
				href: "https://docs.litellm.ai/docs/proxy/docker_quick_start",
			},
			{
				label: "Model playground",
				href: "https://docs.litellm.ai/docs/proxy/model_compare_ui",
			},
		],
	},
	{
		slug: "vercel-ai-gateway",
		competitor: "Vercel AI Gateway",
		category: "AI gateways & routers",
		positioning:
			"A managed gateway with AI SDK and standard API support, media generation, budgets, zero inference markup and separately metered add-ons.",
		openSource: "AI SDK is open source; gateway is managed",
		selfHostable: "No",
		keyDifference:
			"Both work across application hosts. LLM Gateway adds a self-hostable core; Vercel offers a managed gateway integrated with its developer platform.",
		betterForThem:
			"You want AI SDK integration, managed routing and Vercel observability without operating a gateway.",
		migrationSlug: "vercel-ai-gateway",
		sources: [
			{
				label: "Pricing and add-ons",
				href: "https://vercel.com/docs/ai-gateway/pricing",
			},
			{ label: "API and media support", href: "https://vercel.com/ai-gateway" },
			{
				label: "Budgets",
				href: "https://vercel.com/docs/ai-gateway/observability-and-spend/budgets",
			},
		],
	},
	{
		slug: "aws-bedrock",
		competitor: "AWS Bedrock",
		category: "Cloud model platforms",
		positioning:
			"Amazon's managed model and agent platform, with AWS billing, IAM, OpenAI-compatible APIs on supported models, and regional inference options.",
		openSource: "No",
		selfHostable: "No",
		keyDifference:
			"LLM Gateway routes across independent providers, including supported Bedrock mappings. Bedrock combines inference with AWS-native agents and governance.",
		betterForThem:
			"AWS billing, IAM and private networking are central requirements and its supported models and services cover your workload.",
		sources: [
			{ label: "Pricing", href: "https://aws.amazon.com/bedrock/pricing/" },
			{
				label: "API compatibility",
				href: "https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html",
			},
			{
				label: "Prompt routing",
				href: "https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-routing.html",
			},
			{
				label: "Latest changes",
				href: "https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-ug-doc-history.html",
			},
		],
	},
	{
		slug: "azure-ai-foundry",
		competitor: "Microsoft Foundry",
		category: "Cloud model platforms",
		positioning:
			"Microsoft's model and agent platform, with Azure governance, deployment options and a model router with fallback and preview session affinity.",
		openSource: "No",
		selfHostable: "No",
		keyDifference:
			"LLM Gateway provides a common API across providers. Foundry integrates model deployments, agents and governance with Azure; BYOK still follows Azure quotas.",
		betterForThem:
			"Your team needs Azure identity, networking, managed agent services and integrated governance.",
		sources: [
			{
				label: "Pricing",
				href: "https://azure.microsoft.com/en-us/pricing/details/microsoft-foundry/",
			},
			{
				label: "Model router updates",
				href: "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/whats-new-model-router",
			},
			{
				label: "Model deployment options",
				href: "https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure",
			},
		],
	},
	{
		slug: "github-copilot",
		competitor: "GitHub Copilot",
		category: "Coding assistants",
		positioning:
			"A coding assistant across editors, GitHub, CLI and agents, with included AI credits, cached-token pricing, spend controls and client-dependent BYOK.",
		openSource: "Selected clients and SDKs; hosted service is proprietary",
		selfHostable: "Hosted service: no; local BYOK varies by client",
		keyDifference:
			"Copilot provides the coding experience. LLM Gateway provides model routing and usage controls for compatible tools, including supported Copilot BYOK clients.",
		betterForThem:
			"You value integrated completions, next-edit suggestions, repository context and GitHub workflows.",
		migrationSlug: "github-copilot",
		sources: [
			{
				label: "Plans and allowances",
				href: "https://docs.github.com/en/copilot/get-started/plans",
			},
			{
				label: "Organization billing and budgets",
				href: "https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/billing",
			},
			{
				label: "Individual billing",
				href: "https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing",
			},
			{
				label: "BYOK support",
				href: "https://docs.github.com/en/copilot/concepts/models/bring-your-own-key",
			},
			{
				label: "Caching and usage",
				href: "https://docs.github.com/en/copilot/tutorials/optimize-ai-usage",
			},
		],
	},
];

export const comparisonCategories: ComparisonCategory[] = [
	"AI gateways & routers",
	"Cloud model platforms",
	"Coding assistants",
];

export function comparisonsByCategory(category: ComparisonCategory) {
	return comparisons.filter((comparison) => comparison.category === category);
}
