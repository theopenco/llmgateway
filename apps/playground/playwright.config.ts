import { defineConfig } from "@playwright/test";

// Browser e2e tests for the Lounge (playground) app. These run against a
// locally running stack (API on :4002, playground on :3003) with a freshly
// seeded database (`pnpm setup`), and are not part of the root vitest suites:
// run them with `pnpm --filter playground test:e2e`.
export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.pw.ts",
	workers: 1,
	timeout: 90_000,
	use: {
		baseURL: process.env.PW_BASE_URL ?? "http://localhost:3003",
		trace: "retain-on-failure",
		video: "retain-on-failure",
	},
});
