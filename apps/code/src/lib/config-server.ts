export interface AppConfig {
	hosted: boolean;
	apiUrl: string;
	apiBackendUrl: string;
	uiUrl: string;
	playgroundUrl: string;
	docsUrl: string;
	githubUrl: string;
	discordUrl: string;
	twitterUrl: string;
	posthogKey?: string;
	posthogHost?: string;
	stripePublishableKey?: string;
}

export function getConfig(): AppConfig {
	const apiUrl = process.env.API_URL ?? "http://localhost:4002";
	return {
		hosted: process.env.HOSTED === "true",
		apiUrl,
		apiBackendUrl: process.env.API_BACKEND_URL ?? apiUrl,
		uiUrl: process.env.UI_URL ?? "http://localhost:3002",
		playgroundUrl: process.env.PLAYGROUND_URL ?? "http://localhost:3003",
		docsUrl: process.env.DOCS_URL ?? "http://localhost:3005",
		githubUrl:
			process.env.GITHUB_URL ?? "https://github.com/theopenco/llmgateway",
		discordUrl: process.env.DISCORD_URL ?? "https://discord.gg/gcqcZeYWEz",
		twitterUrl: process.env.TWITTER_URL ?? "https://x.com/llmgateway",
		posthogKey: process.env.POSTHOG_KEY,
		posthogHost: process.env.POSTHOG_HOST,
		stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
	};
}
