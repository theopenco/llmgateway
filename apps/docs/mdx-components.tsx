import defaultMdxComponents from "fumadocs-ui/mdx";

import { APIPage } from "./components/api-page";

import type { MDXComponents } from "mdx/types";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
	// return {
	// 	...defaultMdxComponents,
	// 	APIPage: (props) => <APIPage {...openapi.getAPIPageProps(props)} />,
	// 	DynamicCodeBlock,
	// 	pre: ({ ref: _ref, ...props }) => (
	// 		<CodeBlock {...props}>
	// 			<Pre>{props.children}</Pre>
	// 		</CodeBlock>
	// 	),
	// 	...components,
	// };
	return {
		...defaultMdxComponents,
		APIPage,
		...components,
	};
}
