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
	useEffect,
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

// Text a mounted Renderer still depends on, by reference count. Evicting one of
// these would make that Renderer re-suspend on its next render and flash an
// already-answered message back to the invisible fallback — messages stop
// re-rendering once they finish streaming (apps/docs runs the React Compiler),
// so LRU ordering alone does not keep them warm.
const pinned = new Map<string, number>();

function evictColdEntries(exclude?: string) {
	for (const key of cache.keys()) {
		if (cache.size <= cacheLimit) {
			return;
		}
		if (key !== exclude && !pinned.has(key)) {
			cache.delete(key);
		}
	}
}

function Renderer({ text }: { text: string }) {
	useEffect(() => {
		pinned.set(text, (pinned.get(text) ?? 0) + 1);

		return () => {
			const count = pinned.get(text) ?? 0;
			if (count > 1) {
				pinned.set(text, count - 1);
			} else {
				pinned.delete(text);
			}
			// A slot just went cold; reclaim it so the cache shrinks back once
			// long-lived messages unmount.
			evictColdEntries();
		};
	}, [text]);

	let result = cache.get(text);

	if (result) {
		// Refresh insertion order so eviction removes cold entries first.
		cache.delete(text);
	} else {
		result = processor.process(text);
	}
	cache.set(text, result);
	// The current entry is not pinned until the effect runs, so shield it from
	// eviction — deleting it here would recreate the promise every render and
	// suspend the message indefinitely once all other slots are pinned.
	evictColdEntries(text);

	return use(result);
}
