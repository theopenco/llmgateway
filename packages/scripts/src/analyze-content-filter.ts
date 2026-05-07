/**
 * Content filter analyzer.
 *
 * Purpose:
 * - Compare gateway moderation signals against downstream
 *   `unified_finish_reason=content_filter`.
 * - Explain why a specific row was missed by the current gateway rule.
 * - Sweep alternative thresholding strategies and report their precision/recall.
 *
 * Expected CSV columns:
 * - `id`
 * - `requested_model`
 * - `used_model`
 * - `cost`
 * - `prompt_tokens`
 * - `cached_tokens`
 * - `completion_tokens`
 * - `unified_finish_reason`
 * - `image_output_tokens`
 * - `internal_content_filter`
 * - `gateway_content_filter_response`
 *
 * The `gateway_content_filter_response` field must contain a JSON moderation
 * payload or an array of moderation payloads with `results[].flagged` and
 * `results[].category_scores`.
 *
 * Usage:
 * - `pnpm --filter @llmgateway/scripts analyze-content-filter --file /abs/path/to/contentfiltered.csv`
 * - `pnpm --filter @llmgateway/scripts analyze-content-filter --file /abs/path/to/contentfiltered.csv --id <row-id>`
 *
 * Output:
 * - Metrics for the current `any score > threshold` rule.
 * - Metrics for `flagged === true`.
 * - The best global threshold under a false-positive budget.
 * - Per-category thresholds under the same false-positive budget.
 * - Top current false negatives and false positives for inspection.
 */
/* eslint-disable no-console */

import { readFileSync } from "node:fs";
import path from "node:path";

interface CliOptions {
	filePath: string;
	currentThreshold: number;
	maxFalsePositives: number;
	topRows: number;
	inspectId: string | null;
}

interface CsvRow {
	id: string;
	requested_model: string;
	used_model: string;
	cost: string;
	prompt_tokens: string;
	cached_tokens: string;
	completion_tokens: string;
	unified_finish_reason: string;
	image_output_tokens: string;
	internal_content_filter: string;
	gateway_content_filter_response: string;
}

interface ModerationResult {
	flagged?: boolean;
	category_scores?: Record<string, number>;
}

interface ModerationResponse {
	id?: string;
	model?: string;
	results?: ModerationResult[];
}

interface AnalyzedRow {
	id: string;
	requestedModel: string;
	usedModel: string;
	unifiedFinishReason: string;
	isContentFiltered: boolean;
	internalContentFilter: boolean | null;
	responseAvailable: boolean;
	responses: ModerationResponse[] | null;
	anyFlagged: boolean;
	maxScoreOverall: number | null;
	categoryMaxScores: Map<string, number>;
}

interface Metrics {
	truePositives: number;
	falsePositives: number;
	trueNegatives: number;
	falseNegatives: number;
	precision: number | null;
	recall: number;
	f1: number | null;
	predictedPositiveCount: number;
	actualPositiveCount: number;
}

interface RuleEvaluation {
	name: string;
	description: string;
	metrics: Metrics;
}

interface ThresholdEvaluation {
	threshold: number;
	metrics: Metrics;
}

interface CategoryRecommendation {
	category: string;
	threshold: number;
	truePositives: number;
	falsePositives: number;
	positiveSupport: number;
	negativeSupport: number;
	currentTruePositives: number;
}

