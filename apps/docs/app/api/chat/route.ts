import {
	convertToModelMessages,
	stepCountIs,
	streamText,
	tool,
	type UIMessage,
} from "ai";
import { Document, type DocumentData } from "flexsearch";
import { z } from "zod";

import { source } from "@/lib/source";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

export const runtime = "nodejs";
export const maxDuration = 300;

interface CustomDocument extends DocumentData {
	url: string;
	title: string;
	description: string;
	content: string;
}

export type ChatUIMessage = UIMessage<
	never,
	{
		client: {
			location: string;
		};
	}
>;

const searchServer = createSearchServer();

async function createSearchServer() {
	const search = new Document<CustomDocument>({
		document: {
			id: "url",
			index: ["title", "description", "content"],
			store: true,
		},
	});

	const docs = await chunkedAll(
		source.getPages().map(async (page) => {
			if (!("getText" in page.data)) {
				return null;
			}

			return {
				title: page.data.title,
				description: page.data.description,
				url: page.url,
				content: await page.data.getText("processed"),
			} as CustomDocument;
		}),
	);

	for (const doc of docs) {
		if (doc) {
			search.add(doc);
		}
	}

	return search;
}

async function chunkedAll<O>(promises: Promise<O>[]): Promise<O[]> {
	const SIZE = 50;
	const out: O[] = [];
	for (let i = 0; i < promises.length; i += SIZE) {
		out.push(...(await Promise.all(promises.slice(i, i + SIZE))));
	}
	return out;
}

const systemPrompt = [
	"You are the LLM Gateway documentation assistant. You only answer questions about LLM Gateway — the unified API gateway for multiple LLM providers — and its products.",
	"Use the `search` tool to retrieve relevant docs context before answering. The tool returns raw JSON results from the documentation; ground your answer in those results.",
	"Cite sources as markdown links using the document `url` field when available.",
	"Be concise and helpful. If the question is not related to LLM Gateway, politely decline and suggest asking about LLM Gateway instead.",
	"If you cannot find the answer in the search results, say you do not know and point the user to https://docs.llmgateway.io or contact@llmgateway.io.",
].join("\n");

export type SearchTool = typeof searchTool;

const searchTool = tool({
	description:
		"Search the LLM Gateway docs content and return raw JSON results.",
	inputSchema: z.object({
		query: z.string(),
		limit: z.number().int().min(1).max(100).default(10),
	}),
	async execute({ query, limit }: { query: string; limit: number }) {
		const search = await searchServer;
		return await search.searchAsync(query, {
			limit,
			merge: true,
			enrich: true,
		});
	},
});

export async function POST(req: Request) {
	const apiKey = process.env.DOCS_AI_SUPPORT_CHAT_API_KEY;
	if (!apiKey) {
		return Response.json(
			{ error: "Ask AI is not configured" },
			{ status: 503 },
		);
	}

	const llmgateway = createLLMGateway({
		apiKey,
		baseURL: process.env.GATEWAY_URL ?? "https://api.llmgateway.io/v1",
		headers: {
			"x-source": "docs-ask-ai",
		},
	});

	const reqJson = (await req.json()) as { messages?: ChatUIMessage[] };

	const result = streamText({
		model: llmgateway.chat("auto"),
		stopWhen: stepCountIs(5),
		tools: {
			search: searchTool,
		},
		messages: [
			{ role: "system", content: systemPrompt },
			...(await convertToModelMessages<ChatUIMessage>(reqJson.messages ?? [], {
				convertDataPart(part) {
					if (part.type === "data-client") {
						return {
							type: "text",
							text: `[Client Context: ${JSON.stringify(part.data)}]`,
						};
					}
					return undefined;
				},
			})),
		],
		toolChoice: "auto",
	});

	return result.toUIMessageStreamResponse();
}
