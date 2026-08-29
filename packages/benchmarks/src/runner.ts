import {
	answerEntropy,
	bootstrapRateInterval,
	deriveBenchmarkSeed,
	summarizeNumbers,
} from "./statistics.js";
import { executeStreamingRequest } from "./stream.js";

import type {
	BenchmarkAgreementSummary,
	BenchmarkCase,
	BenchmarkCaseSummary,
	BenchmarkEfficiencySummary,
	BenchmarkEvaluation,
	BenchmarkFingerprintSummary,
	BenchmarkLoadSummary,
	BenchmarkMetricSummary,
	BenchmarkQualitySummary,
	BenchmarkReliabilitySummary,
	BenchmarkRequest,
	BenchmarkResponse,
	BenchmarkResult,
	BenchmarkRunContext,
	BenchmarkSliceSummary,
	BenchmarkTarget,
	BenchmarkTargetSummary,
	BenchmarkTrial,
	RunBenchmarkOptions,
} from "./types.js";

interface IndexedTrial {
	caseIndex: number;
	sequence: number;
	targetIndex: number;
	trial: BenchmarkTrial;
}

interface BenchmarkGroup {
	caseDefinition: BenchmarkCase;
	caseIndex: number;
	targetIndex: number;
}

export const DEFAULT_BENCHMARK_TIMEOUT_MS = 60_000;
export const DEFAULT_BENCHMARK_BUDGET_MS = 60_000;

function positiveInteger(value: number | undefined, fallback: number): number {
	if (value === undefined) {
		return fallback;
	}
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`Expected a non-negative integer, received ${value}`);
	}
	return value;
}

function mergeRequest(
	request: BenchmarkRequest,
	overrides: RunBenchmarkOptions["request"],
): BenchmarkRequest {
	return {
		...request,
		maxTokens: overrides?.maxTokens ?? request.maxTokens,
		reasoningEffort: overrides?.reasoningEffort ?? request.reasoningEffort,
		temperature: overrides?.temperature ?? request.temperature,
		parameters: { ...request.parameters, ...overrides?.parameters },
	};
}

function stripResponse(response: BenchmarkResponse): BenchmarkResponse {
	return {
		...response,
		content: "",
		reasoning: "",
		toolCalls: [],
		streamChunks: [],
	};
}

function metrics(trials: BenchmarkTrial[]): BenchmarkMetricSummary {
	const timing = trials.map((trial) => trial.response.timing);
	const buffered = timing.filter((value) => value.buffered !== null);
	return {
		headersMs: summarizeNumbers(timing.map((value) => value.headersMs)),
		firstEventMs: summarizeNumbers(timing.map((value) => value.firstEventMs)),
		firstReasoningMs: summarizeNumbers(
			timing.map((value) => value.firstReasoningMs),
		),
		totalMs: summarizeNumbers(timing.map((value) => value.totalMs)),
		ttftMs: summarizeNumbers(timing.map((value) => value.firstContentMs)),
		generationMs: summarizeNumbers(timing.map((value) => value.generationMs)),
		visibleTokensPerSecond: summarizeNumbers(
			timing.map((value) => value.visibleTokensPerSecond),
		),
		maxContentStallMs: summarizeNumbers(
			timing.map((value) => value.maxContentStallMs),
		),
		averageContentChunkCharacters: summarizeNumbers(
			timing.map((value) => value.averageContentChunkCharacters),
		),
		finalContentBurstRatio: summarizeNumbers(
			timing.map((value) => value.finalContentBurstRatio),
		),
		bufferedRate:
			buffered.length === 0
				? null
				: buffered.filter((value) => value.buffered).length / buffered.length,
	};
}

function isValid(trial: BenchmarkTrial): boolean {
	if (trial.response.error || trial.evaluation?.passed === false) {
		return false;
	}
	return trial.kind === "performance" || trial.evaluation?.passed === true;
}

