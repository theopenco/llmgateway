import { visit } from "unist-util-visit";

import { interpolateRoutingDefaults } from "@llmgateway/shared/routing-defaults";

type Tree = Parameters<typeof visit>[0];

/**
 * Resolves `%routing.<path>%` tokens (see interpolateRoutingDefaults) in text
 * and inline code so docs always show the live routing defaults. Runs before
 * fumadocs' structure/postprocess plugins, so search and llms.txt see the
 * resolved values too.
 */
export function remarkRoutingDefaults() {
	return (tree: Tree) => {
		visit(tree, (node) => {
			if (
				(node.type === "text" || node.type === "inlineCode") &&
				"value" in node &&
				typeof node.value === "string" &&
				node.value.includes("%routing.")
			) {
				node.value = interpolateRoutingDefaults(node.value);
			}
		});
	};
}
