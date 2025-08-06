import { withContentCollections } from "@content-collections/next";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	eslint: {
		ignoreDuringBuilds: true,
	},
	typescript: {
		// TODO TEMP!!!!!
		ignoreBuildErrors: true,
	},
	// experimental: {
	// 	typedRoutes: true,
	// 	clientSegmentCache: true,
	// 	devtoolSegmentExplorer: true,
	// 	globalNotFound: true,
	// },
};

// withContentCollections must be the outermost plugin
export default withContentCollections(nextConfig);
