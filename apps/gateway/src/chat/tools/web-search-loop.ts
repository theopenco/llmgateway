import { randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";

import { app } from "@/app.js";
import {
	hasInternalClientCacheMarkers,
	internalApiOriginHeaders,
	isInternalApiOrigin,
} from "@/lib/api-origin.js";
import { internalPrincipalHeaders } from "@/lib/internal-principal-headers.js";

import { logger } from "@llmgateway/logger";
import { ONBOARDING_SPONSOR_HEADER } from "@llmgateway/shared";

import { forwardedCustomHeaders } from "./extract-custom-headers.js";
import {
	formatSearchToolResult,
	webSearchAnnotations,
	type InternalWebSearch,
	type InternalWebSearchResult,
} from "./internal-web-search.js";

import type { ApiOrigin } from "@llmgateway/db";
import type { GatewayWebSearchEngine } from "@llmgateway/models";
import type { Context } from "hono";

/**
 * Gateway-run web search that behaves like native search: the serving model
 * gets a `web_search` function, decides whether and what to search, sees the
 * results as tool results, may search again, and then answers. Each model
 * call is an internal `/v1/chat/completions` request pinned to the serving
 * mapping, so it is routed, logged and billed like any other request; the
 * searches run here between them.
 */

export const WEB_SEARCH_FUNCTION_NAME = "web_search";
/** Internal hop header carrying the key of the searches the round bills. */
export const WEB_SEARCH_LOOP_HEADER = "x-gateway-web-search-loop";
const DEFAULT_MAX_SEARCHES = 5;
const REQUIRED_SEARCH_FAILED = {
	error: {
		message:
			"Web search is required by tool_choice, but the search engine is unavailable. Please retry.",
		type: "upstream_error",
		param: null,
		code: "web_search_unavailable",
	},
};
const MAX_ROUNDS = 6;

const WEB_SEARCH_FUNCTION = {
	type: "function",
	function: {
		name: WEB_SEARCH_FUNCTION_NAME,
		description:
			"Search the web. Use it whenever the answer depends on current events, recent releases, prices, or other facts you may not know or that may have changed. Write a short keyword query, not a sentence. Call it again with a refined query when the results are not enough; answer once you have what you need.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "The search query." },
			},
			required: ["query"],
		},
	},
} as const;

export interface WebSearchLoopBilling {
	engine: GatewayWebSearchEngine;
	price: string;
	queries: string[];
	count: number;
}

/** What a follow-up round needs to know about the loop it belongs to. */
export interface WebSearchLoopRound {
	/** A round after a search: the first round already ran the request's checks on the caller's messages. */
	followUp: boolean;
	/** Searches run since the previous round, billed on this one. */
	billing?: WebSearchLoopBilling;
}

/**
 * Follow-up rounds, keyed by a random id so a caller cannot attach billing to
 * its own request or skip its checks. Entries are taken once; the sweep only
 * clears keys a cancelled dispatch never delivered.
 */
const pendingRounds = new Map<
	string,
	{ round: WebSearchLoopRound; createdAt: number }
>();
const PENDING_ROUND_TTL_MS = 10 * 60 * 1000;

function registerRound(round: WebSearchLoopRound): string {
	const now = Date.now();
	for (const [key, entry] of pendingRounds) {
		if (now - entry.createdAt > PENDING_ROUND_TTL_MS) {
			pendingRounds.delete(key);
		}
	}
	const key = randomUUID();
	pendingRounds.set(key, { round, createdAt: now });
	return key;
}

/** The loop context of a round, read once by the round's handler. */
export function takeWebSearchLoopRound(
	key: string | undefined,
): WebSearchLoopRound | undefined {
	if (!key) {
		return undefined;
	}
	const entry = pendingRounds.get(key);
	pendingRounds.delete(key);
	return entry?.round;
}

interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

type ChatMessage = Record<string, unknown>;
type Json = Record<string, any>;

