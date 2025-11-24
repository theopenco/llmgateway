import { join } from "path";

import { withContentCollections } from "@content-collections/next";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	outputFileTracingRoot: join(__dirname, "../../"),
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	output: "standalone",
	productionBrowserSourceMaps: true,
	typedRoutes: true,
	reactStrictMode: true,
	reactCompiler: true,
	experimental: {
		turbopackFileSystemCacheForDev: true,
		// turbopackFileSystemCacheForBuild: true,
	},
	async redirects() {
		return [
			{
				source: "/models/sherlock-dash-alpha",
				destination: "/models/grok-4-1-fast-non-reasoning",
				permanent: true,
			},
			{
				source: "/models/sherlock-think-alpha",
				destination: "/models/grok-4-1-fast-reasoning",
				permanent: true,
			},
			{
				source: "/docs",
				destination: "https://docs.llmgateway.io",
				permanent: true,
			},
			{
				source: "/discord",
				destination: "https://discord.gg/3u7jpXf36B",
				permanent: true,
			},
			{
				source: "/github",
				destination: "https://github.com/theopenco/llmgateway",
				permanent: true,
			},
			{
				source: "/twitter",
				destination: "https://twitter.com/llmgateway",
				permanent: true,
			},
			{
				source: "/terms",
				destination: "/legal/terms",
				permanent: true,
			},
			{
				source: "/terms-of-use",
				destination: "/legal/terms",
				permanent: true,
			},
			{
				source: "/privacy",
				destination: "/legal/privacy",
				permanent: true,
			},
			{
				source: "/privacy-policy",
				destination: "/legal/privacy",
				permanent: true,
			},
		];
	},
};

// withContentCollections must be the outermost plugin
export default withContentCollections(nextConfig);
