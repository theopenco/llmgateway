import { executeStreamingRequest } from "./stream.js";

import type {
	BenchmarkAgentSpec,
	BenchmarkAgentStopReason,
	BenchmarkAgentToolInvocation,
	BenchmarkAgentTurn,
	BenchmarkClientOptions,
	BenchmarkEvaluation,
	BenchmarkMessage,
	BenchmarkRequest,
	BenchmarkResponse,
	BenchmarkRunContext,
	BenchmarkTiming,
	BenchmarkUsage,
} from "./types.js";

export interface ExecuteAgentRequestOptions {
	client: BenchmarkClientOptions;
	request: BenchmarkRequest;
	model: string;
	timeoutMs: number;
	fetch: typeof fetch;
	agent: BenchmarkAgentSpec;
	context: BenchmarkRunContext;
}

export interface AgentRunOutcome {
	response: BenchmarkResponse;
	evaluation: BenchmarkEvaluation | null;
}

function sum(values: Array<number | null>): number | null {
	const present = values.filter((value): value is number => value !== null);
	return present.length === 0
		? null
		: present.reduce((total, value) => total + value, 0);
}

function aggregateUsage(turns: BenchmarkAgentTurn[]): BenchmarkUsage {
	const promptTokens = sum(turns.map((turn) => turn.usage.promptTokens));
	const completionTokens = sum(
		turns.map((turn) => turn.usage.completionTokens),
	);
	const reasoningTokens = sum(turns.map((turn) => turn.usage.reasoningTokens));
	return {
		promptTokens,
		completionTokens,
		reasoningTokens,
		visibleCompletionTokens:
			completionTokens === null
				? null
				: Math.max(0, completionTokens - (reasoningTokens ?? 0)),
		raw: null,
	};
}

function aggregateTiming(
	turns: BenchmarkAgentTurn[],
	wallClockMs: number,
	usage: BenchmarkUsage,
): BenchmarkTiming {
	const first = turns[0]?.timing;
	const generationMs = sum(turns.map((turn) => turn.timing.generationMs));
	const stalls = turns
		.map((turn) => turn.timing.maxContentStallMs)
		.filter((value): value is number => value !== null);
	const contentChunkCount = turns.reduce(
		(total, turn) => total + turn.timing.contentChunkCount,
		0,
	);
	return {
		headersMs: first?.headersMs ?? null,
		firstEventMs: first?.firstEventMs ?? null,
		firstReasoningMs: first?.firstReasoningMs ?? null,
		firstContentMs: first?.firstContentMs ?? null,
		lastContentMs: null,
		generationMs,
		totalMs: wallClockMs,
		visibleTokensPerSecond:
			generationMs && usage.visibleCompletionTokens !== null
				? Math.max(0, usage.visibleCompletionTokens - 1) / (generationMs / 1000)
				: null,
		contentChunkCount,
		averageContentChunkCharacters: null,
		maxContentStallMs: stalls.length === 0 ? null : Math.max(...stalls),
		finalContentBurstRatio: null,
		buffered: null,
	};
}

/**
 * Drives a full tool-calling conversation against one target: every assistant
 * turn that requests tools gets those tools executed locally and fed back, until
 * the model answers without tools, an upstream call fails, or `maxTurns` is hit.
 */
export async function executeAgentRequest({
	client,
	request,
	model,
	timeoutMs,
	fetch: fetchImplementation,
	agent,
	context,
}: ExecuteAgentRequestOptions): Promise<AgentRunOutcome> {
	const session = agent.createSession(context);
	const messages: BenchmarkMessage[] = [...request.messages];
	const turns: BenchmarkAgentTurn[] = [];
	const invocations: BenchmarkAgentToolInvocation[] = [];
	const toolCallsByName: Record<string, number> = {};
	const seenCalls = new Set<string>();
	let invalidToolCallCount = 0;
	let repeatedToolCallCount = 0;
	let stopReason: BenchmarkAgentStopReason = "max_turns";
	let last: BenchmarkResponse | null = null;
	const started = performance.now();

	for (let turn = 1; turn <= agent.maxTurns; turn += 1) {
		const response = await executeStreamingRequest({
			client,
			request: { ...request, messages, tools: session.tools },
			model,
			timeoutMs,
			fetch: fetchImplementation,
		});
		last = response;
		turns.push({
			turn,
			toolCallCount: response.toolCalls.length,
			finishReason: response.finishReason,
			timing: response.timing,
			usage: response.usage,
			error: response.error,
		});
		if (response.error) {
			stopReason = "error";
			break;
		}
		if (response.toolCalls.length === 0) {
			stopReason = "no_tool_calls";
			break;
		}
		messages.push({
			role: "assistant",
			content: response.content,
			toolCalls: response.toolCalls,
		});
		for (const call of response.toolCalls) {
			const name = call.function.name;
			toolCallsByName[name] = (toolCallsByName[name] ?? 0) + 1;
			const signature = `${name}:${call.function.arguments}`;
			if (seenCalls.has(signature)) {
				repeatedToolCallCount += 1;
			}
			seenCalls.add(signature);
			const invokedAt = performance.now();
			const result = session.callTool(call);
			if (result.isError) {
				invalidToolCallCount += 1;
			}
			invocations.push({
				turn,
				name,
				arguments: call.function.arguments,
				ok: !result.isError,
				...(result.isError ? { detail: result.content.slice(0, 200) } : {}),
				durationMs: performance.now() - invokedAt,
			});
			messages.push({
				role: "tool",
				content: result.content,
				toolCallId: call.id,
				name,
			});
		}
	}

	const wallClockMs = performance.now() - started;
	const usage = aggregateUsage(turns);
	const response: BenchmarkResponse = {
		content: last?.content ?? "",
		reasoning: last?.reasoning ?? "",
		toolCalls: last?.toolCalls ?? [],
		finishReason: last?.finishReason ?? null,
		responseModel: last?.responseModel ?? null,
		requestId: last?.requestId ?? null,
		usage,
		timing: aggregateTiming(turns, wallClockMs, usage),
		streamChunks: last?.streamChunks ?? [],
		error: last?.error ?? null,
		agent: {
			turnCount: turns.length,
			toolCallCount: invocations.length,
			invalidToolCallCount,
			repeatedToolCallCount,
			toolCallsByName,
			stopReason,
			turns,
			invocations,
		},
	};
	return {
		response,
		evaluation: response.error ? null : session.evaluate(response),
	};
}
