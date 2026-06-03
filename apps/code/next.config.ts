import { join } from "path";

import { withContentCollections } from "@content-collections/next";

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
		ignoreBuildErrors: true,
	},
};

// withContentCollections must be the outermost plugin
export default withContentCollections(nextConfig);
