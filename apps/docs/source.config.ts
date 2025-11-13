import { defineDocs, frontmatterSchema, metaSchema } from "fumadocs-mdx/config";

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
