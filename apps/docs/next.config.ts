import { join } from "path";

import { createMDX } from "fumadocs-mdx/next";

import type { NextConfig } from "next";

const withMDX = createMDX();

const nextConfig: NextConfig = {
	outputFileTracingRoot: join(__dirname, "../../"),
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	output: "standalone",
	env: {
		NEXT_PUBLIC_PLAYGROUND_URL:
			process.env.PLAYGROUND_URL ??
			(process.env.NODE_ENV === "development"
				? `http://localhost:${process.env.PLAYGROUND_PORT ?? 3003}`
				: "https://lounge.llmgateway.io"),
	},
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	reactCompiler: true,
	transpilePackages: ["shiki"],
	// lib/source.ts imports the full lucide-react icon barrel; transform it
	// to direct imports so the whole icon set stays out of the bundles.
	experimental: {
		agentUpgrade: "latest",
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
		// Guessed REST-style API reference URLs.
		const apiPathReferenceSlugs: Record<string, string> = {
			"audio/speech": "v1_audio_speech",
			"audio/transcriptions": "v1_audio_transcriptions",
			"chat/completions": "v1_chat_completions",
			decisions: "v1_decisions",
			embeddings: "v1_embeddings",
			"images/edits": "v1_images_edits",
			"images/generations": "v1_images_generations",
			key: "v1_key_retrieve",
			messages: "v1_messages",
			models: "v1_models",
			moderations: "v1_moderations",
			ocr: "v1_ocr",
			realtime: "v1_realtime_client_secrets",
			rerank: "v1_rerank",
			responses: "v1_chat_completions",
			search: "v1_search",
			systemone: "v1_systemone",
			videos: "v1_videos_create",
		};
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
			...Object.entries(apiPathReferenceSlugs).map(([path, slug]) => ({
				source: `/v1/${path}`,
				destination: `/${slug}`,
				permanent: true,
			})),
			{
				source: "/v1_videos",
				destination: "/v1_videos_create",
				permanent: true,
			},
		];
	},
};

export default withMDX(nextConfig);
