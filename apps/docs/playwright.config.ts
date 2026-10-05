import { defineConfig } from "@playwright/test";

// Browser e2e tests for the docs site. Start `pnpm dev` first, then run
// `pnpm --filter docs test:e2e`.
export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.pw.ts",
	workers: 1,
	timeout: 60_000,
	use: {
		baseURL:
			process.env.PW_BASE_URL ??
			`http://localhost:${process.env.DOCS_PORT ?? "3005"}`,
		trace: "retain-on-failure",
	},
});
