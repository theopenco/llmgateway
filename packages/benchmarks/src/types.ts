export type BenchmarkKind = "performance" | "quality";
export type BenchmarkOutputFormat = "html" | "json" | "markdown";
export type BenchmarkDifficulty = "easy" | "hard" | "medium";
export type BenchmarkProfileName = "load" | "smoke" | "standard";

export interface BenchmarkMessageToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export interface BenchmarkMessage {
	role: "assistant" | "system" | "tool" | "user";
	content: string;
	name?: string;
	toolCallId?: string;
	toolCalls?: BenchmarkMessageToolCall[];
}

export interface BenchmarkTool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters: Readonly<Record<string, unknown>>;
	};
}

export interface BenchmarkRequest {
	messages: BenchmarkMessage[];
	maxTokens?: number;
	reasoningEffort?: string;
	temperature?: number;
	tools?: BenchmarkTool[];
	toolChoice?: unknown;
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
	seed: number;
	target: BenchmarkTarget;
	warmup: boolean;
}

export interface BenchmarkEvaluation {
	passed: boolean | null;
	answer?: string;
	expected?: string;
	detail?: string;
	confidence?: number;
	score?: number;
	metrics?: Readonly<Record<string, number>>;
}

export interface BenchmarkUsage {
	promptTokens: number | null;
	completionTokens: number | null;
	reasoningTokens: number | null;
	visibleCompletionTokens: number | null;
	raw: Readonly<Record<string, unknown>> | null;
}

export interface BenchmarkStreamChunk {
	atMs: number;
	characters: number;
	kind: "content" | "reasoning";
}

export interface BenchmarkTiming {
	headersMs: number | null;
	firstEventMs: number | null;
	firstReasoningMs: number | null;
	firstContentMs: number | null;
	lastContentMs: number | null;
	generationMs: number | null;
	totalMs: number;
	visibleTokensPerSecond: number | null;
	contentChunkCount: number;
	averageContentChunkCharacters: number | null;
	maxContentStallMs: number | null;
	finalContentBurstRatio: number | null;
	buffered: boolean | null;
}

export interface BenchmarkError {
	code: string;
	message: string;
	status?: number;
}

export interface BenchmarkResponse {
	content: string;
	reasoning: string;
	toolCalls: BenchmarkMessageToolCall[];
	finishReason: string | null;
	responseModel: string | null;
	requestId: string | null;
	usage: BenchmarkUsage;
	timing: BenchmarkTiming;
	streamChunks: BenchmarkStreamChunk[];
	error: BenchmarkError | null;
}

export interface BenchmarkCase {
	id: string;
	name: string;
	kind: BenchmarkKind;
	category?: string;
	dimension?: string;
	difficulty?: BenchmarkDifficulty;
	description?: string;
	variantOf?: string;
	variant?: "canonical" | "distractor" | "paraphrase";
	seedGroup?: string;
	defaultRuns?: number;
	defaultWarmupRuns?: number;
	defaultConcurrency?: number;
	request:
		BenchmarkRequest | ((context: BenchmarkRunContext) => BenchmarkRequest);
	parameters?: (
		context: BenchmarkRunContext,
	) => Readonly<Record<string, boolean | number | string | null>>;
	evaluate?: (
		response: BenchmarkResponse,
		context: BenchmarkRunContext,
	) => BenchmarkEvaluation | Promise<BenchmarkEvaluation>;
}

export interface BenchmarkCaseDescriptor {
	id: string;
	name: string;
	kind: BenchmarkKind;
	category?: string;
	dimension?: string;
	difficulty?: BenchmarkDifficulty;
	description?: string;
	variantOf?: string;
	variant?: "canonical" | "distractor" | "paraphrase";
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
	budgetMs?: number | null;
	seed?: number;
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
	dimension?: string;
	difficulty?: BenchmarkDifficulty;
	run: number;
	seed: number;
	parameters: Readonly<Record<string, boolean | number | string | null>>;
	warmup: boolean;
	startedOffsetMs: number;
	finishedOffsetMs: number;
	response: BenchmarkResponse;
	evaluation: BenchmarkEvaluation | null;
	estimatedCostUsd: number | null;
}

export interface NumericSummary {
	count: number;
	min: number;
	mean: number;
	p50: number;
	p90: number;
	p95: number | null;
	p99: number | null;
	max: number;
	standardDeviation: number;
	medianAbsoluteDeviation: number;
	coefficientOfVariation: number | null;
}

