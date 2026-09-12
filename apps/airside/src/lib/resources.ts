import type { Metadata } from "next";

export const RESOURCE_PAGES = [
	{
		href: "/guides/list-your-llm-api",
		title: "How to list your LLM API",
		description:
			"Prepare your provider domain, model IDs, capabilities and prices for an Airside listing on LLM Gateway.",
	},
	{
		href: "/guides/llm-inference-pricing",
		title: "LLM inference pricing for providers",
		description:
			"Understand token prices, cached input, per-request charges and the difference between traffic estimates and settlement.",
	},
	{
		href: "/tools/token-cost-calculator",
		title: "LLM token cost calculator",
		description:
			"Estimate request and monthly token costs using your own input, output and cached-input rates. Free, with no sign-in.",
	},
	{
		href: "/tools/rate-limit-calculator",
		title: "API rate limit calculator",
		description:
			"Convert request limits into daily capacity and estimate concurrency from request duration. Free, with no sign-in.",
	},
] as const;

export function resourceMetadata(path: string): Metadata {
	const page = RESOURCE_PAGES.find((entry) => entry.href === path);
	if (!page) {
		throw new Error(`Unknown resource: ${path}`);
	}
	return {
		title: { absolute: `${page.title} | Airside` },
		description: page.description,
		alternates: { canonical: path },
		openGraph: {
			title: page.title,
			description: page.description,
			url: path,
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: page.title,
			description: page.description,
		},
	};
}
