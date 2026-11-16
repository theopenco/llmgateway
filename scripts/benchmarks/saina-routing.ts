import type {
	BenchmarkRequest,
	BenchmarkResponse,
} from "../../packages/benchmarks/dist/types.js";

export const SAINA_ARM = "saina";
export const SAINA_QUESTION =
	"Select the cheapest option likely to achieve quality at least 0.90 on this request. If none can meet 0.90, prioritize highest quality, then lower cost. Capability scores are averages on independent tasks; prices are estimates.";

export interface SainaConfig {
	model: string;
	revision: string;
	classifierReserveUsd: string;
	candidates: {
		model: string;
		description: string;
		estimatedRequestCostUsd: string;
	}[];
}
export interface SainaDecision {
	caseId: string;
	model: string;
	revision: string;
	selectedModel: string | null;
	latencyMs: number;
	requestId: string | null;
	error: string | null;
}
export interface SainaBilling {
	caseId: string;
	cost: string;
	basis: "billed" | "estimated";
}

export function parseSainaConfig(
	value: unknown,
	fixedModels: string[],
): SainaConfig {
	const config = value as SainaConfig;
	const price = (x: unknown): x is string =>
		typeof x === "string" &&
		/^\d+(\.\d+)?$/.test(x) &&
		Number.isFinite(Number(x));
	if (
		!config ||
		typeof config.model !== "string" ||
		!config.model ||
		typeof config.revision !== "string" ||
		!/^[a-f0-9]{40}$/.test(config.revision) ||
		!price(config.classifierReserveUsd) ||
		Number(config.classifierReserveUsd) <= 0 ||
		!Array.isArray(config.candidates) ||
		config.candidates.length < 2 ||
		config.candidates.some(
			(c) =>
				!c ||
				!fixedModels.includes(c.model) ||
				typeof c.description !== "string" ||
				!c.description.trim() ||
				!price(c.estimatedRequestCostUsd),
		) ||
		new Set(config.candidates.map((c) => c.model)).size !==
			config.candidates.length
	) {
		throw new Error(
			"Invalid Saina config: pin a revision, a positive classifier reserve, and distinct fixed-arm candidates with descriptions and prices",
		);
	}
	return {
		model: config.model,
		revision: config.revision,
		classifierReserveUsd: config.classifierReserveUsd,
		candidates: config.candidates.map(
			({ model, description, estimatedRequestCostUsd }) => ({
				model,
				description,
				estimatedRequestCostUsd,
			}),
		),
	};
}

export function sainaBody(config: SainaConfig, request: BenchmarkRequest) {
	return {
		model: config.model,
		state:
			request.messages.length === 1
				? request.messages[0].content
				: request.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
		questions: {
			route: {
				type: "single_choice",
				question: SAINA_QUESTION,
				options: Object.fromEntries(
					config.candidates.map((c, i) => [
						`option_${i}`,
						`${c.description} Estimated serving price per request: USD ${c.estimatedRequestCostUsd}.`,
					]),
				),
			},
		},
	};
}

export function sainaEndpoint(base: string, path: string): string {
	const url = new URL(base);
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/" ||
		(url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
			))
	) {
		throw new Error(
			"SAINA_BASE_URL must be an HTTPS origin or a loopback HTTP origin",
		);
	}
	return new URL(path, url).href;
}

export async function verifySaina(
	config: SainaConfig,
	base: string,
	apiKey: string,
	fetcher = fetch,
): Promise<void> {
	const options = {
		headers: { Authorization: `Bearer ${apiKey}` },
		signal: AbortSignal.timeout(30000),
		redirect: "error" as const,
	};
	const response = await fetcher(sainaEndpoint(base, "/v1/models"), options);
	if (!response.ok) {
		throw new Error("Saina registry check failed");
	}
	const listing = (await response.json()) as {
		data?: { id: string; revision?: string; is_ready?: boolean }[];
	};
	const model = listing.data?.find((entry) => entry.id === config.model);
	if (!model || model.is_ready === false) {
		throw new Error("Saina model is not ready");
	}
	if (model.revision !== undefined) {
		if (model.revision !== config.revision) {
			throw new Error("Saina revision mismatch");
		}
		return;
	}
	// The standalone Saina server exposes its pinned revision through healthz.
	const health = await fetcher(sainaEndpoint(base, "/healthz"), options);
	const info = (await health.json()) as { model?: string; revision?: string };
	if (
		!health.ok ||
		info.model !== config.model ||
		info.revision !== config.revision
	) {
		throw new Error("Saina revision mismatch");
	}
}

