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
	googleTagId?: string;
	googleAdsSignupConversion?: string;
	googleAdsPurchaseConversion?: string;
	stripePublishableKey?: string;
	githubAuth: boolean;
	googleAuth: boolean;
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
		discordUrl: process.env.DISCORD_URL ?? "https://llmgateway.io/discord",
		twitterUrl: process.env.TWITTER_URL ?? "https://x.com/llmgateway",
		posthogKey: process.env.POSTHOG_KEY,
		posthogHost: process.env.POSTHOG_HOST,
		googleTagId: process.env.GOOGLE_TAG_ID,
		googleAdsSignupConversion: process.env.GOOGLE_ADS_SIGNUP_CONVERSION,
		googleAdsPurchaseConversion: process.env.GOOGLE_ADS_PURCHASE_CONVERSION,
		stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
		githubAuth: !!process.env.GITHUB_CLIENT_ID,
		googleAuth: !!process.env.GOOGLE_CLIENT_ID,
	};
}