const REQUIRED_HEADERS = [
	"id",
	"requested_model",
	"used_model",
	"cost",
	"prompt_tokens",
	"cached_tokens",
	"completion_tokens",
	"unified_finish_reason",
	"image_output_tokens",
	"internal_content_filter",
	"gateway_content_filter_response",
] as const;

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_MAX_FALSE_POSITIVES = 0;
const DEFAULT_TOP_ROWS = 10;
const RULE_PREFERENCE_ORDER: Record<string, number> = {
	current_rule: 0,
	flagged_boolean: 1,
	best_global_threshold: 2,
	per_category_zero_fp: 3,
	flagged_or_threshold: 4,
};

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
	let filePath = "";
	let currentThreshold = DEFAULT_THRESHOLD;
	let maxFalsePositives = DEFAULT_MAX_FALSE_POSITIVES;
	let topRows = DEFAULT_TOP_ROWS;
	let inspectId: string | null = null;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const nextArg = argv[index + 1];

		if (arg === "--file" || arg === "-f") {
			if (!nextArg) {
				fail("Missing value for --file");
			}
			filePath = nextArg;
			index += 1;
			continue;
		}

		if (arg === "--threshold") {
			if (!nextArg) {
				fail("Missing value for --threshold");
			}
			currentThreshold = parseNumberArg(nextArg, "--threshold");
			index += 1;
			continue;
		}

		if (arg === "--max-false-positives") {
			if (!nextArg) {
				fail("Missing value for --max-false-positives");
			}
			maxFalsePositives = parseIntegerArg(nextArg, "--max-false-positives");
			index += 1;
			continue;
		}

		if (arg === "--top") {
			if (!nextArg) {
				fail("Missing value for --top");
			}
			topRows = parseIntegerArg(nextArg, "--top");
			index += 1;
			continue;
		}

		if (arg === "--id") {
			if (!nextArg) {
				fail("Missing value for --id");
			}
			inspectId = nextArg;
			index += 1;
			continue;
		}

		if (arg.startsWith("-")) {
			fail(`Unknown argument: ${arg}`);
		}

		if (filePath.length === 0) {
			filePath = arg;
			continue;
		}

		fail(`Unexpected positional argument: ${arg}`);
	}

	if (filePath.length === 0) {
		fail(
			"Usage: pnpm --filter @llmgateway/scripts analyze-content-filter --file path/to/contentfiltered.csv [--id row-id] [--threshold 0.8] [--max-false-positives 0] [--top 10]",
		);
	}

	if (currentThreshold < 0 || currentThreshold > 1) {
		fail("--threshold must be between 0 and 1");
	}

	if (maxFalsePositives < 0) {
		fail("--max-false-positives must be >= 0");
	}

	if (topRows <= 0) {
		fail("--top must be >= 1");
	}

	return {
		filePath: path.resolve(filePath),
		currentThreshold,
		maxFalsePositives,
		topRows,
		inspectId,
	};
}

function parseNumberArg(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		fail(`${name} must be a number`);
	}
	return parsed;
}

function parseIntegerArg(value: string, name: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		fail(`${name} must be an integer`);
	}
	return parsed;
}

function parseCsv(content: string): string[][] {
	const rows: string[][] = [];
	let currentRow: string[] = [];
	let currentCell = "";
	let inQuotes = false;
	let index = 0;

	const normalizedContent =
		content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

	while (index < normalizedContent.length) {
		const character = normalizedContent[index];

		if (inQuotes) {
			if (character === '"') {
				if (normalizedContent[index + 1] === '"') {
					currentCell += '"';
					index += 2;
					continue;
				}

				inQuotes = false;
				index += 1;
				continue;
			}

			currentCell += character;
			index += 1;
			continue;
		}

		if (character === '"') {
			inQuotes = true;
			index += 1;
			continue;
		}

		if (character === ",") {
			currentRow.push(currentCell);
			currentCell = "";
			index += 1;
			continue;
		}

		if (character === "\n") {
			currentRow.push(currentCell);
			rows.push(currentRow);
			currentRow = [];
			currentCell = "";
			index += 1;
			continue;
		}

		if (character === "\r") {
			index += 1;
			continue;
		}

		currentCell += character;
		index += 1;
	}

	if (currentCell.length > 0 || currentRow.length > 0) {
		currentRow.push(currentCell);
		rows.push(currentRow);
	}

	return rows.filter((row) => row.some((cell) => cell.length > 0));
}

function toCsvRows(data: string[][]): CsvRow[] {
	if (data.length === 0) {
		fail("CSV is empty");
	}

	const header = data[0];
	for (const requiredHeader of REQUIRED_HEADERS) {
		if (!header.includes(requiredHeader)) {
			fail(`Missing required column: ${requiredHeader}`);
		}
	}

	const indexes = new Map(header.map((column, index) => [column, index]));

	return data.slice(1).map((row) => {
		const getValue = (column: (typeof REQUIRED_HEADERS)[number]): string =>
			row[indexes.get(column) ?? -1] ?? "";

		return {
			id: getValue("id"),
			requested_model: getValue("requested_model"),
			used_model: getValue("used_model"),
			cost: getValue("cost"),
			prompt_tokens: getValue("prompt_tokens"),
			cached_tokens: getValue("cached_tokens"),
			completion_tokens: getValue("completion_tokens"),
			unified_finish_reason: getValue("unified_finish_reason"),
			image_output_tokens: getValue("image_output_tokens"),
			internal_content_filter: getValue("internal_content_filter"),
			gateway_content_filter_response: getValue(
				"gateway_content_filter_response",
			),
		};
	});
}

