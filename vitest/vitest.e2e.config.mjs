import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        include: ["**/*.e2e.ts"],
        exclude: ["**/node_modules/**", "**/dist/**", ".conductor/**"],
        environment: "node",
        testTimeout: 60000,
        hookTimeout: 30000,
        setupFiles: [],
        reporters: ["default"],
        coverage: {
            reporter: ["text", "json", "html"],
            exclude: ["**/node_modules/**", "**/dist/**"],
        },
        pool: "threads",
        poolOptions: {
            threads: {
                maxThreads: 16,
                minThreads: 8,
            },
        },
    },
});
//# sourceMappingURL=vitest.e2e.config.mjs.map