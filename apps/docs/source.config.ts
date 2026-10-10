import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
	defineDocs,
	frontmatterSchema,
	metaSchema,
	defineConfig,
} from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";

import { remarkRoutingDefaults } from "./lib/remark-routing-defaults";

// Written by scripts/update-content-modified.mjs; absent until the first build.
const contentModifiedPath = resolve("lib/content-modified.json");
const contentModified: Record<string, string> = existsSync(contentModifiedPath)
	? JSON.parse(readFileSync(contentModifiedPath, "utf8"))
	: {};
const apiReferenceKey = "(gateway)/(api)";

export const { docs, meta } = defineDocs({
	dir: "content",
	docs: {
		schema: frontmatterSchema,
		postprocess: {
			includeProcessedMarkdown: true,
		},
	},
	meta: {
		schema: metaSchema,
	},
});

export default defineConfig({
	mdxOptions: {
		remarkPlugins: [remarkRoutingDefaults],
	},
	plugins: [
		lastModified({
			versionControl: async (filePath) => {
				const key = relative(resolve("content"), filePath).replaceAll(
					"\\",
					"/",
				);
				const lastModified =
					contentModified[key] ??
					(key.startsWith(`${apiReferenceKey}/`)
						? contentModified[apiReferenceKey]
						: undefined);
				return lastModified ? new Date(lastModified) : undefined;
			},
		}),
	],
});
