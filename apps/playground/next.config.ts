import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	eslint: {
		ignoreDuringBuilds: true,
	},
	webpack: (config, { isServer }) => {
		if (isServer) {
			config.devtool = "source-map";
		}
		return config;
	},
};

export default nextConfig;
