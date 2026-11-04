import { remark } from "remark";
import remarkMdx from "remark-mdx";

import { docsBaseUrl } from "@/lib/base-url";
import { marketingGuideCanonical } from "@/lib/guide-canonical";

import type { source } from "@/lib/source";
import type { InferPageType } from "fumadocs-core/source";

const DOCS_URL = docsBaseUrl;

// Navigation-card components whose target pages are already concatenated in
// full elsewhere in llms-full.txt; interactive embeds have no text value and
// are dropped entirely.
const MDX_COMPONENT_REPLACEMENTS: Record<string, string> = {
	FeatureCards: `All features are documented under ${DOCS_URL}/features; each feature page is included in full in this file.`,
	AIToolingCards: `AI tooling: ${DOCS_URL}/llms.txt (docs index for LLMs), ${DOCS_URL}/llms-full.txt (this file), ${DOCS_URL}/developers/mcp (MCP server), ${DOCS_URL}/guides/agent-skills (agent skills), and https://llmgateway.io/templates (templates and agents).`,
	SelfHostCards: `Self-hosting guides are documented under ${DOCS_URL}/self-host and included in full in this file.`,
};

const mdxParser = remark().use(remarkMdx);

// Source reproduced verbatim (code, raw JS), where blank-line runs are content
// rather than layout.
const VERBATIM_NODE_TYPES = new Set(["code", "mdxFlowExpression", "mdxjsEsm"]);

interface MdxNode {
	type: string;
	name?: string | null;
	attributes?: { type: string; name?: string; value?: unknown }[];
	children?: MdxNode[];
	position?: {
		start: { offset?: number; column: number };
		end: { offset?: number };
	};
}

interface Edit {
	start: number;
	end: number;
	text: string;
}

