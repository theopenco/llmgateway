import { summarizeNumbers } from "./statistics.js";
import { executeStreamingRequest } from "./stream.js";

import type {
	BenchmarkAgreementSummary,
	BenchmarkCase,
	BenchmarkCaseSummary,
	BenchmarkEvaluation,
	BenchmarkMetricSummary,
	BenchmarkRequest,
	BenchmarkResponse,
	BenchmarkResult,
	BenchmarkRunContext,
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
		parameters: {
			...request.parameters,
			...overrides?.parameters,
		},
	};
}

function stripResponse(response: BenchmarkResponse): BenchmarkResponse {
	return { ...response, content: "", reasoning: "" };
}

function metrics(trials: BenchmarkTrial[]): BenchmarkMetricSummary {
	return {
		totalMs: summarizeNumbers(
			trials.map((trial) => trial.response.timing.totalMs),
		),
		ttftMs: summarizeNumbers(
			trials.map((trial) => trial.response.timing.firstContentMs),
		),
		visibleTokensPerSecond: summarizeNumbers(
			trials.map((trial) => trial.response.timing.visibleTokensPerSecond),
		),
	};
}

function isValid(trial: BenchmarkTrial): boolean {
	return (
		!trial.response.error &&
		trial.evaluation?.passed !== false &&
		trial.evaluation?.passed !== null
	);
}

function createAgreement(
	trials: BenchmarkTrial[],
	targetId: string,
	referenceTargetId: string,
): BenchmarkAgreementSummary | null {
	if (targetId === referenceTargetId) {
		return null;
	}
	const referenceAnswers = new Map(
		trials
			.filter(
				(trial) =>
					trial.targetId === referenceTargetId &&
					trial.kind === "quality" &&
					!trial.warmup &&
					trial.evaluation?.answer,
			)
			.map((trial) => [
				`${trial.caseId}:${trial.run}`,
				trial.evaluation?.answer,
			]),
	);
	const comparable = trials.filter(
		(trial) =>
			trial.targetId === targetId &&
			trial.kind === "quality" &&
			!trial.warmup &&
			trial.evaluation?.answer &&
			referenceAnswers.has(`${trial.caseId}:${trial.run}`),
	);
	if (comparable.length === 0) {
		return null;
	}
	const matching = comparable.filter(
		(trial) =>
			trial.evaluation?.answer ===
			referenceAnswers.get(`${trial.caseId}:${trial.run}`),
	).length;
	return {
		compared: comparable.length,
		matching,
		rate: matching / comparable.length,
	};
}

function summarize(
	trials: BenchmarkTrial[],
	targetIds: string[],
	caseIds: string[],
	referenceTargetId: string,
): BenchmarkResult["summary"] {
	const measured = trials.filter((trial) => !trial.warmup);
	const targetSummaries: BenchmarkTargetSummary[] = targetIds.map(
		(targetId) => {
			const targetTrials = measured.filter(
				(trial) => trial.targetId === targetId,
			);
			const quality = targetTrials.filter((trial) => trial.kind === "quality");
			const validPerformance = targetTrials.filter(
				(trial) => trial.kind === "performance" && isValid(trial),
			);
			const qualityPassed = quality.filter(
				(trial) => trial.evaluation?.passed === true,
			).length;
			return {
				targetId,
				attempted: targetTrials.length,
				succeeded: targetTrials.filter((trial) => !trial.response.error).length,
				valid: targetTrials.filter(isValid).length,
				quality: {
					attempted: quality.length,
					passed: qualityPassed,
					score: quality.length === 0 ? null : qualityPassed / quality.length,
				},
				referenceAgreement: createAgreement(
					measured,
					targetId,
					referenceTargetId,
				),
				performance: metrics(validPerformance),
			};
		},
	);
	const caseSummaries: BenchmarkCaseSummary[] = targetIds.flatMap((targetId) =>
		caseIds.map((caseId) => {
			const caseTrials = measured.filter(
				(trial) => trial.targetId === targetId && trial.caseId === caseId,
			);
			const validTrials = caseTrials.filter(isValid);
			return {
				targetId,
				caseId,
				attempted: caseTrials.length,
				succeeded: caseTrials.filter((trial) => !trial.response.error).length,
				valid: validTrials.length,
				metrics: metrics(validTrials),
			};
		}),
	);
	return { targets: targetSummaries, cases: caseSummaries };
}

async function runWithConcurrency<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let cursor = 0;
	const runWorker = async (): Promise<void> => {
		for (;;) {
			const index = cursor++;
			if (index >= items.length) {
				return;
			}
			await worker(items[index]);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, () =>
			runWorker(),
		),
	);
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
	const includeResponses = options.includeResponses ?? true;
	const fetchImplementation = options.fetch ?? globalThis.fetch;
	const referenceTargetId = options.referenceTargetId ?? options.targets[0].id;
	if (!options.targets.some((target) => target.id === referenceTargetId)) {
		throw new Error(`Unknown reference target: ${referenceTargetId}`);
	}
	const started = performance.now();
	const startedAt = new Date().toISOString();
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
		for (let sequence = 0; sequence < warmupRuns + runs; sequence++) {
			const warmup = sequence < warmupRuns;
			const run = warmup ? sequence + 1 : sequence - warmupRuns + 1;
			const context: BenchmarkRunContext = {
				caseId: group.caseDefinition.id,
				run,
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
					evaluation = group.caseDefinition.evaluate(response, context);
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
				run,
				warmup,
				response: includeResponses ? response : stripResponse(response),
				evaluation,
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
		}
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
		schemaVersion: 1,
		startedAt,
		finishedAt,
		durationMs: performance.now() - started,
		config: {
			url: options.client.url,
			runs: options.runs ?? null,
			warmupRuns: options.warmupRuns ?? null,
			concurrency,
			timeoutMs,
			includeResponses,
			referenceTargetId,
			disableCache: options.client.disableCache ?? true,
			disableFallback: options.client.disableFallback ?? true,
			request: options.request ?? {},
		},
		targets: options.targets,
		cases: options.cases.map(({ id, name, kind, category, description }) => ({
			id,
			name,
			kind,
			category,
			description,
		})),
		summary: summarize(
			trials,
			options.targets.map((target) => target.id),
			options.cases.map((caseDefinition) => caseDefinition.id),
			referenceTargetId,
		),
		trials,
	};
}
