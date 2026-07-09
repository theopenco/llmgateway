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
	transpilePackages: ["shiki"],
	experimental: {
		serverSourceMaps: true,
	},
	async redirects() {
		// Docs pages that ended up indexed on llmgateway.io because the proxied
		// llms-full.txt contained relative links. Redirect them to their real
		// home on docs.llmgateway.io.
		const docsFeatureSlugs = [
			"anthropic-endpoint",
			"api-keys",
			"caching",
			"caching/gateway-caching",
			"caching/provider-cache-control",
			"coding-agents",
			"compliance",
			"cost-breakdown",
			"custom-providers",
			"data-retention",
			"documents",
			"embeddable-payments",
			"embeddings",
			"image-generation",
			"master-keys",
			"metadata",
			"moderations",
			"ocr",
			"reasoning",
			"response-healing",
			"routing",
			"service-tiers",
			"sessions",
			"source",
			"speech-generation",
			"video-generation",
			"vision",
			"web-search",
		];
		const apiReferenceSlugs = [
			"v1_audio_speech",
			"v1_chat_completions",
			"v1_embeddings",
			"v1_images_edits",
			"v1_images_generations",
			"v1_messages",
			"v1_models",
			"v1_moderations",
			"v1_ocr",
			"v1_videos_content",
			"v1_videos_create",
			"v1_videos_log_content",
			"v1_videos_retrieve",
		];
		// Models that were renamed: sub-pages (provider, uptime) exist at the
		// new slug, so preserve the rest of the path.
		const renamedModelRedirects: Record<string, string> = {
			"qwen37-max": "qwen3.7-max",
			"seedream-4.0": "seedream-4-0",
			"grok-4-fast": "grok-4-fast-reasoning",
			"grok-4-1-fast": "grok-4-1-fast-reasoning",
		};
		// Models that were removed before the "deactivate, never delete"
		// policy existed. Their pages are indexed, so 301 them (including any
		// sub-pages) to the closest surviving model page.
		const removedModelRedirects: Record<string, string> = {
			"gpt-oss-20b-free": "/models/gpt-oss-20b",
			"gpt-4.1-free": "/models/gpt-4.1",
			"glm-4.5-air-free": "/models/glm-4.5-air",
			"llama-3.3-70b-instruct-free": "/models/llama-3.3-70b-instruct",
			"llama-4-scout-free": "/models/llama-4-scout",
			"llama-4-maverick-free": "/models/llama-4-maverick-17b-instruct",
			"kimi-k2-0905-free": "/models/kimi-k2",
			"kimi-k2-0905": "/models/kimi-k2",
			"deepseek-r1t2-chimera-free": "/models/deepseek-r1-0528",
			"mistral-7b-instruct-together": "/models",
			"mixtral-8x7b-instruct-together": "/models",
			"nemotron-nano-9b-v2": "/models",
		};
		// Providers that were removed entirely; their pages and backlinks are
		// still indexed.
		const removedProviderRedirects: Record<string, string> = {
			"together.ai": "/providers/together-ai",
			sherlock: "/providers/xai",
			cloudrift: "/providers",
			routeway: "/providers",
			"routeway-discount": "/providers",
			"anthropic-discount": "/providers",
			bluestone: "/providers",
			obsidian: "/providers",
		};
		return [
			{
				source: "/blog/embeddable-ai-credits-stripe-for-ai",
				destination: "/blog/embeddable-payments-sdk",
				permanent: true,
			},
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
				source: "/chat",
				destination: "https://chat.llmgateway.io",
				permanent: true,
			},
			{
				source: "/playground",
				destination: "https://chat.llmgateway.io",
				permanent: true,
			},
			{
				source: "/code",
				destination: "https://devpass.llmgateway.io",
				permanent: true,
			},
			{
				source: "/devpass",
				destination: "https://devpass.llmgateway.io",
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
				source: "/x",
				destination: "https://x.com/llmgateway",
				permanent: true,
			},
			{
				source: "/cost-simulator",
				destination: "/token-cost-calculator",
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
			{
				source: "/models/grok-4.3",
				destination: "/models/grok-4-3",
				permanent: true,
			},
			{
				source: "/models/grok-4.3/xai",
				destination: "/models/grok-4-3/xai",
				permanent: true,
			},
			{
				source: "/models/grok-4.3/aws-bedrock",
				destination: "/models/grok-4-3/aws-bedrock",
				permanent: true,
			},
			{
				source: "/models/grok-4.3/azure-ai-foundry",
				destination: "/models/grok-4-3/azure-ai-foundry",
				permanent: true,
			},
			// Docs content indexed on the wrong domain (see comment above).
			{
				source: "/quick-start",
				destination: "https://docs.llmgateway.io/quick-start",
				permanent: true,
			},
			{
				source: "/overview",
				destination: "https://docs.llmgateway.io/overview",
				permanent: true,
			},
			{
				source: "/self-host",
				destination: "https://docs.llmgateway.io/self-host",
				permanent: true,
			},
			{
				source: "/self-host/:path*",
				destination: "https://docs.llmgateway.io/self-host/:path*",
				permanent: true,
			},
			{
				source: "/learn/:path*",
				destination: "https://docs.llmgateway.io/learn/:path*",
				permanent: true,
			},
			{
				source: "/resources/:path*",
				destination: "https://docs.llmgateway.io/resources/:path*",
				permanent: true,
			},
			{
				source: "/docs/:path*",
				destination: "https://docs.llmgateway.io/:path*",
				permanent: true,
			},
			{
				source: "/health",
				destination: "https://docs.llmgateway.io/health",
				permanent: true,
			},
			{
				source: "/metrics",
				destination: "https://docs.llmgateway.io/learn/usage-metrics",
				permanent: true,
			},
			{
				source: "/guides/agent-skills",
				destination: "https://docs.llmgateway.io/guides/agent-skills",
				permanent: true,
			},
			{
				source: "/guides/cli",
				destination: "https://docs.llmgateway.io/guides/cli",
				permanent: true,
			},
			{
				source: "/integrations/aws-bedrock",
				destination: "https://docs.llmgateway.io/integrations/aws-bedrock",
				permanent: true,
			},
			{
				source: "/integrations/azure",
				destination: "https://docs.llmgateway.io/integrations/azure",
				permanent: true,
			},
			{
				source: "/integrations/vertex-anthropic",
				destination: "https://docs.llmgateway.io/integrations/vertex-anthropic",
				permanent: true,
			},
			...docsFeatureSlugs.map((slug) => ({
				source: `/features/${slug}`,
				destination: `https://docs.llmgateway.io/features/${slug}`,
				permanent: true,
			})),
			{
				source: "/features/auto-routing",
				destination: "https://docs.llmgateway.io/features/routing",
				permanent: true,
			},
			// API reference pages (fumadocs OpenAPI slugs) indexed on the
			// marketing domain.
			...apiReferenceSlugs.map((slug) => ({
				source: `/${slug}`,
				destination: `https://docs.llmgateway.io/${slug}`,
				permanent: true,
			})),
			{
				source: "/v1",
				destination: "https://docs.llmgateway.io/v1_chat_completions",
				permanent: true,
			},
			{
				source: "/v1_videos",
				destination: "https://docs.llmgateway.io/v1_videos_create",
				permanent: true,
			},
			{
				source: "/v1/chat/completions",
				destination: "https://docs.llmgateway.io/v1_chat_completions",
				permanent: true,
			},
			{
				source: "/v1/images/generations",
				destination: "https://docs.llmgateway.io/v1_images_generations",
				permanent: true,
			},
			{
				source: "/v1/images/edits",
				destination: "https://docs.llmgateway.io/v1_images_edits",
				permanent: true,
			},
			// Removed/renamed models and providers.
			...Object.entries(renamedModelRedirects).flatMap(([slug, target]) => [
				{
					source: `/models/${slug}`,
					destination: `/models/${target}`,
					permanent: true,
				},
				{
					source: `/models/${slug}/:path*`,
					destination: `/models/${target}/:path*`,
					permanent: true,
				},
			]),
			...Object.entries(removedModelRedirects).flatMap(
				([slug, destination]) => [
					{
						source: `/models/${slug}`,
						destination,
						permanent: true,
					},
					{
						source: `/models/${slug}/:path*`,
						destination,
						permanent: true,
					},
				],
			),
			...Object.entries(removedProviderRedirects).map(
				([slug, destination]) => ({
					source: `/providers/${slug}`,
					destination,
					permanent: true,
				}),
			),
			// Misc renamed or truncated URLs that picked up external links.
			{
				source: "/migrations/:path*",
				destination: "/migration/:path*",
				permanent: true,
			},
			{
				source: "/migration/open-router",
				destination: "/migration/openrouter",
				permanent: true,
			},
			{
				source: "/changelog/video-gen-sessions-content-filter",
				destination: "/changelog/video-gen-sessions-and-more",
				permanent: true,
			},
			{
				source: "/changelog/claude-code-50-percent-off",
				destination: "/changelog",
				permanent: true,
			},
			{
				source: "/changelog/routeway-free-models",
				destination: "/changelog",
				permanent: true,
			},
			{
				source: "/mo",
				destination: "/models",
				permanent: true,
			},
			{
				source: "/image",
				destination: "/models/text-to-image",
				permanent: true,
			},
			{
				source: "/connect",
				destination: "/connect/cli",
				permanent: true,
			},
		];
	},
	async rewrites() {
		return [
			// /llms.txt is served as a static file from public/ (which takes
			// precedence over rewrites), so it is intentionally not proxied here.
			{
				source: "/llms-full.txt",
				destination: "https://docs.llmgateway.io/llms-full.txt",
			},
			{
				source: "/docs-health",
				destination: "https://docs.llmgateway.io/health",
			},
		];
	},
	typescript: {
		ignoreBuildErrors: true,
	},
};

// withContentCollections must be the outermost plugin
export default withContentCollections(nextConfig);