export interface BenchmarkMetricSummary {
	headersMs: NumericSummary | null;
	firstEventMs: NumericSummary | null;
	firstReasoningMs: NumericSummary | null;
	totalMs: NumericSummary | null;
	ttftMs: NumericSummary | null;
	generationMs: NumericSummary | null;
	visibleTokensPerSecond: NumericSummary | null;
	maxContentStallMs: NumericSummary | null;
	averageContentChunkCharacters: NumericSummary | null;
	finalContentBurstRatio: NumericSummary | null;
	bufferedRate: number | null;
}

export interface BenchmarkQualitySummary {
	attempted: number;
	passed: number;
	score: number | null;
	firstPassScore: number | null;
	uniqueAnswers: number;
	answerEntropy: number | null;
	consistencyRate: number | null;
	meanConfidence: number | null;
	brierScore: number | null;
}

export interface BenchmarkAgreementSummary {
	compared: number;
	matching: number;
	rate: number | null;
	confidence95: readonly [number, number] | null;
}

export interface BenchmarkFingerprintSummary {
	agreement: BenchmarkAgreementSummary;
	errorAgreement: BenchmarkAgreementSummary;
	rareErrorAgreement: number | null;
	categorySimilarity: number | null;
	reasoningTokenRatioDelta: number | null;
	behavioralSimilarity: number | null;
}

export interface BenchmarkReliabilitySummary {
	successRate: number | null;
	timeoutRate: number | null;
	rateLimitRate: number | null;
	truncatedRate: number | null;
	malformedStreamRate: number | null;
	errorsByCode: Readonly<Record<string, number>>;
}

export interface BenchmarkEfficiencySummary {
	estimatedCostUsd: number | null;
	costPerCorrectAnswerUsd: number | null;
	reasoningTokenRatio: number | null;
	usageMissingRate: number | null;
}

export interface BenchmarkCaseSummary {
	targetId: string;
	caseId: string;
	attempted: number;
	succeeded: number;
	valid: number;
	quality: BenchmarkQualitySummary;
	metrics: BenchmarkMetricSummary;
	achievedRequestsPerSecond: number | null;
}

export interface BenchmarkSliceSummary {
	targetId: string;
	key: string;
	attempted: number;
	passed: number;
	score: number | null;
}

export interface BenchmarkTargetSummary {
	targetId: string;
	attempted: number;
	succeeded: number;
	valid: number;
	quality: BenchmarkQualitySummary;
	referenceAgreement: BenchmarkAgreementSummary | null;
	fingerprint: BenchmarkFingerprintSummary | null;
	performance: BenchmarkMetricSummary;
	reliability: BenchmarkReliabilitySummary;
	efficiency: BenchmarkEfficiencySummary;
	robustnessDrop: number | null;
	achievedRequestsPerSecond: number | null;
}

export interface BenchmarkLoadPoint {
	caseId: string;
	concurrency: number;
	attempted: number;
	successRate: number | null;
	achievedRequestsPerSecond: number | null;
	ttftP50Ms: number | null;
	totalP50Ms: number | null;
	latencyDegradation: number | null;
}

export interface BenchmarkLoadSummary {
	targetId: string;
	points: BenchmarkLoadPoint[];
	saturationConcurrency: number | null;
}

export interface BenchmarkPairwiseAgreement {
	leftTargetId: string;
	rightTargetId: string;
	agreement: BenchmarkAgreementSummary;
}

export interface BenchmarkResult {
	schemaVersion: 2;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	config: {
		url: string;
		runs: number | null;
		warmupRuns: number | null;
		concurrency: number;
		timeoutMs: number;
		budgetMs: number | null;
		seed: number;
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
		categories: BenchmarkSliceSummary[];
		difficulties: BenchmarkSliceSummary[];
		dimensions: BenchmarkSliceSummary[];
		pairwiseAgreement: BenchmarkPairwiseAgreement[];
		load: BenchmarkLoadSummary[];
	};
	trials: BenchmarkTrial[];
}

export interface BenchmarkProfile {
	name: BenchmarkProfileName;
	description: string;
	cases: BenchmarkCase[];
	defaults: Pick<
		RunBenchmarkOptions,
		"budgetMs" | "concurrency" | "runs" | "warmupRuns"
	>;
}

export interface BenchmarkSuiteAdapter<TOptions = unknown> {
	id: string;
	name: string;
	load: (options: TOptions) => BenchmarkCase[] | Promise<BenchmarkCase[]>;
}
