import { join } from "path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	outputFileTracingRoot: join(__dirname, "../../"),
	distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
	output: "standalone",
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	reactCompiler: true,
	transpilePackages: ["shiki"],
};

export default nextConfig;