function qualitySummary(trials: BenchmarkTrial[]): BenchmarkQualitySummary {
	const evaluable = trials.filter(
		(trial) =>
			trial.kind === "quality" && typeof trial.evaluation?.passed === "boolean",
	);
	const answers = evaluable
		.map((trial) => trial.evaluation?.answer)
		.filter(
			(answer): answer is string => answer !== undefined && answer !== "",
		);
	const cases = new Map<string, BenchmarkTrial[]>();
	for (const trial of evaluable) {
		const values = cases.get(trial.caseId) ?? [];
		values.push(trial);
		cases.set(trial.caseId, values);
	}
	const firstRuns = [...cases.values()]
		.map((values) => values.sort((left, right) => left.run - right.run)[0])
		.filter(Boolean);
	const consistencyRates = [...cases.values()]
		.map((values) => {
			const caseAnswers = values
				.map((trial) => trial.evaluation?.answer)
				.filter((answer): answer is string => Boolean(answer));
			if (caseAnswers.length < 2) {
				return null;
			}
			const counts = new Map<string, number>();
			for (const answer of caseAnswers) {
				counts.set(answer, (counts.get(answer) ?? 0) + 1);
			}
			return Math.max(...counts.values()) / caseAnswers.length;
		})
		.filter((value): value is number => value !== null);
	const confidenceTrials = evaluable.filter(
		(trial) => trial.evaluation?.confidence !== undefined,
	);
	const passed = evaluable.filter(
		(trial) => trial.evaluation?.passed === true,
	).length;
	const instructionTotals = evaluable.reduce(
		(totals, trial) => ({
			passed:
				totals.passed + (trial.evaluation?.metrics?.instructionsPassed ?? 0),
			total: totals.total + (trial.evaluation?.metrics?.instructionsTotal ?? 0),
		}),
		{ passed: 0, total: 0 },
	);
	return {
		attempted: evaluable.length,
		passed,
		score: evaluable.length === 0 ? null : passed / evaluable.length,
		instructionScore:
			instructionTotals.total === 0
				? null
				: instructionTotals.passed / instructionTotals.total,
		firstPassScore:
			firstRuns.length === 0
				? null
				: firstRuns.filter((trial) => trial.evaluation?.passed).length /
					firstRuns.length,
		uniqueAnswers: new Set(answers).size,
		answerEntropy: answerEntropy(answers),
		consistencyRate:
			consistencyRates.length === 0
				? null
				: consistencyRates.reduce((sum, value) => sum + value, 0) /
					consistencyRates.length,
		meanConfidence:
			confidenceTrials.length === 0
				? null
				: confidenceTrials.reduce(
						(sum, trial) => sum + (trial.evaluation?.confidence ?? 0),
						0,
					) / confidenceTrials.length,
		brierScore:
			confidenceTrials.length === 0
				? null
				: confidenceTrials.reduce((sum, trial) => {
						const outcome = trial.evaluation?.passed ? 1 : 0;
						const error = (trial.evaluation?.confidence ?? 0) - outcome;
						const squaredError = error ** 2;
						return sum + squaredError;
					}, 0) / confidenceTrials.length,
	};
}

function trialKey(trial: BenchmarkTrial): string {
	return `${trial.caseId}:${trial.run}`;
}

function agreementBetween(
	trials: BenchmarkTrial[],
	leftTargetId: string,
	rightTargetId: string,
	predicate: (trial: BenchmarkTrial) => boolean = () => true,
): BenchmarkAgreementSummary {
	const leftAnswers = new Map(
		trials
			.filter(
				(trial) =>
					trial.targetId === leftTargetId &&
					trial.kind === "quality" &&
					!trial.warmup &&
					trial.evaluation?.answer &&
					predicate(trial),
			)
			.map((trial) => [trialKey(trial), trial.evaluation?.answer]),
	);
	const matches = trials
		.filter(
			(trial) =>
				trial.targetId === rightTargetId &&
				trial.kind === "quality" &&
				!trial.warmup &&
				trial.evaluation?.answer &&
				leftAnswers.has(trialKey(trial)),
		)
		.map(
			(trial) => trial.evaluation?.answer === leftAnswers.get(trialKey(trial)),
		);
	return {
		compared: matches.length,
		matching: matches.filter(Boolean).length,
		rate:
			matches.length === 0
				? null
				: matches.filter(Boolean).length / matches.length,
		confidence95: bootstrapRateInterval(matches),
	};
}

