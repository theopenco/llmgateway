import { relative, resolve } from "node:path";

import {
	defineDocs,
	frontmatterSchema,
	metaSchema,
	defineConfig,
} from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";

import contentModified from "./lib/content-modified.json";

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
	plugins: [
		lastModified({
			versionControl: async (filePath) => {
				const key = relative(resolve("content"), filePath).replaceAll(
					"\\",
					"/",
				);
				const entries: Record<string, { hash: string; lastModified: string }> =
					contentModified;
				const entry = entries[key];
				if (!entry) {
					throw new Error(
						`No modification date for ${key}. Run pnpm gen-docs.`,
					);
				}
				return new Date(entry.lastModified);
			},
		}),
	],
});
