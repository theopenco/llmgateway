import { join } from "path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	outputFileTracingRoot: join(__dirname, "../../"),
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	output: "standalone",
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	reactCompiler: true,
	webpack: (config, { isServer }) => {
		if (isServer) {
			config.devtool = "source-map";
		}
		return config;
	},
	typescript: {
		ignoreBuildErrors: true,
	},
};

export default nextConfig;