export interface WebSearchLoopOptions {
	/** The caller's request body, web search fields removed. */
	body: Json;
	/**
	 * The mapping routing chose. Rounds stay on the provider that served the
	 * previous one, so a conversation's reasoning and tool calls replay where
	 * they were produced.
	 */
	pin: { provider: string; model: string; region?: string };
	stream: boolean;
	/** `tool_choice: {type: "web_search"}`: the first round must search. */
	forced: boolean;
	/** Whether the mapping accepts a named function `tool_choice`. */
	canForceFunction: boolean;
	maxSearches?: number;
	engine: GatewayWebSearchEngine;
	price: string;
	requestId: string;
	/** Sends one round through the gateway. */
	dispatch: (body: Json, headers: Record<string, string>) => Promise<Response>;
	search: (query: string) => Promise<InternalWebSearch | null>;
	/** Opens the SSE response for a streaming caller. */
	streamResponse: (
		pipe: (write: (data: string) => Promise<void>) => Promise<void>,
	) => Response | Promise<Response>;
}

const PASSED_HEADERS = [
	ONBOARDING_SPONSOR_HEADER,
	"Authorization",
	"x-api-key",
	"User-Agent",
	"x-source",
	"HTTP-Referer",
	"x-debug",
	"x-session-id",
	"x-session-affinity",
	"session_id",
	"session-id",
	"x-no-fallback",
	"x-no-cache",
];

/**
 * Sends rounds through `/v1/chat/completions` as the caller, so auth, limits,
 * routing, logging and billing apply to each model call as they would to the
 * caller's own request.
 */
export function gatewayRoundDispatcher(
	c: Context,
	apiOrigin: ApiOrigin,
	requestId: string,
): WebSearchLoopOptions["dispatch"] {
	let round = 0;
	return async (body, extraHeaders) => {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"x-request-id": `${requestId}-ws${round++}`,
			...internalApiOriginHeaders(apiOrigin, {
				hasClientCacheMarkers: hasInternalClientCacheMarkers(c),
			}),
			...internalPrincipalHeaders(c.req.raw.headers),
			...forwardedCustomHeaders(c.req.raw.headers),
			...extraHeaders,
		};
		for (const name of PASSED_HEADERS) {
			const value = c.req.header(name);
			if (value !== undefined) {
				headers[name] = value;
			}
		}
		const thinkingType = c.req.header("x-llmgateway-thinking-type");
		if (thinkingType && isInternalApiOrigin(c)) {
			headers["x-llmgateway-thinking-type"] = thinkingType;
		}
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: c.req.raw.signal,
		});
	};
}

function userTools(body: Json): Json[] {
	return Array.isArray(body.tools) ? body.tools : [];
}

/** The caller's tool_choice for a round, with the search function offered or not. */
function roundToolChoice(
	body: Json,
	offerSearch: boolean,
	forceSearch: boolean,
): unknown {
	if (forceSearch) {
		return {
			type: "function",
			function: { name: WEB_SEARCH_FUNCTION_NAME },
		};
	}
	const choice = body.tool_choice;
	if (!offerSearch && userTools(body).length === 0) {
		return undefined;
	}
	return choice;
}

function buildRound(
	options: WebSearchLoopOptions,
	provider: string,
	history: ChatMessage[],
	offerSearch: boolean,
	forceSearch: boolean,
): Json {
	const tools = offerSearch
		? [...userTools(options.body), WEB_SEARCH_FUNCTION]
		: userTools(options.body);
	const { model, region } = options.pin;
	const round: Json = {
		...options.body,
		model: `${provider}/${model}${region ? `:${region}` : ""}`,
		messages: [...(options.body.messages as ChatMessage[]), ...history],
		stream: options.stream,
		tools: tools.length > 0 ? tools : undefined,
		tool_choice: roundToolChoice(options.body, offerSearch, forceSearch),
	};
	if (options.stream) {
		round.stream_options = {
			...(options.body.stream_options as Json | undefined),
			include_usage: true,
		};
	}
	if (round.tools === undefined) {
		delete round.tools;
		delete round.parallel_tool_calls;
	}
	if (round.tool_choice === undefined) {
		delete round.tool_choice;
	}
	return round;
}

