import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		include: ["**/*.e2e.ts"],
		exclude: ["**/node_modules/**", "**/dist/**", ".conductor/**"],
		environment: "node",
		testTimeout: 60000, // Longer timeout for e2e tests
		hookTimeout: 30000, // Timeout for hooks
		setupFiles: [],
		reporters: ["default"],
		coverage: {
			reporter: ["text", "json", "html"],
			exclude: ["**/node_modules/**", "**/dist/**"],
		},
		// Configure parallel execution with pool of 16 threads
		pool: "threads",
		poolOptions: {
			threads: {
				maxThreads: 16,
				minThreads: 8,
			},
		},
	},
});
