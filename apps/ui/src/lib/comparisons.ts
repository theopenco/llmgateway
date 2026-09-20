/**
 * Single source of truth for the /compare hub. Each entry mirrors the
 * positioning already published on its own /compare/[slug] page, so the hub and
 * the detail pages never drift apart. Keep competitor claims conservative and
 * verifiable — evaluators land here mid-comparison and will check them.
 */

export type ComparisonCategory =
	"AI gateways & routers" | "Cloud model platforms" | "Coding assistants";

export interface Comparison {
	slug: string;
	/** Competitor name as they brand themselves. */
	competitor: string;
	category: ComparisonCategory;
	/** What the competitor is, in their own terms. Never a strawman. */
	positioning: string;
	/** What the competitor ships under an open-source licence, if anything. */
	openSource: string;
	/** Whether the competitor's stack can run on your own infrastructure. */
	selfHostable: string;
	/** The single dimension that actually separates the two products. */
	keyDifference: string;
	/** Honest "pick them instead" guidance. */
	betterForThem: string;
	/** Matching guide under /migration, when one exists. */
	migrationSlug?: string;
}

export const comparisons: Comparison[] = [
	{
		slug: "open-router",
		competitor: "OpenRouter",
		category: "AI gateways & routers",
		positioning:
			"A hosted marketplace that puts 400+ models behind one OpenAI-compatible endpoint, with its own credit system on top. Stripe announced its acquisition of OpenRouter in August 2026.",
		openSource: "No",
		selfHostable: "No",
		keyDifference:
			"LLM Gateway is open source, independent, and self-hostable, so the routing layer can run inside your own infrastructure instead of only as someone else's service.",
		betterForThem:
			"You want the widest possible catalogue of niche and community models and have no interest in running any infrastructure yourself.",
		migrationSlug: "openrouter",
	},
	{
		slug: "portkey",
		competitor: "Portkey",
		category: "AI gateways & routers",
		positioning:
			"An AI gateway paired with a broader LLMOps suite covering prompt management, evaluations, and observability. Acquired by Palo Alto Networks in May 2026 and now sold as the Prisma AIRS AI Gateway.",
		openSource: "Gateway + platform (MIT)",
		selfHostable: "Most components",
		keyDifference:
			"The entire LLM Gateway platform ships under AGPLv3, where Portkey's gateway is open source but the surrounding platform is a proprietary hosted product.",
		betterForThem:
			"You want prompt management and evaluation tooling bundled with the gateway, and you are happy on a hosted platform.",
		migrationSlug: "portkey",
	},
	{
		slug: "litellm",
		competitor: "LiteLLM",
		category: "AI gateways & routers",
		positioning:
			"A widely used open-source Python proxy and SDK that normalises calls across providers, run, patched, and operated by you.",
		openSource: "Yes (MIT)",
		selfHostable: "Yes",
		keyDifference:
			"LLM Gateway is a managed, production-ready service — dashboard, analytics, worker, and gateway in one deploy — rather than a proxy you host, monitor, and upgrade yourself.",
		betterForThem:
			"You already run Python infrastructure, want library-level control, and would rather own the operational burden than pay a platform fee.",
		migrationSlug: "litellm",
	},
	{
		slug: "vercel-ai-gateway",
		competitor: "Vercel AI Gateway",
		category: "AI gateways & routers",
		positioning:
			"A managed routing service built around the Vercel AI SDK, with zero token markup, BYOK on the paid tier, and metered add-ons for reporting, allowlists, and zero data retention.",
		openSource: "No",
		selfHostable: "No",
		keyDifference:
			"LLM Gateway is open source and self-hostable with zero token markup, and it is not tied to a Vercel team account or one SDK.",
		betterForThem:
			"Your team already lives on Vercel and you want routing that is one configuration line away inside the AI SDK.",
		migrationSlug: "vercel-ai-gateway",
	},
	{
		slug: "aws-bedrock",
		competitor: "AWS Bedrock",
		category: "Cloud model platforms",
		positioning:
			"Amazon's managed service for the models AWS hosts, billed and governed through your existing AWS account.",
		openSource: "No",
		selfHostable: "No",
		keyDifference:
			"LLM Gateway reaches every major lab and cloud — Bedrock included — behind one API, so a model AWS does not host is still one string change away.",
		betterForThem:
			"Everything must stay inside AWS billing and IAM, and the models you need are all available in Bedrock.",
	},
	{
		slug: "azure-ai-foundry",
		competitor: "Microsoft Foundry",
		category: "Cloud model platforms",
		positioning:
			"Microsoft's managed platform for the models Azure hosts (renamed from Azure AI Foundry in late 2025), reached after you create resources, deployments, and quota.",
		openSource: "No",
		selfHostable: "No",
		keyDifference:
			"LLM Gateway needs no per-model provisioning: one key reaches every provider, and Azure can stay in the mix as one of them.",
		betterForThem:
			"Azure is your mandated cloud and the provisioning workflow is already part of how your team ships.",
	},
	{
		slug: "github-copilot",
		competitor: "GitHub Copilot",
		category: "Coding assistants",
		positioning:
			"GitHub's coding assistant, which since June 2026 bills chat and agent usage through usage-based AI Credits; Business and Enterprise enable paid additional usage by default and only an admin disabling that policy or a budget with hard stop on caps it, while individual plans stop until the user sets a budget.",
		openSource: "No",
		selfHostable: "No",
		keyDifference:
			"LLM Gateway charges zero token markup and enforces hard budget caps at organization, project, and key scope.",
		betterForThem:
			"You want a single vendor for editor, repository, and assistant, and one per-seat bill matters more than per-project and per-key cost attribution.",
		migrationSlug: "github-copilot",
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