function parseQuery(call: ToolCall): string | null {
	try {
		const args = JSON.parse(call.function.arguments || "{}") as {
			query?: unknown;
		};
		const query =
			typeof args.query === "string" ? args.query.replace(/\s+/g, " ") : "";
		return query.trim() ? query.trim().slice(0, 400) : null;
	} catch {
		return null;
	}
}

/** Sums the numeric fields of two usage objects, recursively. */
export function sumUsage(a: unknown, b: unknown): unknown {
	if (typeof a === "number" && typeof b === "number") {
		return new Decimal(a).plus(b).toNumber();
	}
	if (
		a &&
		b &&
		typeof a === "object" &&
		typeof b === "object" &&
		!Array.isArray(a) &&
		!Array.isArray(b)
	) {
		const out: Json = { ...(a as Json) };
		for (const [key, value] of Object.entries(b as Json)) {
			out[key] = key in out ? sumUsage(out[key], value) : value;
		}
		return out;
	}
	return b ?? a;
}

class LoopState {
	public history: ChatMessage[] = [];
	public searches: InternalWebSearch[] = [];
	public queries: string[] = [];
	public searchCount = 0;
	public usage: unknown = undefined;
	public provider: string;
	private roundKey: string | undefined;

	public constructor(private readonly options: WebSearchLoopOptions) {
		this.provider = options.pin.provider;
	}

	public get maxSearches(): number {
		return this.options.maxSearches ?? DEFAULT_MAX_SEARCHES;
	}

	/** Runs the round's search calls and records the exchange for the next round. */
	public async runSearches(
		assistant: ChatMessage,
		calls: ToolCall[],
	): Promise<void> {
		const queries = calls.map(parseQuery);
		const results = await Promise.all(
			queries.map((query, i) => {
				if (!query) {
					return Promise.resolve(null);
				}
				if (this.searchCount + i >= this.maxSearches) {
					return Promise.resolve(null);
				}
				return this.options.search(query);
			}),
		);
		this.history.push(assistant);
		const billed: string[] = [];
		calls.forEach((call, i) => {
			const query = queries[i];
			const search = results[i];
			let content: string;
			if (!query) {
				content = "Invalid arguments: pass a non-empty query string.";
			} else if (this.searchCount + i >= this.maxSearches) {
				content = "Search limit reached. Answer with the results you have.";
			} else {
				content = formatSearchToolResult(search);
			}
			if (query && search) {
				this.searches.push(search);
				billed.push(query);
			}
			this.history.push({ role: "tool", tool_call_id: call.id, content });
		});
		this.searchCount += calls.length;
		this.queries.push(...billed);
		this.roundKey = registerRound({
			followUp: true,
			...(billed.length > 0 && {
				billing: {
					engine: this.options.engine,
					price: this.options.price,
					queries: billed,
					count: billed.length,
				},
			}),
		});
	}

	/** Registers the first round, which carries no searches yet. */
	public startFirstRound(): void {
		this.roundKey = registerRound({ followUp: false });
	}

	/** Follows the provider that served the last round. */
	public noteProvider(provider: unknown): void {
		if (typeof provider === "string" && provider) {
			this.provider = provider;
		}
	}

	/** Sends the next round with its loop context, which it takes on arrival. */
	public async dispatchNext(body: Json): Promise<Response> {
		const key = this.roundKey;
		this.roundKey = undefined;
		try {
			return await this.options.dispatch(
				body,
				key ? { [WEB_SEARCH_LOOP_HEADER]: key } : {},
			);
		} finally {
			if (key) {
				pendingRounds.delete(key);
			}
		}
	}

	/**
	 * `tool_choice: {type: "web_search"}` demands a search: when every search of
	 * the forced first round failed, answering would hide that none ran.
	 */
	public requiredSearchFailed(round: number): boolean {
		return round === 0 && this.options.forced && this.searches.length === 0;
	}

	public canSearchAgain(round: number): boolean {
		return this.searchCount < this.maxSearches && round + 1 < MAX_ROUNDS;
	}