function isComponent(node: MdxNode): boolean {
	return (
		(node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
		/^[A-Z]/.test(node.name ?? "")
	);
}

function replacementFor(node: MdxNode): string | undefined {
	return MDX_COMPONENT_REPLACEMENTS[node.name ?? ""];
}

// A component vanishes when no readable text is left once its tags go.
function vanishes(node: MdxNode): boolean {
	return (
		isComponent(node) &&
		replacementFor(node) === undefined &&
		(node.children ?? []).every(vanishes)
	);
}

function span(node: MdxNode): [number, number] {
	return [node.position!.start.offset!, node.position!.end.offset!];
}

function lineStart(text: string, offset: number): number {
	return text.lastIndexOf("\n", offset - 1) + 1;
}

// A vanishing block component on its own line takes that line and the blank
// lines after it, so dropping it leaves no gap in the surrounding prose.
function dropEdit(text: string, node: MdxNode): Edit {
	const [start, end] = span(node);
	const line = lineStart(text, start);
	const rest = /^[ \t]*(?:\n|$)(?:[ \t]*\n)*/.exec(text.slice(end));
	return node.type === "mdxJsxFlowElement" &&
		rest &&
		!text.slice(line, start).trim()
		? { start: line, end: end + rest[0].length, text: "" }
		: { start, end, text: "" };
}

// Readable labels such as FAQ questions and callout headings live in the
// `title` attribute, so an unwrapped block component keeps it as a bold line
// above its content, at the indentation the content ends up with.
function titleHeading(
	text: string,
	node: MdxNode,
	blockContent: boolean,
	dedents: Map<number, number>,
): string {
	const title = node.attributes?.find(
		(attribute) =>
			attribute.type === "mdxJsxAttribute" && attribute.name === "title",
	)?.value;
	if (
		node.type !== "mdxJsxFlowElement" ||
		typeof title !== "string" ||
		!title.trim()
	) {
		return "";
	}
	const [start] = span(node);
	const line = lineStart(text, start);
	const prefix = text.slice(line, start);
	if (!blockContent || prefix.trim()) {
		return `**${title.trim()}** `;
	}
	return `**${title.trim()}**\n\n${prefix.slice(dedents.get(line) ?? 0)}`;
}

// Raw MDX component tags mean nothing to LLM readers; swap known navigation
// components for text pointers, unwrap the rest and drop the ones with no
// readable content. Tags are located on the parsed MDX tree, so code, inline
// code and quoted attribute values are never mistaken for markup. Unwrapped
// block content loses the indentation the stringifier nests it under, and the
// untouched text keeps its original formatting.
function replaceMdxComponents(text: string): string {
	const edits: Edit[] = [];
	const dedents = new Map<number, number>();
	const verbatim: [number, number][] = [];

	const collect = (nodes: MdxNode[]): void => {
		for (const node of nodes) {
			const [start, end] = span(node);
			if (VERBATIM_NODE_TYPES.has(node.type)) {
				verbatim.push([start, end]);
				continue;
			}
			if (!isComponent(node)) {
				collect(node.children ?? []);
				continue;
			}
			const replacement = replacementFor(node);
			if (replacement !== undefined) {
				edits.push({ start, end, text: replacement });
				continue;
			}
			const children = node.children ?? [];
			const kept = children.filter((child) => !vanishes(child));
			const first = kept[0];
			const last = kept.at(-1);
			if (!first || !last) {
				edits.push(dropEdit(text, node));
				continue;
			}
			const [contentStart] = span(first);
			const [, contentEnd] = span(last);
			const firstLine = lineStart(text, contentStart);
			const blockContent =
				node.type === "mdxJsxFlowElement" &&
				!text.slice(firstLine, contentStart).trim();
			edits.push(
				{
					start,
					end: contentStart,
					text: titleHeading(text, node, blockContent, dedents),
				},
				{ start: contentEnd, end, text: "" },
			);
			const shift = first.position!.start.column - node.position!.start.column;
			if (blockContent && shift > 0) {
				const lastLine = lineStart(text, contentEnd);
				for (let line = firstLine; ; line = text.indexOf("\n", line) + 1) {
					dedents.set(line, (dedents.get(line) ?? 0) + shift);
					if (line >= lastLine) {
						break;
					}
				}
			}
			collect(
				children.slice(children.indexOf(first), children.indexOf(last) + 1),
			);
		}
	};
	let tree: MdxNode;
	try {
		tree = mdxParser.parse(text) as MdxNode;
	} catch {
		// Not valid MDX: export the page as-is rather than failing the whole file.
		return text;
	}
	collect(tree.children ?? []);

	const indentation = /[ \t]*/y;
	for (const [line, shift] of dedents) {
		indentation.lastIndex = line;
		const width = Math.min(shift, indentation.exec(text)?.[0].length ?? 0);
		if (width > 0) {
			edits.push({ start: line, end: line + width, text: "" });
		}
	}
	for (const run of text.matchAll(/\n(?:[ \t]*\n){2,}/g)) {
		const start = run.index;
		const end = start + run[0].length;
		if (!verbatim.some(([from, to]) => start < to && end > from)) {
			edits.push({ start, end, text: "\n\n" });
		}
	}

	// Edits nest (a tag line inside an outer dedent, a blank run inside a
	// dropped line); the outermost one at each position wins.
	let out = "";
	let cursor = 0;
	for (const edit of edits.sort((a, b) => a.start - b.start || b.end - a.end)) {
		if (edit.end <= cursor) {
			continue;
		}
		out += text.slice(cursor, edit.start) + edit.text;
		cursor = edit.end;
	}
	return out + text.slice(cursor);
}

export async function getLLMText(page: InferPageType<typeof source>) {
	const processed = await page.data.getText("processed");
	// Root-relative markdown links would be resolved against whatever domain
	// serves this text (llmgateway.io proxies /llms-full.txt), so make them
	// absolute docs URLs.
	const absolute = processed.replace(/\]\((\/[^)\s]*)\)/g, `](${DOCS_URL}$1)`);
	return `# ${page.data.title}
URL: ${marketingGuideCanonical(page.url) ?? `${DOCS_URL}${page.url}`}
${replaceMdxComponents(absolute)}`;
}
