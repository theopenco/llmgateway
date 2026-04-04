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
	const apiUrl = "https://api.llmgateway.io";
	return {
		hosted: true,
		apiUrl,
		apiBackendUrl: process.env.API_BACKEND_URL ?? apiUrl,
		uiUrl: "https://llmgateway.io",
		playgroundUrl: "https://chat.llmgateway.io",
		docsUrl: "https://docs.llmgateway.io",
		githubUrl: "https://github.com/theopenco/llmgateway",
		discordUrl: "https://llmgateway.io/discord",
		twitterUrl: "https://x.com/llmgateway",
		posthogKey: process.env.POSTHOG_KEY,
		posthogHost: process.env.POSTHOG_HOST,
		stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
	};
}
