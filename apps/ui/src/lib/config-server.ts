export interface AppConfig {
	hosted: boolean;
	appUrl: string;
	apiUrl: string;
	apiBackendUrl: string;
	gatewayUrl: string;
	githubUrl: string;
	discordUrl: string;
	twitterUrl: string;
	docsUrl: string;
	playgroundUrl: string;
	adminUrl: string;
	posthogKey?: string;
	posthogHost?: string;
	crispId?: string;
	githubAuth: boolean;
	googleAuth: boolean;
}

export function getConfig(): AppConfig {
	const apiUrl = process.env.API_URL || "http://localhost:4002";
	return {
		hosted: process.env.HOSTED === "true",
		appUrl: process.env.APP_URL || "http://localhost:3002",
		apiUrl,
		apiBackendUrl: process.env.API_BACKEND_URL || apiUrl,
		gatewayUrl: process.env.GATEWAY_URL || "http://localhost:4001",
		githubUrl:
			process.env.GITHUB_URL || "https://github.com/theopenco/llmgateway",
		discordUrl: process.env.DISCORD_URL || "https://discord.gg/gcqcZeYWEz",
		twitterUrl: process.env.TWITTER_URL || "https://x.com/llmgateway",
		docsUrl: process.env.DOCS_URL || "http://localhost:3005",
		playgroundUrl: process.env.PLAYGROUND_URL || "http://localhost:3003",
		adminUrl: process.env.ADMIN_URL || "http://localhost:3006",
		posthogKey: process.env.POSTHOG_KEY,
		posthogHost: process.env.POSTHOG_HOST,
		crispId: process.env.CRISP_ID,
		githubAuth: !!process.env.GITHUB_CLIENT_ID,
		googleAuth: !!process.env.GOOGLE_CLIENT_ID,
	};
}
