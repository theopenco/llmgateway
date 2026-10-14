import { visit } from "unist-util-visit";

import { interpolateRoutingDefaults } from "@llmgateway/shared/routing-defaults";

type Tree = Parameters<typeof visit>[0];

const TOKEN_MARKER = "%routing.";

/**
 * Resolves `%routing.<path>%` tokens (see interpolateRoutingDefaults) in prose,
 * inline code, code blocks and MDX JSX string attributes so docs always show
 * the live routing defaults. Code keeps config-style numbers (`3600`, not
 * `3,600`). Frontmatter is not processed. Runs before fumadocs'
 * structure/postprocess plugins, so search and llms.txt see resolved values.
 */
export function remarkRoutingDefaults() {
	return (tree: Tree) => {
		visit(tree, (node) => {
			if (
				"value" in node &&
				typeof node.value === "string" &&
				node.value.includes(TOKEN_MARKER) &&
				(node.type === "text" ||
					node.type === "inlineCode" ||
					node.type === "code")
			) {
				node.value = interpolateRoutingDefaults(node.value, {
					grouping: node.type === "text",
				});
			}
			if (
				(node.type === "mdxJsxFlowElement" ||
					node.type === "mdxJsxTextElement") &&
				"attributes" in node &&
				Array.isArray(node.attributes)
			) {
				for (const attribute of node.attributes as {
					value?: unknown;
				}[]) {
					if (
						typeof attribute.value === "string" &&
						attribute.value.includes(TOKEN_MARKER)
					) {
						attribute.value = interpolateRoutingDefaults(attribute.value);
					}
				}
			}
		});
	};
}
