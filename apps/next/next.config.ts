import { withContentCollections } from "@content-collections/next";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	eslint: {
		ignoreDuringBuilds: true,
	},
};

// withContentCollections must be the outermost plugin
export default withContentCollections(nextConfig);