function sliceScore(trials: BenchmarkTrial[], key: string): number | null {
	const evaluable = trials.filter(
		(trial) =>
			trial.category === key && typeof trial.evaluation?.passed === "boolean",
	);
	return evaluable.length === 0
		? null
		: evaluable.filter((trial) => trial.evaluation?.passed).length /
				evaluable.length;
}

function categorySimilarity(
	trials: BenchmarkTrial[],
	targetId: string,
	referenceTargetId: string,
): number | null {
	const categories = new Set(
		trials
			.map((trial) => trial.category)
			.filter((value): value is string => !!value),
	);
	const differences = [...categories]
		.map((category) => {
			const target = sliceScore(
				trials.filter((trial) => trial.targetId === targetId),
				category,
			);
			const reference = sliceScore(
				trials.filter((trial) => trial.targetId === referenceTargetId),
				category,
			);
			return target === null || reference === null
				? null
				: Math.abs(target - reference);
		})
		.filter((value): value is number => value !== null);
	if (differences.length === 0) {
		return null;
	}
	const meanDifference =
		differences.reduce((sum, value) => sum + value, 0) / differences.length;
	return 1 - meanDifference;
}

function reasoningRatio(trials: BenchmarkTrial[]): number | null {
	const usage = trials.filter(
		(trial) =>
			trial.response.usage.reasoningTokens !== null &&
			trial.response.usage.completionTokens,
	);
	if (usage.length === 0) {
		return null;
	}
	const reasoning = usage.reduce(
		(sum, trial) => sum + (trial.response.usage.reasoningTokens ?? 0),
		0,
	);
	const completion = usage.reduce(
		(sum, trial) => sum + (trial.response.usage.completionTokens ?? 0),
		0,
	);
	return completion === 0 ? null : reasoning / completion;
}

function rareErrorAgreement(
	trials: BenchmarkTrial[],
	targetId: string,
	referenceTargetId: string,
): number | null {
	const referenceErrors = trials.filter(
		(trial) =>
			trial.targetId === referenceTargetId &&
			!trial.warmup &&
			trial.evaluation?.passed === false &&
			trial.evaluation.answer,
	);
	let matchedWeight = 0;
	let totalWeight = 0;
	for (const reference of referenceErrors) {
		const comparable = trials.filter(
			(trial) =>
				!trial.warmup &&
				trialKey(trial) === trialKey(reference) &&
				trial.evaluation?.answer,
		);
		const frequency = comparable.filter(
			(trial) => trial.evaluation?.answer === reference.evaluation?.answer,
		).length;
		const weight = frequency === 0 ? 0 : 1 / frequency;
		totalWeight += weight;
		if (
			comparable.some(
				(trial) =>
					trial.targetId === targetId &&
					trial.evaluation?.answer === reference.evaluation?.answer,
			)
		) {
			matchedWeight += weight;
		}
	}
	return totalWeight === 0 ? null : matchedWeight / totalWeight;
}

function fingerprint(
	trials: BenchmarkTrial[],
	targetId: string,
	referenceTargetId: string,
): BenchmarkFingerprintSummary | null {
	if (targetId === referenceTargetId) {
		return null;
	}
	const agreement = agreementBetween(trials, referenceTargetId, targetId);
	const errorAgreement = agreementBetween(
		trials,
		referenceTargetId,
		targetId,
		(trial) => trial.evaluation?.passed === false,
	);
	const category = categorySimilarity(trials, targetId, referenceTargetId);
	const targetRatio = reasoningRatio(
		trials.filter((trial) => trial.targetId === targetId),
	);
	const referenceRatio = reasoningRatio(
		trials.filter((trial) => trial.targetId === referenceTargetId),
	);
	const rareAgreement = rareErrorAgreement(trials, targetId, referenceTargetId);
	const reasoningDelta =
		targetRatio === null || referenceRatio === null
			? null
			: Math.abs(targetRatio - referenceRatio);
	const components = [
		agreement.rate,
		errorAgreement.rate,
		rareAgreement,
		category,
		reasoningDelta === null ? null : 1 - Math.min(1, reasoningDelta),
	].filter((value): value is number => value !== null);
	return {
		agreement,
		errorAgreement,
		rareErrorAgreement: rareAgreement,
		categorySimilarity: category,
		reasoningTokenRatioDelta: reasoningDelta,
		behavioralSimilarity:
			components.length === 0
				? null
				: components.reduce((sum, value) => sum + value, 0) / components.length,
	};
}

