export const loungeConnectorIds = [
	"posthog",
	"slack",
	"notion",
	"gmail",
	"google-drive",
	"figma",
	"linear",
	"sentry",
	"github",
	"stripe",
	"shopify",
] as const;

export type LoungeConnectorId = (typeof loungeConnectorIds)[number];

export const loungeConnectors: Record<
	LoungeConnectorId,
	{ name: string; description: string }
> = {
	posthog: {
		name: "PostHog",
		description: "Explore analytics, experiments, and feature flags.",
	},
	slack: {
		name: "Slack",
		description: "Find conversations and work with your team.",
	},
	notion: {
		name: "Notion",
		description: "Search pages and work with your knowledge base.",
	},
	gmail: { name: "Gmail", description: "Search and read your email." },
	"google-drive": {
		name: "Google Drive",
		description: "Find files and read documents.",
	},
	figma: {
		name: "Figma",
		description: "Bring designs and component context into your chat.",
	},
	linear: {
		name: "Linear",
		description: "Find issues and manage project work.",
	},
	sentry: {
		name: "Sentry",
		description: "Investigate errors and performance issues.",
	},
	github: {
		name: "GitHub",
		description: "Explore repositories, issues, and pull requests.",
	},
	stripe: {
		name: "Stripe",
		description: "Work with payments and business data.",
	},
	shopify: {
		name: "Shopify",
		description: "Explore your store’s products and orders.",
	},
};
