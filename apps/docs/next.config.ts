import { join } from "path";

import { createMDX } from "fumadocs-mdx/next";

import type { NextConfig } from "next";

const withMDX = createMDX();

const nextConfig: NextConfig = {
	outputFileTracingRoot: join(__dirname, "../../"),
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	output: "standalone",
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	reactCompiler: true,
	transpilePackages: ["shiki"],

	rewrites() {
		return [
			{
				source: "/:path*.mdx",
				destination: "/llms.mdx/:path*",
			},
		];
	},
	redirects() {
		return [
			{
				source: "/features/llm-sdk",
				destination: "/features/embeddable-payments",
				permanent: true,
			},
			{
				source: "/features/gateway-caching",
				destination: "/features/caching/gateway-caching",
				permanent: true,
			},
			{
				source: "/features/provider-cache-control",
				destination: "/features/caching/provider-cache-control",
				permanent: true,
			},
		];
	},
};

export default withMDX(nextConfig);