	private annotatedUrls = new Set<string>();

	/** Citations for results not yet cited, so each source is cited once. */
	public newAnnotations() {
		const results: InternalWebSearchResult[] = [];
		for (const search of this.searches) {
			for (const result of search.results) {
				if (!this.annotatedUrls.has(result.url)) {
					this.annotatedUrls.add(result.url);
					results.push(result);
				}
			}
		}
		return results.length > 0
			? webSearchAnnotations({
					engine: this.options.engine,
					queries: this.queries,
					results,
					engineCostUsd: null,
				})
			: [];
	}
}

function splitCalls(toolCalls: ToolCall[] | undefined): {
	search: ToolCall[];
	other: ToolCall[];
} {
	const calls = toolCalls ?? [];
	return {
		search: calls.filter((c) => c.function?.name === WEB_SEARCH_FUNCTION_NAME),
		other: calls.filter((c) => c.function?.name !== WEB_SEARCH_FUNCTION_NAME),
	};
}

/** The assistant turn replayed to the next round: text, reasoning, search calls. */
function replayMessage(message: Json, searchCalls: ToolCall[]): ChatMessage {
	return {
		role: "assistant",
		content: typeof message.content === "string" ? message.content : "",
		tool_calls: searchCalls,
		...(Array.isArray(message.reasoning_details) &&
		message.reasoning_details.length > 0
			? { reasoning_details: message.reasoning_details }
			: {}),
	};
}

function forwardHeaders(res: Response): Headers {
	const headers = new Headers(res.headers);
	headers.delete("content-length");
	headers.delete("content-encoding");
	return headers;
}

async function runNonStreaming(
	options: WebSearchLoopOptions,
	state: LoopState,
	first: Response,
): Promise<Response> {
	let res = first;
	for (let round = 0; ; round++) {
		if (!res.ok) {
			return res;
		}
		const json = (await res.json()) as Json;
		state.usage = sumUsage(state.usage, json.usage);
		state.noteProvider(json.metadata?.used_provider);
		const message: Json = json.choices?.[0]?.message ?? {};
		const { search, other } = splitCalls(message.tool_calls);
		const offered = round === 0 || state.canSearchAgain(round - 1);
		if (search.length > 0 && other.length === 0 && offered) {
			await state.runSearches(replayMessage(message, search), search);
			if (state.requiredSearchFailed(round)) {
				return Response.json(REQUIRED_SEARCH_FAILED, { status: 503 });
			}
			res = await state.dispatchNext(
				buildRound(
					options,
					state.provider,
					state.history,
					state.canSearchAgain(round),
					false,
				),
			);
			continue;
		}
		if (search.length > 0) {
			message.tool_calls = other.length > 0 ? other : undefined;
			if (!message.tool_calls) {
				delete message.tool_calls;
			}
		}
		const annotations = state.newAnnotations();
		if (annotations.length > 0) {
			message.annotations = [...annotations, ...(message.annotations ?? [])];
		}
		if (state.usage !== undefined) {
			json.usage = state.usage;
		}
		return new Response(JSON.stringify(json), {
			status: res.status,
			headers: forwardHeaders(res),
		});
	}
}

interface StreamedRound {
	usedProvider?: string;
	content: string;
	reasoningDetails: unknown[];
	calls: Map<number, ToolCall>;
	/** Chunks held back until the round is known to be the last. */
	held: Json[];
	error: boolean;
	done: boolean;
}

/**
 * Streamed reasoning arrives in pieces that share a type and index; the next
 * round replays them as whole entries, like a non-streamed message.
 */
export function mergeReasoningDetail(details: Json[], detail: Json): void {
	const existing =
		typeof detail.index === "number"
			? details.find((d) => d.type === detail.type && d.index === detail.index)
			: undefined;
	if (!existing) {
		details.push({ ...detail });
		return;
	}
	for (const [key, value] of Object.entries(detail)) {
		if (
			(key === "text" || key === "summary") &&
			typeof value === "string" &&
			typeof existing[key] === "string"
		) {
			existing[key] += value;
		} else if (value !== undefined && value !== null && value !== "") {
			existing[key] = value;
		}
	}
}

