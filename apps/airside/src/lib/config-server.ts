export interface AppConfig {
	hosted: boolean;
	apiUrl: string;
	apiBackendUrl: string;
	uiUrl: string;
	docsUrl: string;
	githubUrl: string;
	discordUrl: string;
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
		docsUrl: process.env.DOCS_URL ?? "http://localhost:3005",
		githubUrl:
			process.env.GITHUB_URL ?? "https://github.com/theopenco/llmgateway",
		discordUrl: process.env.DISCORD_URL ?? "https://llmgateway.io/discord",
		githubAuth: !!process.env.GITHUB_CLIENT_ID,
		googleAuth: !!process.env.GOOGLE_CLIENT_ID,
	};
}
