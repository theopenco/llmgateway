import { withContentCollections } from "@content-collections/next";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	productionBrowserSourceMaps: true,
	eslint: {
		ignoreDuringBuilds: true,
	},
	// experimental: {
	// 	typedRoutes: true,
	// 	clientSegmentCache: true,
	// 	devtoolSegmentExplorer: true,
	// 	globalNotFound: true,
	// },
	webpack: (config, { isServer }) => {
		if (isServer) {
			config.devtool = "source-map";
		}
		return config;
	},
	async redirects() {
		return [
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
		];
	},
};

// withContentCollections must be the outermost plugin
export default withContentCollections(nextConfig);