function reliability(trials: BenchmarkTrial[]): BenchmarkReliabilitySummary {
	const measured = trials.filter((trial) => !trial.warmup);
	const errorsByCode: Record<string, number> = {};
	for (const trial of measured) {
		const code = trial.response.error?.code;
		if (code) {
			errorsByCode[code] = (errorsByCode[code] ?? 0) + 1;
		}
	}
	const rate = (
		predicate: (trial: BenchmarkTrial) => boolean,
	): number | null =>
		measured.length === 0
			? null
			: measured.filter(predicate).length / measured.length;
	return {
		successRate: rate((trial) => !trial.response.error),
		timeoutRate: rate((trial) =>
			["AbortError", "TimeoutError"].includes(trial.response.error?.code ?? ""),
		),
		rateLimitRate: rate(
			(trial) =>
				trial.response.error?.status === 429 ||
				trial.response.error?.code === "http_429",
		),
		truncatedRate: rate((trial) => trial.response.finishReason === "length"),
		malformedStreamRate: rate((trial) =>
			["invalid_stream_json", "stream_read_error"].includes(
				trial.response.error?.code ?? "",
			),
		),
		errorsByCode,
	};
}

function efficiency(trials: BenchmarkTrial[]): BenchmarkEfficiencySummary {
	const measured = trials.filter((trial) => !trial.warmup);
	const costs = measured
		.map((trial) => trial.estimatedCostUsd)
		.filter((value): value is number => value !== null);
	const correct = measured.filter(
		(trial) => trial.kind === "quality" && trial.evaluation?.passed,
	).length;
	const totalCost =
		costs.length === 0 ? null : costs.reduce((sum, value) => sum + value, 0);
	return {
		estimatedCostUsd: totalCost,
		costPerCorrectAnswerUsd:
			totalCost === null || correct === 0 ? null : totalCost / correct,
		reasoningTokenRatio: reasoningRatio(measured),
		usageMissingRate:
			measured.length === 0
				? null
				: measured.filter(
						(trial) =>
							trial.response.usage.promptTokens === null ||
							trial.response.usage.completionTokens === null,
					).length / measured.length,
	};
}

function robustnessDrop(
	trials: BenchmarkTrial[],
	targetId: string,
	cases: BenchmarkCase[],
): number | null {
	const drops: number[] = [];
	for (const variant of cases.filter(
		(benchmarkCase) => benchmarkCase.variantOf,
	)) {
		const canonical = trials.filter(
			(trial) =>
				trial.targetId === targetId && trial.caseId === variant.variantOf,
		);
		const changed = trials.filter(
			(trial) => trial.targetId === targetId && trial.caseId === variant.id,
		);
		const canonicalScore = qualitySummary(canonical).score;
		const changedScore = qualitySummary(changed).score;
		if (canonicalScore !== null && changedScore !== null) {
			drops.push(canonicalScore - changedScore);
		}
	}
	return drops.length === 0
		? null
		: drops.reduce((sum, value) => sum + value, 0) / drops.length;
}

function achievedRequestsPerSecond(trials: BenchmarkTrial[]): number | null {
	if (trials.length === 0) {
		return null;
	}
	const started = Math.min(...trials.map((trial) => trial.startedOffsetMs));
	const finished = Math.max(...trials.map((trial) => trial.finishedOffsetMs));
	const durationSeconds = (finished - started) / 1_000;
	return durationSeconds <= 0 ? null : trials.length / durationSeconds;
}