function parseBoolean(value: string): boolean | null {
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") {
		return true;
	}
	if (normalized === "false") {
		return false;
	}
	return null;
}

function parseGatewayResponses(value: string): ModerationResponse[] | null {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed === "null") {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (Array.isArray(parsed)) {
			return parsed as ModerationResponse[];
		}

		if (typeof parsed === "string") {
			const nested = JSON.parse(parsed) as unknown;
			if (Array.isArray(nested)) {
				return nested as ModerationResponse[];
			}
		}
	} catch {
		return null;
	}

	return null;
}

function analyzeRow(row: CsvRow): AnalyzedRow {
	const responses = parseGatewayResponses(row.gateway_content_filter_response);
	const categoryMaxScores = new Map<string, number>();
	let anyFlagged = false;
	let maxScoreOverall: number | null = null;

	for (const response of responses ?? []) {
		for (const result of response.results ?? []) {
			if (result.flagged === true) {
				anyFlagged = true;
			}

			for (const [category, score] of Object.entries(
				result.category_scores ?? {},
			)) {
				if (!Number.isFinite(score)) {
					continue;
				}

				const previousScore = categoryMaxScores.get(category);
				if (previousScore === undefined || score > previousScore) {
					categoryMaxScores.set(category, score);
				}

				if (maxScoreOverall === null || score > maxScoreOverall) {
					maxScoreOverall = score;
				}
			}
		}
	}

	return {
		id: row.id,
		requestedModel: row.requested_model,
		usedModel: row.used_model,
		unifiedFinishReason: row.unified_finish_reason,
		isContentFiltered: row.unified_finish_reason === "content_filter",
		internalContentFilter: parseBoolean(row.internal_content_filter),
		responseAvailable: responses !== null,
		responses,
		anyFlagged,
		maxScoreOverall,
		categoryMaxScores,
	};
}

function calculateMetrics(
	rows: AnalyzedRow[],
	predict: (row: AnalyzedRow) => boolean,
): Metrics {
	let truePositives = 0;
	let falsePositives = 0;
	let trueNegatives = 0;
	let falseNegatives = 0;

	for (const row of rows) {
		const predicted = predict(row);
		const actual = row.isContentFiltered;

		if (predicted && actual) {
			truePositives += 1;
			continue;
		}

		if (predicted && !actual) {
			falsePositives += 1;
			continue;
		}

		if (!predicted && actual) {
			falseNegatives += 1;
			continue;
		}

		trueNegatives += 1;
	}

	const predictedPositiveCount = truePositives + falsePositives;
	const actualPositiveCount = truePositives + falseNegatives;
	const precision =
		predictedPositiveCount === 0
			? null
			: truePositives / predictedPositiveCount;
	const recall =
		actualPositiveCount === 0 ? 0 : truePositives / actualPositiveCount;
	const f1 =
		precision === null || precision + recall === 0
			? null
			: (2 * precision * recall) / (precision + recall);

	return {
		truePositives,
		falsePositives,
		trueNegatives,
		falseNegatives,
		precision,
		recall,
		f1,
		predictedPositiveCount,
		actualPositiveCount,
	};
}

function evaluateThresholdSweep(
	rows: AnalyzedRow[],
	scoreForRow: (row: AnalyzedRow) => number | null,
	maxFalsePositives: number,
): ThresholdEvaluation[] {
	const thresholdValues = new Set<number>([0, 1]);

	for (const row of rows) {
		const score = scoreForRow(row);
		if (score !== null) {
			thresholdValues.add(score);
		}
	}

	return [...thresholdValues]
		.sort((left, right) => left - right)
		.map((threshold) => ({
			threshold,
			metrics: calculateMetrics(rows, (row) => {
				const score = scoreForRow(row);
				return score !== null && score > threshold;
			}),
		}))
		.filter(
			(evaluation) =>
				evaluation.metrics.falsePositives <= maxFalsePositives,
		);
}

function pickBestThreshold(
	evaluations: ThresholdEvaluation[],
): ThresholdEvaluation | null {
	if (evaluations.length === 0) {
		return null;
	}

	return evaluations.reduce((best, current) => {
		if (best === null) {
			return current;
		}

		if (current.metrics.truePositives !== best.metrics.truePositives) {
			return current.metrics.truePositives > best.metrics.truePositives
				? current
				: best;
		}

		if (current.metrics.falsePositives !== best.metrics.falsePositives) {
			return current.metrics.falsePositives < best.metrics.falsePositives
				? current
				: best;
		}

		return current.threshold > best.threshold ? current : best;
	}, null as ThresholdEvaluation | null);
}

