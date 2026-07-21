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

// Ask AI is public, anonymous and spends LLM credits on every call, so it
// gets per-IP limits plus a global circuit breaker (per-IP buckets alone are
// defeated by rotating addresses). The docs app has no Redis and the
// standalone Next server runs as a single instance, so an in-memory sliding
// window is sufficient.
const BURST_LIMIT_MAX = 3;
const BURST_LIMIT_WINDOW_MS = 20_000;
const HOURLY_LIMIT_MAX = 30;
const HOURLY_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_HOURLY_LIMIT_MAX = 300;
const MAX_MESSAGES = 50;

// Hard cap on tracked buckets so an attacker rotating IPs can't grow the map
// with the attack rate: the least-recently-used bucket is evicted as soon as
// the cap is exceeded (an evicted bucket simply starts fresh). Each check
// re-inserts its key, so insertion order doubles as recency order.
const MAX_TRACKED_KEYS = 10_000;
const rateLimitHits = new Map<string, number[]>();

function isAllowed(key: string, max: number, windowMs: number): boolean {
	const now = Date.now();
	const hits = (rateLimitHits.get(key) ?? []).filter((t) => now - t < windowMs);
	rateLimitHits.delete(key);
	rateLimitHits.set(key, hits);
	if (hits.length >= max) {
		return false;
	}
	hits.push(now);
	while (rateLimitHits.size > MAX_TRACKED_KEYS) {
		const oldest = rateLimitHits.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		rateLimitHits.delete(oldest);
	}
	return true;
}

// The global bucket lives outside the evictable map so key churn can never
// push it out. Timestamps are appended in order, so expiry trims the front.
const globalHits: number[] = [];

function isGlobalAllowed(max: number, windowMs: number): boolean {
	const now = Date.now();
	let first = globalHits[0];
	while (first !== undefined && now - first >= windowMs) {
		globalHits.shift();
		first = globalHits[0];
	}
	if (globalHits.length >= max) {
		return false;
	}
	globalHits.push(now);
	return true;
}

function extractClientIP(req: Request): string {
	return (
		req.headers.get("cf-connecting-ip") ??
		req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		req.headers.get("x-real-ip") ??
		"unknown"
	);
}

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

	// Narrower windows first so a blocked request doesn't consume the wider
	// quotas; the global bucket last so per-IP rejections don't eat into it.
	const ip = extractClientIP(req);
	if (!isAllowed(`burst:${ip}`, BURST_LIMIT_MAX, BURST_LIMIT_WINDOW_MS)) {
		return Response.json(
			{
				error:
					"You're sending messages too quickly. Please wait a few seconds and try again.",
			},
			{ status: 429 },
		);
	}
	if (!isAllowed(`hour:${ip}`, HOURLY_LIMIT_MAX, HOURLY_LIMIT_WINDOW_MS)) {
		return Response.json(
			{ error: "Too many messages. Please try again later." },
			{ status: 429 },
		);
	}
	if (!isGlobalAllowed(GLOBAL_HOURLY_LIMIT_MAX, HOURLY_LIMIT_WINDOW_MS)) {
		return Response.json(
			{
				error:
					"Ask AI is experiencing unusually high volume. Please try again later.",
			},
			{ status: 429 },
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
	if ((reqJson.messages ?? []).length > MAX_MESSAGES) {
		return Response.json(
			{ error: "Too many messages in conversation" },
			{ status: 400 },
		);
	}

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