function loadSummaries(
	trials: BenchmarkTrial[],
	targetIds: string[],
): BenchmarkLoadSummary[] {
	return targetIds.map((targetId) => {
		const loadTrials = trials.filter(
			(trial) =>
				trial.targetId === targetId &&
				typeof trial.parameters.concurrency === "number",
		);
		const caseIds = [...new Set(loadTrials.map((trial) => trial.caseId))];
		const rawPoints = caseIds
			.map((caseId) => {
				const values = loadTrials.filter((trial) => trial.caseId === caseId);
				const concurrency = Number(values[0]?.parameters.concurrency ?? 1);
				const timing = metrics(values.filter(isValid));
				return {
					caseId,
					concurrency,
					attempted: values.length,
					successRate:
						values.length === 0
							? null
							: values.filter((trial) => !trial.response.error).length /
								values.length,
					achievedRequestsPerSecond: achievedRequestsPerSecond(values),
					ttftP50Ms: timing.ttftMs?.p50 ?? null,
					totalP50Ms: timing.totalMs?.p50 ?? null,
				};
			})
			.sort((left, right) => left.concurrency - right.concurrency);
		const baseline = rawPoints[0]?.totalP50Ms ?? null;
		const points = rawPoints.map((point) => ({
			...point,
			latencyDegradation:
				baseline === null || point.totalP50Ms === null || baseline === 0
					? null
					: point.totalP50Ms / baseline,
		}));
		const saturated = points.find(
			(point) =>
				(point.latencyDegradation ?? 0) >= 2 || (point.successRate ?? 1) < 0.95,
		);
		return {
			targetId,
			points,
			saturationConcurrency: saturated?.concurrency ?? null,
		};
	});
}

function sliceSummaries(
	trials: BenchmarkTrial[],
	targetIds: string[],
	field: "category" | "difficulty" | "dimension",
): BenchmarkSliceSummary[] {
	const keys = new Set(
		trials
			.map((trial) => trial[field])
			.filter((value): value is string => Boolean(value)),
	);
	return targetIds.flatMap((targetId) =>
		[...keys].map((key) => {
			const evaluable = trials.filter(
				(trial) =>
					trial.targetId === targetId &&
					trial[field] === key &&
					typeof trial.evaluation?.passed === "boolean",
			);
			const passed = evaluable.filter(
				(trial) => trial.evaluation?.passed,
			).length;
			return {
				targetId,
				key,
				attempted: evaluable.length,
				passed,
				score: evaluable.length === 0 ? null : passed / evaluable.length,
			};
		}),
	);
}

function summarize(
	trials: BenchmarkTrial[],
	targetIds: string[],
	cases: BenchmarkCase[],
	referenceTargetId: string,
): BenchmarkResult["summary"] {
	const measured = trials.filter((trial) => !trial.warmup);
	const targetSummaries: BenchmarkTargetSummary[] = targetIds.map(
		(targetId) => {
			const targetTrials = measured.filter(
				(trial) => trial.targetId === targetId,
			);
			const validPerformance = targetTrials.filter(
				(trial) => trial.kind === "performance" && isValid(trial),
			);
			return {
				targetId,
				attempted: targetTrials.length,
				succeeded: targetTrials.filter((trial) => !trial.response.error).length,
				valid: targetTrials.filter(isValid).length,
				quality: qualitySummary(targetTrials),
				referenceAgreement:
					targetId === referenceTargetId
						? null
						: agreementBetween(measured, referenceTargetId, targetId),
				fingerprint: fingerprint(measured, targetId, referenceTargetId),
				performance: metrics(validPerformance),
				reliability: reliability(targetTrials),
				efficiency: efficiency(targetTrials),
				robustnessDrop: robustnessDrop(measured, targetId, cases),
				achievedRequestsPerSecond: achievedRequestsPerSecond(targetTrials),
			};
		},
	);
	const caseSummaries: BenchmarkCaseSummary[] = targetIds.flatMap((targetId) =>
		cases.map((benchmarkCase) => {
			const caseTrials = measured.filter(
				(trial) =>
					trial.targetId === targetId && trial.caseId === benchmarkCase.id,
			);
			const validTrials = caseTrials.filter(isValid);
			return {
				targetId,
				caseId: benchmarkCase.id,
				attempted: caseTrials.length,
				succeeded: caseTrials.filter((trial) => !trial.response.error).length,
				valid: validTrials.length,
				quality: qualitySummary(caseTrials),
				metrics: metrics(validTrials),
				achievedRequestsPerSecond: achievedRequestsPerSecond(caseTrials),
			};
		}),
	);
	return {
		targets: targetSummaries,
		cases: caseSummaries,
		categories: sliceSummaries(measured, targetIds, "category"),
		difficulties: sliceSummaries(measured, targetIds, "difficulty"),
		dimensions: sliceSummaries(measured, targetIds, "dimension"),
		pairwiseAgreement: targetIds.flatMap((leftTargetId, leftIndex) =>
			targetIds.slice(leftIndex + 1).map((rightTargetId) => ({
				leftTargetId,
				rightTargetId,
				agreement: agreementBetween(measured, leftTargetId, rightTargetId),
			})),
		),
		load: loadSummaries(measured, targetIds),
	};
}

