import { join } from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	outputFileTracingRoot: join(__dirname, "../../"),
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	output: "standalone",
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	reactCompiler: true,
	experimental: {
		serverSourceMaps: true,
	},
	typescript: {
		// tsc runs separately in the build script.
		ignoreBuildErrors: true,
	},
};

export default nextConfig;