export async function selectSaina(
	config: SainaConfig,
	request: BenchmarkRequest,
	caseId: string,
	base: string,
	apiKey: string,
	timeoutMs: number,
	fetcher = fetch,
): Promise<SainaDecision> {
	const started = performance.now();
	let requestId: string | null = null;
	let selectedModel: string | null = null;
	let error: string | null = null;
	try {
		const response = await fetcher(sainaEndpoint(base, "/v1/ask"), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(sainaBody(config, request)),
			signal: AbortSignal.timeout(timeoutMs),
			redirect: "error",
		});
		requestId = response.headers.get("x-saina-request-id");
		if (!response.ok) {
			throw new Error("saina_http_error");
		}
		const body = (await response.json()) as {
			model?: string;
			answers?: { route?: { probabilities?: Record<string, number> } };
		};
		const probabilities = body.answers?.route?.probabilities;
		const values = config.candidates.map(
			(_, i) => probabilities?.[`option_${i}`],
		);
		if (
			body.model !== config.model ||
			!probabilities ||
			Object.keys(probabilities).length !== values.length ||
			values.some(
				(p) => typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1,
			)
		) {
			throw new Error("saina_invalid_response");
		}
		const scores = values as number[];
		if (Math.abs(scores.reduce((a, b) => a + b, 0) - 1) > 0.001) {
			throw new Error("saina_invalid_response");
		}
		const index = scores.reduce(
			(best, p, i) => (p > scores[best] ? i : best),
			0,
		);
		selectedModel = config.candidates[index].model;
	} catch (cause) {
		error =
			cause instanceof Error &&
			["saina_http_error", "saina_invalid_response"].includes(cause.message)
				? cause.message
				: "saina_request_error";
	}
	return {
		caseId,
		model: config.model,
		revision: config.revision,
		selectedModel,
		latencyMs: performance.now() - started,
		requestId,
		error,
	};
}

export function sainaFailure(decision: SainaDecision): BenchmarkResponse {
	return {
		content: "",
		reasoning: "",
		toolCalls: [],
		finishReason: null,
		responseModel: null,
		requestId: null,
		usage: {
			promptTokens: 0,
			completionTokens: 0,
			reasoningTokens: 0,
			visibleCompletionTokens: 0,
			raw: { cost: 0 },
		},
		timing: {
			headersMs: null,
			firstEventMs: null,
			firstReasoningMs: null,
			firstContentMs: null,
			lastContentMs: null,
			generationMs: null,
			totalMs: decision.latencyMs,
			visibleTokensPerSecond: null,
			contentChunkCount: 0,
			averageContentChunkCharacters: null,
			maxContentStallMs: null,
			finalContentBurstRatio: null,
			buffered: null,
		},
		streamChunks: [],
		error: {
			code: decision.error ?? "saina_timeout",
			message: "Routing failed; no downstream request was made",
		},
		agent: null,
	};
}

export function includeRoutingLatency(
	response: BenchmarkResponse,
	decision: SainaDecision,
): BenchmarkResponse {
	const shift = (value: number | null) =>
		value === null ? null : value + decision.latencyMs;
	return {
		...response,
		timing: {
			...response.timing,
			totalMs: response.timing.totalMs + decision.latencyMs,
			headersMs: shift(response.timing.headersMs),
			firstEventMs: shift(response.timing.firstEventMs),
			firstReasoningMs: shift(response.timing.firstReasoningMs),
			firstContentMs: shift(response.timing.firstContentMs),
			lastContentMs: shift(response.timing.lastContentMs),
		},
		streamChunks: response.streamChunks.map((chunk) => ({
			...chunk,
			atMs: chunk.atMs + decision.latencyMs,
		})),
	};
}
