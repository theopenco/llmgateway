import { APIPage } from "fumadocs-openapi/ui";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import defaultMdxComponents from "fumadocs-ui/mdx";

import { openapi } from "@/lib/source";

import type { MDXComponents } from "mdx/types";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
	return {
		...defaultMdxComponents,
		APIPage: (props) => <APIPage {...openapi.getAPIPageProps(props)} />,
		DynamicCodeBlock,
		pre: ({ ref: _ref, ...props }) => (
			<CodeBlock {...props}>
				<Pre>{props.children}</Pre>
			</CodeBlock>
		),
		...components,
	};
}