async function runWithConcurrency<T>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
	let cursor = 0;
	const runWorker = async (): Promise<void> => {
		for (;;) {
			const index = cursor++;
			if (index >= items.length) {
				return;
			}
			await worker(items[index], index);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, () =>
			runWorker(),
		),
	);
}

function estimateCost(
	target: BenchmarkTarget,
	response: BenchmarkResponse,
): number | null {
	const rawInputPrice = target.metadata?.inputPrice;
	const rawOutputPrice = target.metadata?.outputPrice;
	if (rawInputPrice === null || rawInputPrice === undefined) {
		return null;
	}
	if (rawOutputPrice === null || rawOutputPrice === undefined) {
		return null;
	}
	const inputPrice = Number(rawInputPrice);
	const outputPrice = Number(rawOutputPrice);
	const requestPrice = Number(target.metadata?.requestPrice ?? 0);
	if (
		!Number.isFinite(inputPrice) ||
		!Number.isFinite(outputPrice) ||
		response.usage.promptTokens === null ||
		response.usage.completionTokens === null
	) {
		return null;
	}
	const inputCost = response.usage.promptTokens * inputPrice;
	const outputCost = response.usage.completionTokens * outputPrice;
	const fixedCost = Number.isFinite(requestPrice) ? requestPrice : 0;
	return inputCost + outputCost + fixedCost;
}

