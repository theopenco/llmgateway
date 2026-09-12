import { defineConfig } from "@playwright/test";

const apps = [
	{ name: "ui", url: process.env.UI_URL ?? "http://localhost:3002" },
	{
		name: "playground",
		url: process.env.PLAYGROUND_URL ?? "http://localhost:3003",
	},
	{ name: "code", url: process.env.CODE_URL ?? "http://localhost:3004" },
	{ name: "airside", url: process.env.AIRSIDE_URL ?? "http://localhost:3007" },
];

// Seeded enterprise features and repeated signups need development backends.
const backendEnv = {
	NODE_ENV: "development",
	DOTENV_CONFIG_PATH: "/dev/null",
};

export default defineConfig({
	testMatch: "**/*.pw.ts",
	workers: 1,
	forbidOnly: !!process.env.CI,
	timeout: 90_000,
	reporter: process.env.CI
		? [["github"], ["html", { open: "never" }]]
		: [["list"], ["html", { open: "never" }]],
	use: {
		trace: "retain-on-failure",
		video: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: apps.map(({ name, url }) => ({
		name,
		testDir: `./apps/${name}/e2e`,
		use: { baseURL: url },
	})),
	webServer: [
		{
			name: "api",
			command: "node apps/api/dist/serve.js",
			url: process.env.API_URL ?? "http://localhost:4002",
			env: backendEnv,
		},
		{
			name: "gateway",
			command: "node apps/gateway/dist/serve.js",
			url: process.env.GATEWAY_URL ?? "http://localhost:4001",
			env: backendEnv,
		},
		{
			name: "worker",
			command: "node apps/worker/dist/index.js",
			wait: { stdout: /Starting worker loops/ },
			env: backendEnv,
		},
		...[
			...apps,
			{ name: "docs", url: process.env.DOCS_URL ?? "http://localhost:3005" },
		].map(({ name, url }) => ({
			name,
			command: `node apps/${name}/.next/standalone/apps/${name}/server.js`,
			url,
			env: { PORT: new URL(url).port, HOSTNAME: "127.0.0.1" },
		})),
	],
});
