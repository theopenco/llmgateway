export type BenchmarkKind = "performance" | "quality";
export type BenchmarkOutputFormat = "html" | "json" | "markdown";

export interface BenchmarkMessage {
	role: "assistant" | "system" | "user";
	content: string;
}

export interface BenchmarkRequest {
	messages: BenchmarkMessage[];
	maxTokens?: number;
	reasoningEffort?: string;
	temperature?: number;
	parameters?: Readonly<Record<string, unknown>>;
}

export interface BenchmarkTarget {
	id: string;
	model: string;
	modelId?: string;
	mapping?: string;
	displayName?: string;
	metadata?: Readonly<Record<string, boolean | number | string | null>>;
}

export interface BenchmarkRunContext {
	caseId: string;
	run: number;
	target: BenchmarkTarget;
	warmup: boolean;
}

export interface BenchmarkEvaluation {
	passed: boolean | null;
	answer?: string;
	expected?: string;
	detail?: string;
}

export interface BenchmarkUsage {
	promptTokens: number | null;
	completionTokens: number | null;
	reasoningTokens: number | null;
	visibleCompletionTokens: number | null;
	raw: Readonly<Record<string, unknown>> | null;
}

export interface BenchmarkTiming {
	headersMs: number | null;
	firstEventMs: number | null;
	firstReasoningMs: number | null;
	firstContentMs: number | null;
	generationMs: number | null;
	totalMs: number;
	visibleTokensPerSecond: number | null;
}

export interface BenchmarkError {
	code: string;
	message: string;
	status?: number;
}

export interface BenchmarkResponse {
	content: string;
	reasoning: string;
	finishReason: string | null;
	responseModel: string | null;
	requestId: string | null;
	usage: BenchmarkUsage;
	timing: BenchmarkTiming;
	error: BenchmarkError | null;
}

export interface BenchmarkCase {
	id: string;
	name: string;
	kind: BenchmarkKind;
	category?: string;
	description?: string;
	defaultRuns?: number;
	defaultWarmupRuns?: number;
	request:
		BenchmarkRequest | ((context: BenchmarkRunContext) => BenchmarkRequest);
	evaluate?: (
		response: BenchmarkResponse,
		context: BenchmarkRunContext,
	) => BenchmarkEvaluation;
}

export interface BenchmarkCaseDescriptor {
	id: string;
	name: string;
	kind: BenchmarkKind;
	category?: string;
	description?: string;
}

export interface BenchmarkRequestOverrides {
	maxTokens?: number;
	reasoningEffort?: string;
	temperature?: number;
	parameters?: Readonly<Record<string, unknown>>;
}

export interface BenchmarkClientOptions {
	url: string;
	apiKey?: string;
	headers?: Readonly<Record<string, string>>;
	disableCache?: boolean;
	disableFallback?: boolean;
}

export interface BenchmarkProgressEvent {
	type: "run-completed" | "run-started";
	caseId: string;
	run: number;
	targetId: string;
	warmup: boolean;
	result?: BenchmarkTrial;
}

export interface RunBenchmarkOptions {
	client: BenchmarkClientOptions;
	targets: BenchmarkTarget[];
	cases: BenchmarkCase[];
	runs?: number;
	warmupRuns?: number;
	concurrency?: number;
	timeoutMs?: number;
	includeResponses?: boolean;
	referenceTargetId?: string;
	request?: BenchmarkRequestOverrides;
	fetch?: typeof fetch;
	onProgress?: (event: BenchmarkProgressEvent) => void;
}

export interface BenchmarkTrial {
	targetId: string;
	caseId: string;
	kind: BenchmarkKind;
	category?: string;
	run: number;
	warmup: boolean;
	response: BenchmarkResponse;
	evaluation: BenchmarkEvaluation | null;
}

export interface NumericSummary {
	count: number;
	min: number;
	mean: number;
	p50: number;
	p95: number;
	max: number;
}

export interface BenchmarkMetricSummary {
	totalMs: NumericSummary | null;
	ttftMs: NumericSummary | null;
	visibleTokensPerSecond: NumericSummary | null;
}

export interface BenchmarkQualitySummary {
	attempted: number;
	passed: number;
	score: number | null;
}

export interface BenchmarkAgreementSummary {
	compared: number;
	matching: number;
	rate: number | null;
}

export interface BenchmarkCaseSummary {
	targetId: string;
	caseId: string;
	attempted: number;
	succeeded: number;
	valid: number;
	metrics: BenchmarkMetricSummary;
}

export interface BenchmarkTargetSummary {
	targetId: string;
	attempted: number;
	succeeded: number;
	valid: number;
	quality: BenchmarkQualitySummary;
	referenceAgreement: BenchmarkAgreementSummary | null;
	performance: BenchmarkMetricSummary;
}

export interface BenchmarkResult {
	schemaVersion: 1;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	config: {
		url: string;
		runs: number | null;
		warmupRuns: number | null;
		concurrency: number;
		timeoutMs: number;
		includeResponses: boolean;
		referenceTargetId: string | null;
		disableCache: boolean;
		disableFallback: boolean;
		request: BenchmarkRequestOverrides;
	};
	targets: BenchmarkTarget[];
	cases: BenchmarkCaseDescriptor[];
	summary: {
		targets: BenchmarkTargetSummary[];
		cases: BenchmarkCaseSummary[];
	};
	trials: BenchmarkTrial[];
}