export async function runBenchmark(
	options: RunBenchmarkOptions,
): Promise<BenchmarkResult> {
	if (options.targets.length === 0 || options.cases.length === 0) {
		throw new Error("At least one target and benchmark case are required");
	}
	if (
		new Set(options.targets.map((target) => target.id)).size !==
		options.targets.length
	) {
		throw new Error("Benchmark target ids must be unique");
	}
	if (
		new Set(options.cases.map((benchmarkCase) => benchmarkCase.id)).size !==
		options.cases.length
	) {
		throw new Error("Benchmark case ids must be unique");
	}
	const concurrency = positiveInteger(options.concurrency, 1);
	if (concurrency === 0) {
		throw new Error("Concurrency must be at least 1");
	}
	const timeoutMs = positiveInteger(
		options.timeoutMs,
		DEFAULT_BENCHMARK_TIMEOUT_MS,
	);
	const budgetMs =
		options.budgetMs === null
			? null
			: positiveInteger(options.budgetMs, DEFAULT_BENCHMARK_BUDGET_MS);
	const seed = positiveInteger(options.seed, 1);
	const includeResponses = options.includeResponses ?? true;
	const fetchImplementation = options.fetch ?? globalThis.fetch;
	const referenceTargetId = options.referenceTargetId ?? options.targets[0].id;
	if (!options.targets.some((target) => target.id === referenceTargetId)) {
		throw new Error(`Unknown reference target: ${referenceTargetId}`);
	}
	const started = performance.now();
	const startedAt = new Date().toISOString();
	const targetStartedAt = new Map<string, number>();
	const indexedTrials: IndexedTrial[] = [];
	const groups: BenchmarkGroup[] = options.targets.flatMap((_, targetIndex) =>
		options.cases.map((caseDefinition, caseIndex) => ({
			caseDefinition,
			caseIndex,
			targetIndex,
		})),
	);

	await runWithConcurrency(groups, concurrency, async (group) => {
		const target = options.targets[group.targetIndex];
		const runs = positiveInteger(
			options.runs,
			group.caseDefinition.defaultRuns ?? 1,
		);
		const warmupRuns = positiveInteger(
			options.warmupRuns,
			group.caseDefinition.defaultWarmupRuns ?? 0,
		);
		const groupConcurrency = positiveInteger(
			group.caseDefinition.defaultConcurrency,
			1,
		);
		const executeSequence = async (sequence: number): Promise<void> => {
			const targetStart = targetStartedAt.get(target.id) ?? performance.now();
			targetStartedAt.set(target.id, targetStart);
			if (budgetMs !== null && performance.now() - targetStart >= budgetMs) {
				return;
			}
			const warmup = sequence < warmupRuns;
			const run = warmup ? sequence + 1 : sequence - warmupRuns + 1;
			const context: BenchmarkRunContext = {
				caseId: group.caseDefinition.id,
				run,
				seed: deriveBenchmarkSeed(
					seed,
					group.caseDefinition.seedGroup ??
						group.caseDefinition.variantOf ??
						group.caseDefinition.id,
					run,
					warmup,
				),
				target,
				warmup,
			};
			options.onProgress?.({
				type: "run-started",
				caseId: context.caseId,
				run,
				targetId: target.id,
				warmup,
			});
			const definedRequest =
				typeof group.caseDefinition.request === "function"
					? group.caseDefinition.request(context)
					: group.caseDefinition.request;
			const startedOffsetMs = performance.now() - started;
			const response = await executeStreamingRequest({
				client: options.client,
				request: mergeRequest(definedRequest, options.request),
				model: target.model,
				timeoutMs,
				fetch: fetchImplementation,
			});
			let evaluation: BenchmarkEvaluation | null = null;
			if (!response.error && group.caseDefinition.evaluate) {
				try {
					evaluation = await group.caseDefinition.evaluate(response, context);
				} catch (error) {
					evaluation = {
						passed: false,
						detail: `Evaluator failed: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}
			const trial: BenchmarkTrial = {
				targetId: target.id,
				caseId: group.caseDefinition.id,
				kind: group.caseDefinition.kind,
				category: group.caseDefinition.category,
				dimension: group.caseDefinition.dimension,
				difficulty: group.caseDefinition.difficulty,
				run,
				seed: context.seed,
				parameters: group.caseDefinition.parameters?.(context) ?? {},
				warmup,
				startedOffsetMs,
				finishedOffsetMs: performance.now() - started,
				response: includeResponses ? response : stripResponse(response),
				evaluation,
				estimatedCostUsd: estimateCost(target, response),
			};
			indexedTrials.push({
				caseIndex: group.caseIndex,
				sequence,
				targetIndex: group.targetIndex,
				trial,
			});
			options.onProgress?.({
				type: "run-completed",
				caseId: context.caseId,
				run,
				targetId: target.id,
				warmup,
				result: trial,
			});
		};
		await runWithConcurrency(
			Array.from({ length: warmupRuns }, (_, index) => index),
			groupConcurrency,
			executeSequence,
		);
		await runWithConcurrency(
			Array.from({ length: runs }, (_, index) => warmupRuns + index),
			groupConcurrency,
			executeSequence,
		);
	});

	const trials = indexedTrials
		.sort(
			(left, right) =>
				left.targetIndex - right.targetIndex ||
				left.caseIndex - right.caseIndex ||
				left.sequence - right.sequence,
		)
		.map(({ trial }) => trial);
	const finishedAt = new Date().toISOString();
	return {
		schemaVersion: 2,
		startedAt,
		finishedAt,
		durationMs: performance.now() - started,
		config: {
			url: options.client.url,
			runs: options.runs ?? null,
			warmupRuns: options.warmupRuns ?? null,
			concurrency,
			timeoutMs,
			budgetMs,
			seed,
			includeResponses,
			referenceTargetId,
			disableCache: options.client.disableCache ?? true,
			disableFallback: options.client.disableFallback ?? true,
			request: options.request ?? {},
		},
		targets: options.targets,
		cases: options.cases.map(
			({
				id,
				name,
				kind,
				category,
				dimension,
				difficulty,
				description,
				variantOf,
				variant,
			}) => ({
				id,
				name,
				kind,
				category,
				dimension,
				difficulty,
				description,
				variantOf,
				variant,
			}),
		),
		summary: summarize(
			trials,
			options.targets.map((target) => target.id),
			options.cases,
			referenceTargetId,
		),
		trials,
	};
}
