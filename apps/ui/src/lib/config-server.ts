export interface AppConfig {
	hosted: boolean;
	apiUrl: string;
	apiBackendUrl: string;
	githubUrl: string;
	discordUrl: string;
	twitterUrl: string;
	docsUrl: string;
	playgroundUrl: string;
	posthogKey?: string;
	posthogHost?: string;
	crispId?: string;
}

export function getConfig(): AppConfig {
	const apiUrl = process.env.API_URL || "http://localhost:4002";
	return {
		hosted: process.env.HOSTED === "true",
		apiUrl,
		apiBackendUrl: process.env.API_BACKEND_URL || apiUrl,
		githubUrl:
			process.env.GITHUB_URL || "https://github.com/theopenco/llmgateway",
		discordUrl: process.env.DISCORD_URL || "https://discord.gg/gcqcZeYWEz",
		twitterUrl: process.env.TWITTER_URL || "https://x.com/llmgateway",
		docsUrl: process.env.DOCS_URL || "http://localhost:3005",
		playgroundUrl: process.env.PLAYGROUND_URL || "http://localhost:3003",
		posthogKey: process.env.POSTHOG_KEY,
		posthogHost: process.env.POSTHOG_HOST,
		crispId: process.env.CRISP_ID,
	};
}
