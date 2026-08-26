import type {
	BenchmarkOutputFormat,
	BenchmarkResult,
	BenchmarkTargetSummary,
	NumericSummary,
} from "./types.js";

function formatNumber(
	summary: NumericSummary | null,
	field: "mean" | "p50" | "p90" = "p50",
): string {
	return summary ? summary[field].toFixed(1) : "—";
}

function formatValue(value: number | null, digits = 1): string {
	return value === null ? "—" : value.toFixed(digits);
}

function formatPercent(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatCost(value: number | null): string {
	return value === null ? "—" : `$${value.toPrecision(4)}`;
}

function markdownCell(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("|", "\\|")
		.replaceAll("\n", " ");
}

function summaryRow(
	result: BenchmarkResult,
	summary: BenchmarkTargetSummary,
): string[] {
	const target = result.targets.find(
		(candidate) => candidate.id === summary.targetId,
	);
	return [
		target?.displayName ?? summary.targetId,
		formatPercent(summary.reliability.successRate),
		`${summary.quality.passed}/${summary.quality.attempted}`,
		formatPercent(summary.quality.score),
		formatPercent(summary.quality.consistencyRate),
		formatPercent(summary.referenceAgreement?.rate ?? null),
		formatPercent(summary.fingerprint?.behavioralSimilarity ?? null),
		formatNumber(summary.performance.ttftMs),
		formatNumber(summary.performance.ttftMs, "p90"),
		formatNumber(summary.performance.totalMs),
		formatNumber(summary.performance.visibleTokensPerSecond),
		formatPercent(summary.performance.bufferedRate),
		formatCost(summary.efficiency.costPerCorrectAnswerUsd),
	];
}

const SUMMARY_HEADERS = [
	"Target",
	"Success",
	"Quality",
	"Score",
	"Consistency",
	"Reference agreement",
	"Behavioral similarity",
	"TTFT p50 (ms)",
	"TTFT p90 (ms)",
	"Total p50 (ms)",
	"Visible tok/s p50",
	"Buffered",
	"Cost/correct",
];

export function renderMarkdown(result: BenchmarkResult): string {
	const lines = [
		"# Model benchmark",
		"",
		`Started: ${result.startedAt}`,
		`Finished: ${result.finishedAt}`,
		`Reference: ${result.config.referenceTargetId ?? "—"}`,
		`Budget per target: ${result.config.budgetMs === null ? "unlimited" : `${result.config.budgetMs} ms`}`,
		`Seed: ${result.config.seed}`,
		"",
		"## Summary",
		"",
		`| ${SUMMARY_HEADERS.join(" | ")} |`,
		`| ${SUMMARY_HEADERS.map((_, index) => (index === 0 ? "---" : "---:")).join(" | ")} |`,
	];
	for (const summary of result.summary.targets) {
		lines.push(
			`| ${summaryRow(result, summary).map(markdownCell).join(" | ")} |`,
		);
	}

	lines.push(
		"",
		"## Capability dimensions",
		"",
		"| Target | Dimension | Passed | Score |",
		"| --- | --- | ---: | ---: |",
	);
	for (const summary of result.summary.dimensions) {
		lines.push(
			`| ${[summary.targetId, summary.key, `${summary.passed}/${summary.attempted}`, formatPercent(summary.score)].map(markdownCell).join(" | ")} |`,
		);
	}

	lines.push(
		"",
		"## Cases",
		"",
		"| Target | Case | Valid | Score | TTFT p50 (ms) | Total p50 (ms) | Visible tok/s p50 | RPS |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
	);
	for (const summary of result.summary.cases) {
		lines.push(
			`| ${[
				summary.targetId,
				summary.caseId,
				`${summary.valid}/${summary.attempted}`,
				formatPercent(summary.quality.score),
				formatNumber(summary.metrics.ttftMs),
				formatNumber(summary.metrics.totalMs),
				formatNumber(summary.metrics.visibleTokensPerSecond),
				formatValue(summary.achievedRequestsPerSecond),
			]
				.map(markdownCell)
				.join(" | ")} |`,
		);
	}

	const loadPoints = result.summary.load.flatMap((summary) =>
		summary.points.map((point) => ({ targetId: summary.targetId, ...point })),
	);
	if (loadPoints.length > 0) {
		lines.push(
			"",
			"## Load",
			"",
			"| Target | Concurrency | Success | RPS | TTFT p50 (ms) | Total p50 (ms) | Latency degradation |",
			"| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
		);
		for (const point of loadPoints) {
			lines.push(
				`| ${[
					point.targetId,
					String(point.concurrency),
					formatPercent(point.successRate),
					formatValue(point.achievedRequestsPerSecond),
					formatValue(point.ttftP50Ms),
					formatValue(point.totalP50Ms),
					point.latencyDegradation === null
						? "—"
						: `${point.latencyDegradation.toFixed(2)}x`,
				]
					.map(markdownCell)
					.join(" | ")} |`,
			);
		}
	}

	const errors = result.trials.filter((trial) => trial.response.error);
	if (errors.length > 0) {
		lines.push("", "## Errors", "");
		for (const trial of errors) {
			lines.push(
				`- ${trial.targetId} / ${trial.caseId} / run ${trial.run}: ${trial.response.error?.message}`,
			);
		}
	}
	return `${lines.join("\n")}\n`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function htmlCells(values: string[], tag: "td" | "th"): string {
	return values
		.map((value) => `<${tag}>${escapeHtml(value)}</${tag}>`)
		.join("");
}

export function renderHtml(result: BenchmarkResult): string {
	const summaryRows = result.summary.targets
		.map(
			(summary) => `<tr>${htmlCells(summaryRow(result, summary), "td")}</tr>`,
		)
		.join("");
	const caseRows = result.summary.cases
		.map(
			(summary) =>
				`<tr>${htmlCells(
					[
						summary.targetId,
						summary.caseId,
						`${summary.valid}/${summary.attempted}`,
						formatPercent(summary.quality.score),
						formatNumber(summary.metrics.ttftMs),
						formatNumber(summary.metrics.totalMs),
						formatNumber(summary.metrics.visibleTokensPerSecond),
						formatValue(summary.achievedRequestsPerSecond),
					],
					"td",
				)}</tr>`,
		)
		.join("");
	const dimensionRows = result.summary.dimensions
		.map(
			(summary) =>
				`<tr>${htmlCells(
					[
						summary.targetId,
						summary.key,
						`${summary.passed}/${summary.attempted}`,
						formatPercent(summary.score),
					],
					"td",
				)}</tr>`,
		)
		.join("");
	const loadRows = result.summary.load
		.flatMap((summary) =>
			summary.points.map(
				(point) =>
					`<tr>${htmlCells(
						[
							summary.targetId,
							String(point.concurrency),
							formatPercent(point.successRate),
							formatValue(point.achievedRequestsPerSecond),
							formatValue(point.ttftP50Ms),
							formatValue(point.totalP50Ms),
							point.latencyDegradation === null
								? "—"
								: `${point.latencyDegradation.toFixed(2)}x`,
						],
						"td",
					)}</tr>`,
			),
		)
		.join("");
	const errors = result.trials
		.filter((trial) => trial.response.error)
		.map(
			(trial) =>
				`<li><code>${escapeHtml(trial.targetId)}</code> / <code>${escapeHtml(trial.caseId)}</code> / run ${trial.run}: ${escapeHtml(trial.response.error?.message ?? "Unknown error")}</li>`,
		)
		.join("");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Model benchmark</title>
<style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:1600px;margin:40px auto;padding:0 20px}table{border-collapse:collapse;width:100%;margin:16px 0 32px}th,td{border:1px solid #8886;padding:8px;text-align:left}th{background:#8882}code{font-family:ui-monospace,monospace}small{color:#777}
</style>
</head>
<body>
<h1>Model benchmark</h1>
<p><small>Started ${escapeHtml(result.startedAt)} · Finished ${escapeHtml(result.finishedAt)} · Reference ${escapeHtml(result.config.referenceTargetId ?? "—")} · Budget ${result.config.budgetMs === null ? "unlimited" : `${result.config.budgetMs} ms`} · Seed ${result.config.seed}</small></p>
<h2>Summary</h2>
<table><thead><tr>${htmlCells(SUMMARY_HEADERS, "th")}</tr></thead><tbody>${summaryRows}</tbody></table>
<h2>Capability dimensions</h2>
<table><thead><tr>${htmlCells(["Target", "Dimension", "Passed", "Score"], "th")}</tr></thead><tbody>${dimensionRows}</tbody></table>
<h2>Cases</h2>
<table><thead><tr>${htmlCells(["Target", "Case", "Valid", "Score", "TTFT p50 (ms)", "Total p50 (ms)", "Visible tok/s p50", "RPS"], "th")}</tr></thead><tbody>${caseRows}</tbody></table>
${loadRows ? `<h2>Load</h2><table><thead><tr>${htmlCells(["Target", "Concurrency", "Success", "RPS", "TTFT p50 (ms)", "Total p50 (ms)", "Latency degradation"], "th")}</tr></thead><tbody>${loadRows}</tbody></table>` : ""}
${errors ? `<h2>Errors</h2><ul>${errors}</ul>` : ""}
</body>
</html>
`;
}

export function renderBenchmarkResult(
	result: BenchmarkResult,
	format: BenchmarkOutputFormat = "json",
): string {
	switch (format) {
		case "html":
			return renderHtml(result);
		case "markdown":
			return renderMarkdown(result);
		case "json":
			return `${JSON.stringify(result, null, 2)}\n`;
	}
}
