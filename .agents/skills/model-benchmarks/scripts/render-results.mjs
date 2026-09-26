#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { renderBenchmarkResult } from "../../../../packages/benchmarks/dist/src/reporters.js";
import { summarizeNumbers } from "../../../../packages/benchmarks/dist/src/statistics.js";

function formatNumber(value) {
	return value === null || value === undefined ? "—" : value.toFixed(1);
}

function formatRate(numerator, denominator) {
	return denominator === 0
		? "—"
		: `${numerator}/${denominator} (${((numerator / denominator) * 100).toFixed(1)}%)`;
}

function csvCell(value) {
	if (value === null || value === undefined) {
		return "";
	}
	const text = String(value);
	return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const jsonArgument = process.argv[2];
if (!jsonArgument || process.argv.length !== 3) {
	throw new Error("Usage: render-results.mjs <benchmark.json>");
}

const jsonPath = resolve(jsonArgument);
const result = JSON.parse(await readFile(jsonPath, "utf8"));
if (
	!Array.isArray(result.targets) ||
	!Array.isArray(result.cases) ||
	!Array.isArray(result.trials)
) {
	throw new Error(`${jsonPath} is not a benchmark result`);
}

const stem = jsonPath.slice(0, -extname(jsonPath).length);
const markdownPath = `${stem}.md`;
const htmlPath = `${stem}.html`;
const timingsMarkdownPath = `${stem}-timings.md`;
const timingsCsvPath = `${stem}-timings.csv`;

const measuredTrials = result.trials.filter((trial) => !trial.warmup);
const timingRows = [];
for (const target of result.targets) {
	for (const benchmarkCase of result.cases) {
		const trials = measuredTrials.filter(
			(trial) =>
				trial.targetId === target.id && trial.caseId === benchmarkCase.id,
		);
		if (trials.length === 0) {
			continue;
		}
		const successful = trials.filter(
			(trial) => !trial.response.error && trial.response.timing,
		);
		const evaluated = trials.filter(
			(trial) => typeof trial.evaluation?.passed === "boolean",
		);
		const metric = (key) =>
			summarizeNumbers(successful.map((trial) => trial.response.timing[key]));
		const buffered = successful.filter(
			(trial) => trial.response.timing.buffered,
		).length;
		timingRows.push(
			[
				target.id,
				benchmarkCase.id,
				formatRate(successful.length, trials.length),
				formatRate(
					evaluated.filter((trial) => trial.evaluation.passed).length,
					evaluated.length,
				),
				formatNumber(metric("headersMs")?.p50),
				formatNumber(metric("firstContentMs")?.p50),
				formatNumber(metric("firstContentMs")?.p90),
				formatNumber(metric("totalMs")?.p50),
				formatNumber(metric("totalMs")?.p90),
				formatNumber(metric("visibleTokensPerSecond")?.p50),
				formatNumber(metric("maxContentStallMs")?.p50),
				formatRate(buffered, successful.length),
			].join(" | "),
		);
	}
}

const timingsMarkdown = `# Benchmark timings

Started: ${result.startedAt}

Finished: ${result.finishedAt}

These aggregates include every successful measured response with timing data,
even when its evaluator failed. The built-in report only aggregates valid
trials.

| Target | Case | Request success | Evaluation pass | Headers p50 ms | TTFT p50 ms | TTFT p90 ms | Total p50 ms | Total p90 ms | Visible tok/s p50 | Stall p50 ms | Buffered |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${timingRows.map((row) => `| ${row} |`).join("\n")}
`;

const csvHeaders = [
	"targetId",
	"caseId",
	"run",
	"warmup",
	"evaluationPassed",
	"responseError",
	"finishReason",
	"promptTokens",
	"completionTokens",
	"reasoningTokens",
	"estimatedCostUsd",
	"headersMs",
	"firstEventMs",
	"firstReasoningMs",
	"firstContentMs",
	"generationMs",
	"totalMs",
	"visibleTokensPerSecond",
	"maxContentStallMs",
	"averageContentChunkCharacters",
	"finalContentBurstRatio",
	"buffered",
	"contentChunkCount",
];
const timingsCsv = [
	csvHeaders.join(","),
	...result.trials.map((trial) => {
		const timing = trial.response.timing;
		return [
			trial.targetId,
			trial.caseId,
			trial.run,
			trial.warmup,
			trial.evaluation?.passed,
			trial.response.error?.message,
			trial.response.finishReason,
			trial.response.usage.promptTokens,
			trial.response.usage.completionTokens,
			trial.response.usage.reasoningTokens,
			trial.estimatedCostUsd,
			timing?.headersMs,
			timing?.firstEventMs,
			timing?.firstReasoningMs,
			timing?.firstContentMs,
			timing?.generationMs,
			timing?.totalMs,
			timing?.visibleTokensPerSecond,
			timing?.maxContentStallMs,
			timing?.averageContentChunkCharacters,
			timing?.finalContentBurstRatio,
			timing?.buffered,
			timing?.contentChunkCount,
		]
			.map(csvCell)
			.join(",");
	}),
].join("\n");

await Promise.all([
	writeFile(markdownPath, renderBenchmarkResult(result, "markdown")),
	writeFile(htmlPath, renderBenchmarkResult(result, "html")),
	writeFile(timingsMarkdownPath, timingsMarkdown),
	writeFile(timingsCsvPath, `${timingsCsv}\n`),
]);

process.stdout.write(
	`${[jsonPath, markdownPath, htmlPath, timingsMarkdownPath, timingsCsvPath].join("\n")}\n`,
);
