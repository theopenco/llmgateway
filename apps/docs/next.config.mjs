import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import("next").NextConfig} */
const config = {
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

export default withMDX(config);
