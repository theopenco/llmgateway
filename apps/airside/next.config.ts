import { join } from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	outputFileTracingRoot: join(__dirname, "../../"),
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	output: "standalone",
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	reactCompiler: true,
	experimental: {
		agentUpgrade: "latest",
		serverSourceMaps: true,
	},
	async rewrites() {
		// First-party PostHog ingestion proxy — ad blockers block
		// *.posthog.com directly, silently dropping client events. The
		// client is configured with api_host: "/ingest" (providers.tsx).
		return [
			{
				source: "/ingest/static/:path*",
				destination: "https://us-assets.i.posthog.com/static/:path*",
			},
			{
				source: "/ingest/:path*",
				destination: "https://us.i.posthog.com/:path*",
			},
		];
	},
	typescript: {
		// tsc runs separately in the build script.
		ignoreBuildErrors: true,
	},
};

export default nextConfig;
