import type {
	BenchmarkClientOptions,
	BenchmarkError,
	BenchmarkMessageToolCall,
	BenchmarkRequest,
	BenchmarkResponse,
	BenchmarkStreamChunk,
	BenchmarkTiming,
	BenchmarkUsage,
} from "./types.js";

interface StreamToolCallDelta {
	index?: number;
	id?: string;
	type?: "function";
	function?: { name?: string; arguments?: string };
}

interface StreamDelta {
	content?: string;
	reasoning?: string;
	reasoning_content?: string;
	tool_calls?: StreamToolCallDelta[];
}

interface StreamChoice {
	delta?: StreamDelta;
	finish_reason?: string | null;
}

interface StreamChunk {
	choices?: StreamChoice[];
	error?: { code?: string; message?: string };
	model?: string;
	usage?: Record<string, unknown>;
}

export interface ExecuteStreamingRequestOptions {
	client: BenchmarkClientOptions;
	request: BenchmarkRequest;
	model: string;
	timeoutMs: number;
	fetch: typeof fetch;
}

function nestedNumber(
	value: Record<string, unknown> | null,
	key: string,
	nestedKey?: string,
): number | null {
	const direct = value?.[key];
	if (!nestedKey) {
		return typeof direct === "number" ? direct : null;
	}
	if (!direct || typeof direct !== "object" || Array.isArray(direct)) {
		return null;
	}
	const nested = (direct as Record<string, unknown>)[nestedKey];
	return typeof nested === "number" ? nested : null;
}

function createUsage(raw: Record<string, unknown> | null): BenchmarkUsage {
	const promptTokens = nestedNumber(raw, "prompt_tokens");
	const completionTokens = nestedNumber(raw, "completion_tokens");
	const reasoningTokens = nestedNumber(
		raw,
		"completion_tokens_details",
		"reasoning_tokens",
	);
	return {
		promptTokens,
		completionTokens,
		reasoningTokens,
		visibleCompletionTokens:
			completionTokens === null
				? null
				: Math.max(0, completionTokens - (reasoningTokens ?? 0)),
		raw,
	};
}

function createTiming(
	started: number,
	values: Partial<BenchmarkTiming>,
	usage: BenchmarkUsage,
	streamChunks: BenchmarkStreamChunk[],
): BenchmarkTiming {
	const totalMs = performance.now() - started;
	const contentChunks = streamChunks.filter(
		(chunk) => chunk.kind === "content",
	);
	const firstContentMs = values.firstContentMs ?? null;
	const lastContentMs = contentChunks.at(-1)?.atMs ?? null;
	const generationMs =
		firstContentMs === null ? null : Math.max(0, totalMs - firstContentMs);
	const visibleTokensPerSecond =
		generationMs && usage.visibleCompletionTokens !== null
			? Math.max(0, usage.visibleCompletionTokens - 1) / (generationMs / 1000)
			: null;
	const gaps = contentChunks.slice(1).map((chunk, index) => {
		const previous = contentChunks[index];
		return chunk.atMs - previous.atMs;
	});
	const totalCharacters = contentChunks.reduce(
		(sum, chunk) => sum + chunk.characters,
		0,
	);
	const finalWindowStart = totalMs * 0.9;
	const finalCharacters = contentChunks
		.filter((chunk) => chunk.atMs >= finalWindowStart)
		.reduce((sum, chunk) => sum + chunk.characters, 0);
	const finalContentBurstRatio =
		totalCharacters === 0 ? null : finalCharacters / totalCharacters;
	const buffered =
		contentChunks.length === 0
			? null
			: contentChunks.length === 1 ||
				(firstContentMs !== null &&
					firstContentMs >= totalMs * 0.8 &&
					(finalContentBurstRatio ?? 0) >= 0.8);
	return {
		headersMs: values.headersMs ?? null,
		firstEventMs: values.firstEventMs ?? null,
		firstReasoningMs: values.firstReasoningMs ?? null,
		firstContentMs,
		lastContentMs,
		generationMs,
		totalMs,
		visibleTokensPerSecond,
		contentChunkCount: contentChunks.length,
		averageContentChunkCharacters:
			contentChunks.length === 0
				? null
				: totalCharacters / contentChunks.length,
		maxContentStallMs: gaps.length === 0 ? null : Math.max(...gaps),
		finalContentBurstRatio,
		buffered,
	};
}

