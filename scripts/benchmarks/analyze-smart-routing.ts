import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
	BenchmarkEvaluation,
	BenchmarkResponse,
} from "../../packages/benchmarks/dist/types.js";

interface Trial {
	caseId: string;
	category: string;
	arm: string;
	at: string;
	cost: number;
	storageCost: number;
	response: BenchmarkResponse;
	evaluation: BenchmarkEvaluation;
}
interface Decision {
	classifier: string;
	rubricVersion: number;
	eligibleModels: string[];
	candidateModels: string[];
	difficulty?: string;
	band?: string;
	selectedModel: string;
	classifierCost?: number;
	classifierLatencyMs?: number;
	classifierFailed: boolean;
	classifierReused?: boolean;
}
interface BillingRow {
	usedModel: string;
	cost: number | null;
	dataStorageCost: string;
	estimatedCost: boolean;
	cached: boolean;
	usedMode: string;
	hasError: boolean;
	maxTokens: number | null;
	reasoningEffort: string | null;
	duration: number;
	finishReason: string | null;
	promptTokens: string | null;
	completionTokens: string | null;
	reasoningTokens: string | null;
	cachedTokens: string | null;
	routingMetadata: { smartRouting?: Decision } | null;
}
interface Billing {
	done: boolean;
	error: string | null;
	rows: { caseId: string; arm: string; logs: BillingRow[] }[];
}
const directory = resolve(
	process.env.BENCHMARK_DIR ?? ".context/benchmarks/smart-routing",
);
const trials = readFileSync(`${directory}/trials.jsonl`, "utf8")
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line) as Trial);
const billing = JSON.parse(
	readFileSync(`${directory}/billing.json`, "utf8"),
) as Billing;
const protocol = JSON.parse(
	readFileSync(`${directory}/protocol.json`, "utf8"),
) as {
	arms: string[];
	maximumOutputTokens: number;
	fixtures: {
		id: string;
		category: string;
		request: unknown;
		arms: string[];
	}[];
};
if (!billing.done || billing.error) {
	throw new Error("Billing collection incomplete");
}
const billed = new Map(
	billing.rows.map((row) => [`${row.caseId}/${row.arm}`, row.logs]),
);
const seen = new Set<string>();
const observations = trials.map((row) => {
	const key = `${row.caseId}/${row.arm}`;
	if (seen.has(key)) {
		throw new Error(`Duplicate trial: ${key}`);
	}
	seen.add(key);
	let classifierCost = 0;
	let classifierStorageCost = 0;
	let decision: Decision | null = null;
	const logs = billed.get(key);
	if (!logs) {
		throw new Error(`Missing billing for ${key}`);
	}
	const main = logs.filter((log) => log.usedModel !== "typesafe/jev-1.13.0");
	if (main.length !== 1) {
		throw new Error(`Expected one inference row for ${key}`);
	}
	if (
		logs.some(
			(log) => log.cached || log.estimatedCost || log.usedMode !== "credits",
		)
	) {
		throw new Error(`Unexpected billing mode for ${key}`);
	}
	if (
		typeof row.response.usage.raw?.cost === "number" &&
		(Math.abs((main[0].cost ?? 0) - row.cost) > 1e-9 ||
			Math.abs(Number(main[0].dataStorageCost) - row.storageCost) > 1e-9)
	) {
		throw new Error(`Inference billing mismatch for ${key}`);
	}
	if (typeof row.response.usage.raw?.cost !== "number" && !row.response.error) {
		throw new Error(`Missing usage without a recorded request error: ${key}`);
	}
	if (main[0].cost === null && !main[0].hasError) {
		throw new Error(`Missing successful inference charge for ${key}`);
	}
	const cost = main[0].cost ?? 0;
	const storageCost = Number(main[0].dataStorageCost);
	if (row.arm === "smart") {
		decision = main[0].routingMetadata?.smartRouting ?? null;
		if (!decision) {
			throw new Error(`Missing routing decision for ${key}`);
		}
		const classifier = logs.filter(
			(log) => log.usedModel === "typesafe/jev-1.13.0",
		);
		if (
			classifier.length > 1 ||
			classifier.some((log) => log.estimatedCost || log.cost === null)
		) {
			throw new Error(`Ambiguous classifier billing for ${row.caseId}`);
		}
		classifierCost = classifier.reduce((sum, log) => sum + (log.cost ?? 0), 0);
		classifierStorageCost = classifier.reduce(
			(sum, log) => sum + Number(log.dataStorageCost),
			0,
		);
		if (Math.abs(classifierCost - (decision.classifierCost ?? 0)) > 1e-9) {
			throw new Error(`Classifier billing mismatch for ${row.caseId}`);
		}
	}
	const numericId = Number(row.caseId.split("-")[1]);
	const sensitivePassed =
		row.caseId.startsWith("easy-") && numericId % 5 === 3
			? !row.response.error &&
				!["length", "incomplete"].includes(row.response.finishReason ?? "") &&
				row.response.content.trim().replace(/\.$/, "") ===
					row.evaluation.expected
			: row.evaluation.passed === true;
	return {
		...row,
		cost,
		storageCost,
		resolvedReasoningEffort: main[0].reasoningEffort,
		loggedMaxTokens: main[0].maxTokens,
		loggedModel: main[0].usedModel,
		loggedInferenceDurationMs: main[0].duration,
		loggedFinishReason: main[0].finishReason,
		billedUsage: {
			promptTokens: main[0].promptTokens,
			completionTokens: main[0].completionTokens,
			reasoningTokens: main[0].reasoningTokens,
			cachedTokens: main[0].cachedTokens,
		},
		classifierCost,
		classifierStorageCost,
		decision,
		totalCost: cost + storageCost + classifierCost + classifierStorageCost,
		sensitivePassed,
		sensitivityIncluded: row.caseId !== "ifeval-3369",
	};
});
for (const fixture of protocol.fixtures) {
	for (const arm of protocol.arms) {
		if (!seen.has(`${fixture.id}/${arm}`)) {
			throw new Error(`Incomplete pair: ${fixture.id}/${arm}`);
		}
	}
}
function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
function quantile(values: number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	const index = (sorted.length - 1) * p;
	const lower = Math.floor(index);
	const interpolated =
		(sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
	return sorted[lower] + interpolated;
}
const reference = "gpt-6-astra";
const referenceCost = sum(
	observations
		.filter((row) => row.arm === reference)
		.map((row) => row.totalCost),
);
const summaries = protocol.arms.map((arm) => {
	const rows = observations.filter((row) => row.arm === arm);
	const total = sum(rows.map((row) => row.totalCost));
	const passed = rows.filter((row) => row.evaluation.passed).length;
	return {
		arm,
		n: rows.length,
		passed,
		accuracy: passed / rows.length,
		costIndex: (total / referenceCost) * 100,
		costPerPassIndex: passed
			? (total /
					passed /
					(referenceCost /
						observations.filter(
							(row) => row.arm === reference && row.evaluation.passed,
						).length)) *
				100
			: null,
		classifierCostShare:
			sum(rows.map((row) => row.classifierCost + row.classifierStorageCost)) /
			total,
		inferenceCost: sum(rows.map((row) => row.cost)),
		storageCost: sum(
			rows.map((row) => row.storageCost + row.classifierStorageCost),
		),
		classifierCost: sum(rows.map((row) => row.classifierCost)),
		totalCost: total,
		sensitivityPassed: rows.filter(
			(row) => row.sensitivityIncluded && row.sensitivePassed,
		).length,
		sensitivityN: rows.filter((row) => row.sensitivityIncluded).length,
		errors: rows.filter((row) => row.response.error).length,
		truncated: rows.filter((row) =>
			["length", "incomplete"].includes(row.response.finishReason ?? ""),
		).length,
		medianSeconds: quantile(
			rows.map((row) => row.response.timing.totalMs / 1000),
			0.5,
		),
		p95Seconds: quantile(
			rows.map((row) => row.response.timing.totalMs / 1000),
			0.95,
		),
		medianFirstContentSeconds: quantile(
			rows
				.map((row) => row.response.timing.firstContentMs)
				.filter((n): n is number => n !== null)
				.map((n) => n / 1000),
			0.5,
		),
		groups: ["easy", "reasoning", "ifeval"].map((group) => {
			const selected = rows.filter(
				(row) =>
					(row.category === "easy" || row.category === "ifeval"
						? row.category
						: "reasoning") === group,
			);
			return {
				group,
				n: selected.length,
				passed: selected.filter((row) => row.evaluation.passed).length,
				costIndex:
					(sum(selected.map((row) => row.totalCost)) / referenceCost) * 100,
			};
		}),
	};
});
let state = 20260926;
function random(): number {
	state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
	return state / 4294967296;
}
const strata = ["easy", "reasoning", "ifeval"].map((group) =>
	protocol.fixtures
		.filter(
			(row) =>
				(row.category === "easy" || row.category === "ifeval"
					? row.category
					: "reasoning") === group,
		)
		.map((row) => row.id),
);
const lookup = new Map(
	observations.map((row) => [`${row.caseId}/${row.arm}`, row]),
);
const comparisons = protocol.arms
	.filter((arm) => arm !== "smart")
	.map((arm) => {
		const smart = summaries.find((row) => row.arm === "smart")!;
		const baseline = summaries.find((row) => row.arm === arm)!;
		const costSamples: number[] = [];
		const scoreSamples: number[] = [];
		for (let repeat = 0; repeat < 10000; repeat++) {
			const ids = strata.flatMap((stratum) =>
				stratum.map(() => stratum[Math.floor(random() * stratum.length)]),
			);
			const pairs = ids.map((id) => [
				lookup.get(`${id}/smart`)!,
				lookup.get(`${id}/${arm}`)!,
			]);
			const costRatio =
				sum(pairs.map(([a]) => a.totalCost)) /
				sum(pairs.map(([, b]) => b.totalCost));
			costSamples.push(100 * (1 - costRatio));
			scoreSamples.push(
				(100 *
					sum(
						pairs.map(
							([a, b]) =>
								Number(a.evaluation.passed) - Number(b.evaluation.passed),
						),
					)) /
					ids.length,
			);
		}
		const costRatio = smart.totalCost / baseline.totalCost;
		return {
			arm,
			savingPercent: 100 * (1 - costRatio),
			savingCI95: [quantile(costSamples, 0.025), quantile(costSamples, 0.975)],
			scoreDifferencePoints: 100 * (smart.accuracy - baseline.accuracy),
			scoreDifferenceCI95: [
				quantile(scoreSamples, 0.025),
				quantile(scoreSamples, 0.975),
			],
		};
	});
const routing = observations
	.filter((row) => row.arm === "smart")
	.map((row) => ({ caseId: row.caseId, ...row.decision }));
const report = {
	maximumOutputTokens: protocol.maximumOutputTokens,
	measuredRequests: observations.length,
	promptCount: protocol.fixtures.length,
	firstRequest: observations[0].at,
	lastRequest: observations.at(-1)!.at,
	totalCost: sum(summaries.map((row) => row.totalCost)),
	summaries,
	comparisons,
	routing,
};
writeFileSync(
	`${directory}/analysis-private.json`,
	JSON.stringify(report, null, 2),
);
const publicReport = {
	version: 1,
	referenceCostIndex: { arm: reference, total: 100 },
	maximumOutputTokens: report.maximumOutputTokens,
	measuredRequests: report.measuredRequests,
	promptCount: report.promptCount,
	firstRequest: report.firstRequest,
	lastRequest: report.lastRequest,
	methodology: {
		pairedBootstrapReplicates: 10000,
		bootstrapSeed: 20260926,
		strata: [25, 15, 40],
		costIncludes: [
			"Inference",
			"Separate classifier charge",
			"Storage for both rows",
		],
		scoring: "Original strict scoring plus documented ambiguity sensitivity",
		sourceRevision: "733b8212c",
		ifevalRevision: "d36068b845da4c2b24927fee2cea1e6ef98dadda",
	},
	summaries: summaries.map(
		({
			inferenceCost: _inferenceCost,
			storageCost: _storageCost,
			classifierCost: _classifierCost,
			totalCost: _totalCost,
			...row
		}) => row,
	),
	comparisons,
	trials: observations.map((row) => ({
		caseId: row.caseId,
		category: row.category,
		arm: row.arm,
		at: row.at,
		model: row.response.responseModel,
		loggedModel: row.loggedModel,
		content: row.response.content,
		evaluation: row.evaluation,
		sensitivityPassed: row.sensitivePassed,
		sensitivityIncluded: row.sensitivityIncluded,
		costIndex: (row.totalCost / referenceCost) * 100,
		classifierCostIndex:
			((row.classifierCost + row.classifierStorageCost) / referenceCost) * 100,
		promptTokens: row.response.usage.promptTokens,
		completionTokens: row.response.usage.completionTokens,
		reasoningTokens: row.response.usage.reasoningTokens,
		cachedInputTokens:
			(
				row.response.usage.raw?.prompt_tokens_details as
					{ cached_tokens?: number } | undefined
			)?.cached_tokens ?? null,
		finishReason: row.response.finishReason,
		resolvedReasoningEffort: row.resolvedReasoningEffort,
		loggedMaxTokens: row.loggedMaxTokens,
		loggedInferenceDurationMs: row.loggedInferenceDurationMs,
		loggedFinishReason: row.loggedFinishReason,
		billedUsage: row.billedUsage,
		timing: row.response.timing,
		error: row.response.error ? { code: row.response.error.code } : null,
		routing: row.decision
			? {
					classifier: row.decision.classifier,
					rubricVersion: row.decision.rubricVersion,
					eligibleModels: row.decision.eligibleModels,
					candidateModels: row.decision.candidateModels,
					difficulty: row.decision.difficulty,
					band: row.decision.band,
					selectedModel: row.decision.selectedModel,
					classifierLatencyMs: row.decision.classifierLatencyMs,
					classifierFailed: row.decision.classifierFailed,
					classifierReused: row.decision.classifierReused ?? false,
				}
			: null,
	})),
};
writeFileSync(
	`${directory}/results-public.json`,
	JSON.stringify(publicReport, null, 2),
);
process.stdout.write(
	JSON.stringify(
		{ summaries, comparisons, totalCost: report.totalCost },
		null,
		2,
	) + "\n",
);
