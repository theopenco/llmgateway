import { defineConfig } from "@playwright/test";

// Assumes a locally running stack (API on :4002, Airside on :3007) with a
// freshly seeded database (`pnpm setup`). Run with `pnpm --filter airside test:e2e`.
export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.pw.ts",
	workers: 1,
	timeout: 90_000,
	use: {
		baseURL: process.env.PW_BASE_URL ?? "http://localhost:3007",
		trace: "retain-on-failure",
		video: "retain-on-failure",
	},
});
