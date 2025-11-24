import { join } from "path";

import { createMDX } from "fumadocs-mdx/next";

import type { NextConfig } from "next";

const withMDX = createMDX();

const nextConfig: NextConfig = {
	outputFileTracingRoot: join(__dirname, "../../"),
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	output: "standalone",
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	reactCompiler: true,
	transpilePackages: ["shiki"],

	async rewrites() {
		return [
			{
				source: "/docs/:path*.mdx",
				destination: "/llms.mdx/:path*",
			},
		];
	},
};

export default withMDX(nextConfig);