function getCurrentRuleMetrics(
	rows: AnalyzedRow[],
	currentThreshold: number,
): RuleEvaluation {
	return {
		name: "current_rule",
		description: `Any category score > ${formatNumber(currentThreshold)}`,
		metrics: calculateMetrics(
			rows,
			(row) => row.maxScoreOverall !== null && row.maxScoreOverall > currentThreshold,
		),
	};
}

function getFlaggedRuleMetrics(rows: AnalyzedRow[]): RuleEvaluation {
	return {
		name: "flagged_boolean",
		description: "Any moderation result flagged === true",
		metrics: calculateMetrics(rows, (row) => row.anyFlagged),
	};
}

function getFlaggedOrThresholdRuleMetrics(
	rows: AnalyzedRow[],
	currentThreshold: number,
): RuleEvaluation {
	return {
		name: "flagged_or_threshold",
		description: `flagged === true OR any category score > ${formatNumber(
			currentThreshold,
		)}`,
		metrics: calculateMetrics(
			rows,
			(row) =>
				row.anyFlagged ||
				(row.maxScoreOverall !== null && row.maxScoreOverall > currentThreshold),
		),
	};
}

function getAllCategories(rows: AnalyzedRow[]): string[] {
	const categories = new Set<string>();

	for (const row of rows) {
		for (const category of row.categoryMaxScores.keys()) {
			categories.add(category);
		}
	}

	return [...categories].sort((left, right) => left.localeCompare(right));
}

function getCategoryRecommendations(
	rows: AnalyzedRow[],
	currentThreshold: number,
): CategoryRecommendation[] {
	return getAllCategories(rows)
		.map((category) => {
			const positiveRows = rows.filter((row) => row.isContentFiltered);
			const negativeRows = rows.filter((row) => !row.isContentFiltered);
			const positiveScores = positiveRows
				.map((row) => row.categoryMaxScores.get(category) ?? 0)
				.filter((score) => score > 0);
			const negativeScores = negativeRows
				.map((row) => row.categoryMaxScores.get(category) ?? 0)
				.filter((score) => score > 0);

			if (positiveScores.length === 0) {
				return null;
			}

			const maxNegativeScore =
				negativeScores.length === 0
					? 0
					: Math.max(...negativeScores);
			const truePositives = positiveScores.filter(
				(score) => score > maxNegativeScore,
			).length;
			const currentTruePositives = positiveScores.filter(
				(score) => score > currentThreshold,
			).length;

			if (truePositives === 0) {
				return null;
			}

			return {
				category,
				threshold: maxNegativeScore,
				truePositives,
				falsePositives: 0,
				positiveSupport: positiveScores.length,
				negativeSupport: negativeScores.length,
				currentTruePositives,
			};
		})
		.filter((recommendation) => recommendation !== null)
		.sort((left, right) => {
			if (left.truePositives !== right.truePositives) {
				return right.truePositives - left.truePositives;
			}

			return left.threshold - right.threshold;
		}) as CategoryRecommendation[];
}

function pickBestRule(
	evaluations: RuleEvaluation[],
	maxFalsePositives: number,
): RuleEvaluation | null {
	const eligibleRules = evaluations.filter(
		(evaluation) => evaluation.metrics.falsePositives <= maxFalsePositives,
	);

	if (eligibleRules.length === 0) {
		return null;
	}

	return eligibleRules.reduce((best, current) => {
		if (current.metrics.truePositives !== best.metrics.truePositives) {
			return current.metrics.truePositives > best.metrics.truePositives
				? current
				: best;
		}

		if (current.metrics.falsePositives !== best.metrics.falsePositives) {
			return current.metrics.falsePositives < best.metrics.falsePositives
				? current
				: best;
		}

		const currentPrecision = current.metrics.precision ?? 1;
		const bestPrecision = best.metrics.precision ?? 1;
		if (currentPrecision !== bestPrecision) {
			return currentPrecision > bestPrecision ? current : best;
		}

		const currentPreference = RULE_PREFERENCE_ORDER[current.name] ?? 999;
		const bestPreference = RULE_PREFERENCE_ORDER[best.name] ?? 999;
		return currentPreference < bestPreference ? current : best;
	});
}

