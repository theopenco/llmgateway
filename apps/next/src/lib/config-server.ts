export interface AppConfig {
	hosted: boolean;
	apiUrl: string;
	githubUrl: string;
	docsUrl: string;
	posthogKey?: string;
	posthogHost?: string;
	crispId?: string;
}

export function getConfig(): AppConfig {
	return {
		hosted: process.env.HOSTED === "true",
		apiUrl: process.env.API_URL || "http://localhost:4002",
		githubUrl:
			process.env.GITHUB_URL || "https://github.com/theopenco/llmgateway",
		docsUrl: process.env.DOCS_URL || "http://localhost:3005",
		posthogKey: process.env.POSTHOG_KEY,
		posthogHost: process.env.POSTHOG_HOST,
		crispId: process.env.CRISP_ID,
	};
}
