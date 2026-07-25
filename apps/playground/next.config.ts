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
		serverSourceMaps: true,
	},
	serverExternalPackages: [
		"@resvg/resvg-js",
		"@react-pdf/renderer",
		"@json-render/react-pdf",
		"@json-render/image",
	],
	async rewrites() {
		return [
			// First-party PostHog ingestion proxy — ad blockers block
			// *.posthog.com directly, silently dropping client events. The
			// client is configured with api_host: "/ingest" (providers.tsx).
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
		ignoreBuildErrors: true,
	},
};

export default nextConfig;
