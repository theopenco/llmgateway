import type {
	BenchmarkClientOptions,
	BenchmarkError,
	BenchmarkRequest,
	BenchmarkResponse,
	BenchmarkTiming,
	BenchmarkUsage,
} from "./types.js";

interface StreamDelta {
	content?: string;
	reasoning?: string;
	reasoning_content?: string;
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
): BenchmarkTiming {
	const totalMs = performance.now() - started;
	const firstContentMs = values.firstContentMs ?? null;
	const generationMs =
		firstContentMs === null ? null : Math.max(0, totalMs - firstContentMs);
	const visibleTokensPerSecond =
		generationMs && usage.visibleCompletionTokens !== null
			? Math.max(0, usage.visibleCompletionTokens - 1) / (generationMs / 1000)
			: null;
	return {
		headersMs: values.headersMs ?? null,
		firstEventMs: values.firstEventMs ?? null,
		firstReasoningMs: values.firstReasoningMs ?? null,
		firstContentMs,
		generationMs,
		totalMs,
		visibleTokensPerSecond,
	};
}

function errorResponse(
	started: number,
	error: BenchmarkError,
	timing: Partial<BenchmarkTiming> = {},
): BenchmarkResponse {
	const usage = createUsage(null);
	return {
		content: "",
		reasoning: "",
		finishReason: null,
		responseModel: null,
		requestId: null,
		usage,
		timing: createTiming(started, timing, usage),
		error,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
				messages: request.messages,
				stream: true,
				stream_options: { include_usage: true },
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
		firstEventMs ??= performance.now() - started;
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
		const reasoningDelta =
			choice.delta?.reasoning_content ?? choice.delta?.reasoning ?? "";
		const contentDelta = choice.delta?.content ?? "";
		if (reasoningDelta) {
			firstReasoningMs ??= performance.now() - started;
			reasoning += reasoningDelta;
		}
		if (contentDelta) {
			firstContentMs ??= performance.now() - started;
			content += contentDelta;
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
		streamError = {
			code: "stream_read_error",
			message: errorMessage(error),
		};
	}

	const usage = createUsage(usageRaw);
	return {
		content,
		reasoning,
		finishReason,
		responseModel,
		requestId: response.headers.get("x-request-id"),
		usage,
		timing: createTiming(
			started,
			{
				headersMs,
				firstEventMs,
				firstReasoningMs,
				firstContentMs,
			},
			usage,
		),
		error: streamError,
	};
}
