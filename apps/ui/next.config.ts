import { withContentCollections } from "@content-collections/next";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	eslint: {
		ignoreDuringBuilds: true,
	},
	// experimental: {
	// 	typedRoutes: true,
	// 	clientSegmentCache: true,
	// 	devtoolSegmentExplorer: true,
	// 	globalNotFound: true,
	// },
	async rewrites() {
		return [
			{
				source: "/docs",
				destination: "https://docs.llmgateway.com",
			},
			{
				source: "/discord",
				destination: "https://discord.gg/3u7jpXf36B",
			},
			{
				source: "/github",
				destination: "https://github.com/theopenco/llmgateway",
			},
			{
				source: "/twitter",
				destination: "https://twitter.com/llmgateway",
			},
		];
	},
};

// withContentCollections must be the outermost plugin
export default withContentCollections(nextConfig);
