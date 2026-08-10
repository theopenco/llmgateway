import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import {
	type ComponentProps,
	type ReactElement,
	type ReactNode,
	Suspense,
	isValidElement,
	use,
	useDeferredValue,
} from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { visit } from "unist-util-visit";

import type { ElementContent, Root, RootContent } from "hast";

export interface Processor {
	process: (content: string) => Promise<ReactNode>;
}

export function rehypeWrapWords() {
	return (tree: Root) => {
		visit(tree, (node, index, parent) => {
			if (node.type === "element" && node.tagName === "pre") {
				return "skip";
			}
			if (node.type !== "text" || !parent || index === undefined) {
				return;
			}

			const words: string[] = node.value.split(/(?=\s)/);

			// Create new span nodes for each word and whitespace
			const newNodes: ElementContent[] = words.flatMap((word: string) => {
				if (word.length === 0) {
					return [];
				}

				return {
					type: "element",
					tagName: "span",
					properties: {
						class: "animate-fd-fade-in",
					},
					children: [{ type: "text", value: word }],
				};
			});

			Object.assign(node, {
				type: "element",
				tagName: "span",
				properties: {},
				children: newNodes,
			} satisfies RootContent);
			return "skip";
		});
	};
}

function createProcessor(): Processor {
	const processor = remark()
		.use(remarkGfm)
		.use(remarkRehype)
		.use(rehypeWrapWords);

	return {
		async process(content) {
			const nodes = processor.parse({ value: content });
			const hast = await processor.run(nodes);

			return toJsxRuntime(hast, {
				development: false,
				jsx,
				jsxs,
				Fragment,
				components: {
					...defaultMdxComponents,
					pre: Pre,
					img: undefined, // use JSX
				},
			});
		},
	};
}

function Pre(props: ComponentProps<"pre">) {
	const code = props.children;
	if (!isValidElement(code)) {
		return null;
	}
	const codeProps = (code as ReactElement).props as ComponentProps<"code">;
	const content = codeProps.children;
	if (typeof content !== "string") {
		return null;
	}

	let lang =
		codeProps.className
			?.split(" ")
			.find((v) => v.startsWith("language-"))
			?.slice("language-".length) ?? "text";

	if (lang === "mdx") {
		lang = "md";
	}

	return <DynamicCodeBlock lang={lang} code={content.trimEnd()} />;
}

const processor = createProcessor();

export function Markdown({ text }: { text: string }) {
	const deferredText = useDeferredValue(text);

	return (
		<Suspense fallback={<p className="invisible">{text}</p>}>
			<Renderer text={deferredText} />
		</Suspense>
	);
}

// Streaming answers render one snapshot per token, so cap the cache to keep
// intermediate strings from accumulating for the lifetime of the tab.
const cache = new Map<string, Promise<ReactNode>>();
const cacheLimit = 200;

function Renderer({ text }: { text: string }) {
	let result = cache.get(text);

	if (result) {
		// Refresh insertion order so eviction removes cold entries first.
		cache.delete(text);
	} else {
		result = processor.process(text);
		if (cache.size >= cacheLimit) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) {
				cache.delete(oldest);
			}
		}
	}
	cache.set(text, result);

	return use(result);
}