function errorResponse(
	started: number,
	error: BenchmarkError,
	timing: Partial<BenchmarkTiming> = {},
): BenchmarkResponse {
	const usage = createUsage(null);
	const streamChunks: BenchmarkStreamChunk[] = [];
	return {
		content: "",
		reasoning: "",
		toolCalls: [],
		finishReason: null,
		responseModel: null,
		requestId: null,
		usage,
		timing: createTiming(started, timing, usage, streamChunks),
		streamChunks,
		error,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function appendToolCall(
	toolCalls: Map<number, BenchmarkMessageToolCall>,
	delta: StreamToolCallDelta,
): void {
	const index = delta.index ?? 0;
	const existing = toolCalls.get(index) ?? {
		id: "",
		type: "function" as const,
		function: { name: "", arguments: "" },
	};
	toolCalls.set(index, {
		id: existing.id + (delta.id ?? ""),
		type: "function",
		function: {
			name: existing.function.name + (delta.function?.name ?? ""),
			arguments:
				existing.function.arguments + (delta.function?.arguments ?? ""),
		},
	});
}

export async function executeStreamingRequest({
	client,
	request,
	model,
	timeoutMs,
	fetch: fetchImplementation,
}: ExecuteStreamingRequestOptions): Promise<BenchmarkResponse> {
	const started = performance.now();
	let response: Response;
	try {
		response = await fetchImplementation(client.url, {
			method: "POST",
			headers: {
				...client.headers,
				...(client.apiKey ? { Authorization: `Bearer ${client.apiKey}` } : {}),
				"Content-Type": "application/json",
				...(client.disableCache === false ? {} : { "x-no-cache": "true" }),
				...(client.disableFallback === false
					? {}
					: { "x-no-fallback": "true" }),
			},
			body: JSON.stringify({
				...request.parameters,
				model,
				messages: request.messages.map((message) => ({
					role: message.role,
					content: message.content,
					...(message.name ? { name: message.name } : {}),
					...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
					...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
				})),
				stream: true,
				stream_options: { include_usage: true },
				...(request.tools ? { tools: request.tools } : {}),
				...(request.toolChoice === undefined
					? {}
					: { tool_choice: request.toolChoice }),
				...(request.maxTokens === undefined
					? {}
					: { max_tokens: request.maxTokens }),
				...(request.reasoningEffort === undefined
					? {}
					: { reasoning_effort: request.reasoningEffort }),
				...(request.temperature === undefined
					? {}
					: { temperature: request.temperature }),
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		return errorResponse(started, {
			code: error instanceof DOMException ? error.name : "request_error",
			message: errorMessage(error),
		});
	}

	const headersMs = performance.now() - started;
	if (!response.ok || !response.body) {
		const body = await response.text().catch(() => "");
		return errorResponse(
			started,
			{
				code: `http_${response.status}`,
				message: body.replace(/\s+/g, " ").trim().slice(0, 500),
				status: response.status,
			},
			{ headersMs },
		);
	}

	let firstEventMs: number | null = null;
	let firstReasoningMs: number | null = null;
	let firstContentMs: number | null = null;
	let content = "";
	let reasoning = "";
	let finishReason: string | null = null;
	let responseModel: string | null = null;
	let usageRaw: Record<string, unknown> | null = null;
	let streamError: BenchmarkError | null = null;
	const toolCallParts = new Map<number, BenchmarkMessageToolCall>();
	const streamChunks: BenchmarkStreamChunk[] = [];
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const consumeLine = (line: string): void => {
		if (streamError || !line.startsWith("data:")) {
			return;
		}
		const data = line.slice(5).trim();
		if (!data || data === "[DONE]") {
			return;
		}
		const atMs = performance.now() - started;
		firstEventMs ??= atMs;
		let chunk: StreamChunk;
		try {
			chunk = JSON.parse(data) as StreamChunk;
		} catch {
			streamError = {
				code: "invalid_stream_json",
				message: data.slice(0, 500),
			};
			return;
		}
		if (chunk.error) {
			streamError = {
				code: chunk.error.code ?? "upstream_stream_error",
				message: chunk.error.message ?? JSON.stringify(chunk.error),
			};
			return;
		}
		responseModel ??= chunk.model ?? null;
		usageRaw = chunk.usage ?? usageRaw;
		const choice = chunk.choices?.[0];
		if (!choice) {
			return;
		}
		finishReason = choice.finish_reason ?? finishReason;
		for (const toolCall of choice.delta?.tool_calls ?? []) {
			appendToolCall(toolCallParts, toolCall);
		}
		const reasoningDelta =
			choice.delta?.reasoning_content ?? choice.delta?.reasoning ?? "";
		const contentDelta = choice.delta?.content ?? "";
		if (reasoningDelta) {
			firstReasoningMs ??= atMs;
			reasoning += reasoningDelta;
			streamChunks.push({
				atMs,
				characters: reasoningDelta.length,
				kind: "reasoning",
			});
		}
		if (contentDelta) {
			firstContentMs ??= atMs;
			content += contentDelta;
			streamChunks.push({
				atMs,
				characters: contentDelta.length,
				kind: "content",
			});
		}
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				consumeLine(line);
			}
			if (streamError) {
				await reader.cancel();
				break;
			}
		}
		buffer += decoder.decode();
		for (const line of buffer.split(/\r?\n/)) {
			consumeLine(line);
		}
	} catch (error) {
		streamError = { code: "stream_read_error", message: errorMessage(error) };
	}

	const usage = createUsage(usageRaw);
	return {
		content,
		reasoning,
		toolCalls: [...toolCallParts.entries()]
			.sort(([left], [right]) => left - right)
			.map(([, toolCall]) => toolCall),
		finishReason,
		responseModel,
		requestId: response.headers.get("x-request-id"),
		usage,
		timing: createTiming(
			started,
			{ headersMs, firstEventMs, firstReasoningMs, firstContentMs },
			usage,
			streamChunks,
		),
		streamChunks,
		error: streamError,
	};
}
