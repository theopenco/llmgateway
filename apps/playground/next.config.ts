import { readdirSync } from "fs";
import { join } from "path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	outputFileTracingRoot: join(__dirname, "../../"),
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	output: "standalone",
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	reactCompiler: true,
	transpilePackages: ["shiki"],
	// bundle-barrel-imports: Optimize package imports to avoid loading entire libraries
	// This transforms barrel imports to direct imports at build time (15-70% faster dev boot)
	experimental: {
		optimizePackageImports: [
			"lucide-react",
			"@radix-ui/react-icons",
			"date-fns",
		],
	},
	webpack: (config, { isServer }) => {
		if (isServer) {
			config.devtool = "source-map";
		}
		// mermaid -> @mermaid-js/parser -> langium has transitive deps
		// (vscode-jsonrpc, vscode-languageserver-types, etc.) that pnpm
		// doesn't hoist to a location webpack can resolve
		const pnpmDir = join(__dirname, "../../node_modules/.pnpm");
		const depsToHoist = [
			"langium",
			"chevrotain",
			"vscode-languageserver-protocol",
			"vscode-languageserver",
		];
		const extraModules: string[] = [];
		for (const dep of depsToHoist) {
			for (const entry of readdirSync(pnpmDir)) {
				if (entry.startsWith(`${dep}@`)) {
					extraModules.push(join(pnpmDir, entry, "node_modules"));
				}
			}
		}
		config.resolve.modules = [
			...(config.resolve.modules ?? []),
			...extraModules,
		];
		return config;
	},
	typescript: {
		ignoreBuildErrors: true,
	},
};

export default nextConfig;