function buildCategoryRuleThresholds(
	recommendations: CategoryRecommendation[],
): Map<string, number> {
	return new Map(
		recommendations.map((recommendation) => [
			recommendation.category,
			recommendation.threshold,
		]),
	);
}

function evaluateCategoryRule(
	rows: AnalyzedRow[],
	thresholds: Map<string, number>,
): RuleEvaluation {
	return {
		name: "per_category_zero_fp",
		description: "Per-category thresholds chosen to keep false positives at 0",
		metrics: calculateMetrics(rows, (row) => {
			for (const [category, threshold] of thresholds.entries()) {
				const score = row.categoryMaxScores.get(category);
				if (score !== undefined && score > threshold) {
					return true;
				}
			}

			return false;
		}),
	};
}

function formatPercent(value: number | null): string {
	if (value === null) {
		return "n/a";
	}
	return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number): string {
	return value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

function printMetrics(evaluation: RuleEvaluation): void {
	const { metrics } = evaluation;
	console.log(
		`${evaluation.description}\n  TP=${metrics.truePositives} FP=${metrics.falsePositives} FN=${metrics.falseNegatives} TN=${metrics.trueNegatives} precision=${formatPercent(metrics.precision)} recall=${formatPercent(metrics.recall)} f1=${formatPercent(metrics.f1)}`,
	);
}

function printRowList(title: string, rows: AnalyzedRow[], limit: number): void {
	if (rows.length === 0) {
		return;
	}

	console.log(`\n${title}`);
	for (const row of rows.slice(0, limit)) {
		const topCategories = [...row.categoryMaxScores.entries()]
			.sort((left, right) => right[1] - left[1])
			.slice(0, 3)
			.map(([category, score]) => `${category}=${formatNumber(score)}`)
			.join(", ");

		console.log(
			`  ${row.id} model=${row.requestedModel} finish=${row.unifiedFinishReason} maxScore=${row.maxScoreOverall === null ? "n/a" : formatNumber(row.maxScoreOverall)} flagged=${row.anyFlagged} response=${row.responseAvailable} categories=${topCategories || "n/a"}`,
		);
	}
}

function explainRow(row: AnalyzedRow, currentThreshold: number): void {
	console.log(`\nInspection for id=${row.id}`);
	console.log(`  requested_model=${row.requestedModel}`);
	console.log(`  used_model=${row.usedModel}`);
	console.log(`  unified_finish_reason=${row.unifiedFinishReason}`);
	console.log(`  internal_content_filter=${String(row.internalContentFilter)}`);
	console.log(`  gateway_response_logged=${String(row.responseAvailable)}`);

	if (!row.responseAvailable) {
		console.log(
			"  why_current_rule_missed_it=no gateway_content_filter_response was logged, so threshold tuning alone cannot explain or recover this row",
		);
		return;
	}

	if (row.maxScoreOverall === null) {
		console.log(
			"  why_current_rule_missed_it=gateway_content_filter_response exists but contains no category_scores",
		);
		return;
	}

	const topCategories = [...row.categoryMaxScores.entries()]
		.sort((left, right) => right[1] - left[1])
		.map(([category, score]) => `${category}=${formatNumber(score)}`)
		.join(", ");

	console.log(`  any_flagged=${String(row.anyFlagged)}`);
	console.log(`  max_score_overall=${formatNumber(row.maxScoreOverall)}`);
	console.log(`  categories=${topCategories}`);
	console.log(
		`  current_rule_predicted=${String(row.maxScoreOverall > currentThreshold)}`,
	);

	if (row.maxScoreOverall <= currentThreshold) {
		console.log(
			`  why_current_rule_missed_it=max score ${formatNumber(row.maxScoreOverall)} did not exceed threshold ${formatNumber(currentThreshold)}`,
		);
	}
}

function main(): void {
	const options = parseArgs(process.argv.slice(2));
	const fileContent = readFileSync(options.filePath, "utf8");
	const csvRows = toCsvRows(parseCsv(fileContent));
	const analyzedRows = csvRows.map(analyzeRow);
	const tunableRows = analyzedRows.filter((row) => row.responseAvailable);
	const untunablePositiveRows = analyzedRows.filter(
		(row) => row.isContentFiltered && !row.responseAvailable,
	);

	console.log(`File: ${options.filePath}`);
	console.log(`Rows: ${analyzedRows.length}`);
	console.log(
		`Content-filter rows: ${analyzedRows.filter((row) => row.isContentFiltered).length}`,
	);
	console.log(`Rows with gateway moderation payloads: ${tunableRows.length}`);
	console.log(
		`Content-filter rows without gateway payloads: ${untunablePositiveRows.length}`,
	);

	if (tunableRows.length === 0) {
		fail("No rows contain gateway_content_filter_response payloads");
	}

	const currentRule = getCurrentRuleMetrics(
		tunableRows,
		options.currentThreshold,
	);
	const flaggedRule = getFlaggedRuleMetrics(tunableRows);
	const flaggedOrThresholdRule = getFlaggedOrThresholdRuleMetrics(
		tunableRows,
		options.currentThreshold,
	);
	const globalThresholdCandidates = evaluateThresholdSweep(
		tunableRows,
		(row) => row.maxScoreOverall,
		options.maxFalsePositives,
	);
	const bestGlobalThreshold = pickBestThreshold(globalThresholdCandidates);
	const categoryRecommendations = getCategoryRecommendations(
		tunableRows,
		options.currentThreshold,
	);
	const categoryRule = evaluateCategoryRule(
		tunableRows,
		buildCategoryRuleThresholds(categoryRecommendations),
	);
	const bestGlobalRule = bestGlobalThreshold
		? {
				name: "best_global_threshold",
				description: `Best global threshold with FP <= ${options.maxFalsePositives}: any category score > ${formatNumber(bestGlobalThreshold.threshold)}`,
				metrics: bestGlobalThreshold.metrics,
			}
		: null;
	const bestRule = pickBestRule(
		[
			currentRule,
			flaggedRule,
			flaggedOrThresholdRule,
			categoryRule,
			...(bestGlobalRule ? [bestGlobalRule] : []),
		],
		options.maxFalsePositives,
	);

	console.log("\nCurrent and candidate rules");
	printMetrics(currentRule);
	printMetrics(flaggedRule);
	printMetrics(flaggedOrThresholdRule);

	if (bestGlobalRule) {
		printMetrics(bestGlobalRule);
	}

	printMetrics(categoryRule);

	if (bestRule) {
		console.log("\nRecommendation");
		console.log(`  Best rule under FP budget ${options.maxFalsePositives}:`);
		console.log(`  ${bestRule.description}`);
	}

	const currentFalseNegatives = tunableRows.filter(
		(row) =>
			row.isContentFiltered &&
			!(row.maxScoreOverall !== null && row.maxScoreOverall > options.currentThreshold),
	);
	const currentFalsePositives = tunableRows.filter(
		(row) =>
			!row.isContentFiltered &&
			row.maxScoreOverall !== null &&
			row.maxScoreOverall > options.currentThreshold,
	);
	const flaggedButMissedByThreshold = currentFalseNegatives.filter(
		(row) => row.anyFlagged,
	);

	console.log("\nCurrent rule diagnosis");
	console.log(
		`  Current false negatives with payloads: ${currentFalseNegatives.length}`,
	);
	console.log(
		`  Current false positives with payloads: ${currentFalsePositives.length}`,
	);
	console.log(
		`  Current false negatives where OpenAI already said flagged=true: ${flaggedButMissedByThreshold.length}`,
	);

	if (bestGlobalThreshold) {
		console.log(
			`  Recommended global threshold under FP budget ${options.maxFalsePositives}: ${formatNumber(bestGlobalThreshold.threshold)}`,
		);
	}

	if (categoryRecommendations.length > 0) {
		console.log("\nPer-category zero-FP thresholds");
		for (const recommendation of categoryRecommendations) {
			console.log(
				`  ${recommendation.category}: threshold>${formatNumber(recommendation.threshold)} catches ${recommendation.truePositives}/${recommendation.positiveSupport} content-filter rows at 0 FP (current >${formatNumber(options.currentThreshold)} catches ${recommendation.currentTruePositives})`,
			);
		}
	}

	printRowList(
		"Top current false negatives",
		currentFalseNegatives,
		options.topRows,
	);
	printRowList(
		"Top current false positives",
		currentFalsePositives,
		options.topRows,
	);
	printRowList(
		"Content-filter rows without gateway payloads",
		untunablePositiveRows,
		options.topRows,
	);

	if (options.inspectId) {
		const inspectedRow = analyzedRows.find((row) => row.id === options.inspectId);
		if (!inspectedRow) {
			fail(`Row id not found: ${options.inspectId}`);
		}

		explainRow(inspectedRow, options.currentThreshold);
	}
}

main();