async function* sseEvents(body: ReadableStream<Uint8Array>) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		buffer += decoder.decode(value, { stream: !done });
		let boundary = buffer.search(/\r?\n\r?\n/);
		while (boundary !== -1) {
			const event = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
			const data = event
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (data) {
				yield data;
			}
			boundary = buffer.search(/\r?\n\r?\n/);
		}
		if (done) {
			const data = buffer
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (data) {
				yield data;
			}
			return;
		}
	}
}

/**
 * Pipes one round to the caller as it arrives: text and reasoning go out
 * live, search call deltas are kept back, and the caller's own tool call
 * deltas are renumbered past them. The finish and usage chunks are held
 * until the loop knows whether another round follows.
 */
async function pipeRound(
	res: Response,
	write: (data: string) => Promise<void>,
): Promise<StreamedRound> {
	const round: StreamedRound = {
		content: "",
		reasoningDetails: [],
		calls: new Map(),
		held: [],
		error: false,
		done: false,
	};
	const kinds = new Map<number, "search" | "other">();
	const forwardedIndex = new Map<number, number>();
	if (!res.body) {
		return round;
	}
	for await (const data of sseEvents(res.body)) {
		if (data === "[DONE]") {
			round.done = true;
			continue;
		}
		let chunk: Json;
		try {
			chunk = JSON.parse(data) as Json;
		} catch {
			await write(data);
			continue;
		}
		if (chunk.error) {
			round.error = true;
			await write(data);
			continue;
		}
		if (typeof chunk.metadata?.used_provider === "string") {
			round.usedProvider = chunk.metadata.used_provider;
		}
		const choice = chunk.choices?.[0];
		const delta: Json | undefined = choice?.delta;
		if (delta) {
			if (typeof delta.content === "string") {
				round.content += delta.content;
			}
			if (Array.isArray(delta.reasoning_details)) {
				for (const detail of delta.reasoning_details as Json[]) {
					mergeReasoningDetail(round.reasoningDetails as Json[], detail);
				}
			}
			if (Array.isArray(delta.tool_calls)) {
				const kept: Json[] = [];
				for (const tc of delta.tool_calls as Json[]) {
					const index = typeof tc.index === "number" ? tc.index : 0;
					const existing = round.calls.get(index);
					const name: string | undefined = tc.function?.name;
					if (!existing) {
						round.calls.set(index, {
							id: tc.id ?? `call_${index}`,
							type: "function",
							function: { name: name ?? "", arguments: "" },
						});
					}
					const call = round.calls.get(index)!;
					if (tc.id) {
						call.id = tc.id;
					}
					if (name) {
						call.function.name = name;
						kinds.set(
							index,
							name === WEB_SEARCH_FUNCTION_NAME ? "search" : "other",
						);
					}
					if (typeof tc.function?.arguments === "string") {
						call.function.arguments += tc.function.arguments;
					}
					if (kinds.get(index) === "other") {
						if (!forwardedIndex.has(index)) {
							forwardedIndex.set(index, forwardedIndex.size);
						}
						kept.push({ ...tc, index: forwardedIndex.get(index) });
					}
				}
				if (kept.length > 0) {
					delta.tool_calls = kept;
				} else {
					delete delta.tool_calls;
				}
			}
		}
		if (choice?.finish_reason || chunk.usage) {
			// Text riding on the closing chunk goes out now; only the close waits.
			if (
				delta &&
				Object.keys(delta).some((key) => key !== "role" && key !== "tool_calls")
			) {
				const { tool_calls: toolCalls, ...live } = delta;
				await write(
					JSON.stringify({
						...chunk,
						usage: undefined,
						metadata: undefined,
						choices: [{ ...choice, delta: live, finish_reason: null }],
					}),
				);
				choice.delta = toolCalls ? { tool_calls: toolCalls } : {};
			}
			round.held.push(chunk);
			continue;
		}
		const hasPayload =
			!delta ||
			Object.keys(delta).some((key) => key !== "role") ||
			chunk.metadata !== undefined;
		if (hasPayload) {
			await write(JSON.stringify(chunk));
		}
	}
	return round;
}

