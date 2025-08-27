import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		include: ["**/*.spec.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/*.e2e.ts",
			".conductor/**",
		],
		environment: "node",
		testTimeout: 30000, // Increased timeout for tests
		hookTimeout: 20000, // Timeout for hooks
		setupFiles: [],
		reporters: ["default"],
		coverage: {
			reporter: ["text", "json", "html"],
			exclude: ["**/node_modules/**", "**/dist/**"],
		},
	},
});
