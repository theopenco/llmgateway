import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

import { TEST_WORKER_COUNT } from "./vitest/test-workers.js";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		include: ["**/*.spec.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/*.e2e.ts",
			".conductor/**",
			".claude/**",
		],
		environment: "node",
		testTimeout: 30000, // Increased timeout for tests
		hookTimeout: 20000, // Timeout for hooks
		// Each worker owns a clone of the test database and a Redis logical
		// database, so the files can run in parallel; see vitest/test-workers.ts.
		globalSetup: ["./vitest/global-setup.ts"],
		maxWorkers: TEST_WORKER_COUNT,
		minWorkers: 1,
		setupFiles: [
			"./vitest/test-database-setup.ts",
			"./vitest/unit-worker-setup.ts",
		],
		reporters: ["default"],
		coverage: {
			reporter: ["text", "json", "html"],
			exclude: ["**/node_modules/**", "**/dist/**"],
		},
	},
});
