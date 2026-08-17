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
	// lib/source.ts imports the full lucide-react icon barrel; transform it
	// to direct imports so the whole icon set stays out of the bundles.
	experimental: {
		optimizePackageImports: ["lucide-react"],
	},

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
				source: "/guides/cli",
				destination: "/developers/cli",
				permanent: true,
			},
			{
				source: "/guides/mcp",
				destination: "/developers/mcp",
				permanent: true,
			},
			{
				source: "/features/coding-agents",
				destination: "/features/source",
				permanent: true,
			},
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
			{
				source: "/features/embeddable-sdk",
				destination: "/features/embeddable-payments",
				permanent: true,
			},
			{
				source: "/docs/:path*",
				destination: "/:path*",
				permanent: true,
			},
			{
				source: "/dashboard",
				destination: "/learn/dashboard",
				permanent: true,
			},
			{
				source: "/api-reference",
				destination: "/v1_chat_completions",
				permanent: true,
			},
			{
				source: "/providers",
				destination: "https://llmgateway.io/providers",
				permanent: true,
			},
			// Guessed REST-style API reference URLs.
			{
				source: "/v1/chat/completions",
				destination: "/v1_chat_completions",
				permanent: true,
			},
			{
				source: "/v1/moderations",
				destination: "/v1_moderations",
				permanent: true,
			},
			{
				source: "/v1/ocr",
				destination: "/v1_ocr",
				permanent: true,
			},
			{
				source: "/v1/videos",
				destination: "/v1_videos_create",
				permanent: true,
			},
			{
				source: "/v1/responses",
				destination: "/v1_chat_completions",
				permanent: true,
			},
		];
	},
};

export default withMDX(nextConfig);