async function runStreaming(
	options: WebSearchLoopOptions,
	state: LoopState,
	first: Response,
): Promise<Response> {
	return await options.streamResponse(async (write) => {
		let res = first;
		for (let round = 0; ; round++) {
			if (!res.ok) {
				const text = await res.text();
				let error: unknown;
				try {
					error = (JSON.parse(text) as Json).error ?? JSON.parse(text);
				} catch {
					error = { message: text, type: "upstream_error" };
				}
				await write(JSON.stringify({ error }));
				await write("[DONE]");
				return;
			}
			const streamed = await pipeRound(res, write);
			// A round can report usage twice (finish chunk, then the costed
			// one); the last report is the round's total.
			const roundUsage = [...streamed.held]
				.reverse()
				.find((chunk) => chunk.usage)?.usage;
			if (roundUsage) {
				state.usage = sumUsage(state.usage, roundUsage);
			}
			state.noteProvider(streamed.usedProvider);
			const calls = [...streamed.calls.values()];
			const { search, other } = splitCalls(calls);
			const offered = round === 0 || state.canSearchAgain(round - 1);
			if (
				!streamed.error &&
				search.length > 0 &&
				other.length === 0 &&
				offered
			) {
				await state.runSearches(
					replayMessage(
						{
							content: streamed.content,
							reasoning_details: streamed.reasoningDetails,
						},
						search,
					),
					search,
				);
				// Sources go out when the search returns, before the text that
				// cites them, where native search puts them.
				const annotations = state.newAnnotations();
				if (annotations.length > 0) {
					const template = streamed.held[0] ?? {};
					await write(
						JSON.stringify({
							id: template.id ?? `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created: template.created ?? Math.floor(Date.now() / 1000),
							model: template.model,
							choices: [
								{
									index: 0,
									delta: { role: "assistant", content: "", annotations },
									finish_reason: null,
								},
							],
						}),
					);
				}
				if (state.requiredSearchFailed(round)) {
					await write(JSON.stringify(REQUIRED_SEARCH_FAILED));
					await write("[DONE]");
					return;
				}
				res = await state.dispatchNext(
					buildRound(
						options,
						state.provider,
						state.history,
						state.canSearchAgain(round),
						false,
					),
				);
				continue;
			}
			let lastUsage = -1;
			streamed.held.forEach((chunk, i) => {
				if (chunk.usage) {
					lastUsage = i;
				}
			});
			for (const [i, chunk] of streamed.held.entries()) {
				const choice = chunk.choices?.[0];
				if (
					choice?.finish_reason === "tool_calls" &&
					other.length === 0 &&
					search.length > 0
				) {
					choice.finish_reason = "stop";
				}
				if (i === lastUsage && state.usage !== undefined) {
					chunk.usage = state.usage;
				}
				await write(JSON.stringify(chunk));
			}
			if (streamed.done || !streamed.error) {
				await write("[DONE]");
			}
			return;
		}
	});
}

/**
 * Runs the request with gateway-run search. Returns null when the first round
 * fails upstream before anything was sent, so the caller can answer another
 * way.
 */
export async function runWebSearchLoop(
	options: WebSearchLoopOptions,
): Promise<Response | null> {
	const state = new LoopState(options);
	const forceFirst = options.forced && options.canForceFunction;
	state.startFirstRound();
	const first = await state.dispatchNext(
		buildRound(options, state.provider, [], true, forceFirst),
	);
	// A rejected request (auth, limits, credits, bad input) is the caller's
	// answer; only an upstream failure is worth another path.
	if (first.status >= 500) {
		logger.warn("Gateway web search loop: first round failed", {
			requestId: options.requestId,
			status: first.status,
		});
		return null;
	}
	if (!first.ok) {
		return first;
	}
	return options.stream
		? await runStreaming(options, state, first)
		: await runNonStreaming(options, state, first);
}
