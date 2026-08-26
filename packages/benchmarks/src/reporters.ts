import type {
	BenchmarkOutputFormat,
	BenchmarkResult,
	BenchmarkTargetSummary,
	NumericSummary,
} from "./types.js";

function formatNumber(
	summary: NumericSummary | null,
	field: keyof Pick<NumericSummary, "mean" | "p50"> = "p50",
): string {
	return summary ? summary[field].toFixed(1) : "—";
}

function formatPercent(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
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
		`${summary.succeeded}/${summary.attempted}`,
		`${summary.valid}/${summary.attempted}`,
		`${summary.quality.passed}/${summary.quality.attempted}`,
		formatPercent(summary.quality.score),
		formatPercent(summary.referenceAgreement?.rate ?? null),
		formatNumber(summary.performance.ttftMs),
		formatNumber(summary.performance.totalMs),
		formatNumber(summary.performance.visibleTokensPerSecond),
	];
}

export function renderMarkdown(result: BenchmarkResult): string {
	const lines = [
		"# Model benchmark",
		"",
		`Started: ${result.startedAt}`,
		`Finished: ${result.finishedAt}`,
		`Reference: ${result.config.referenceTargetId ?? "—"}`,
		"",
		"## Summary",
		"",
		"| Target | Successful | Valid | Quality | Score | Reference agreement | TTFT p50 (ms) | Total p50 (ms) | Visible tok/s p50 |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
	];
	for (const summary of result.summary.targets) {
		lines.push(
			`| ${summaryRow(result, summary).map(markdownCell).join(" | ")} |`,
		);
	}

	lines.push(
		"",
		"## Cases",
		"",
		"| Target | Case | Valid | TTFT p50 (ms) | Total p50 (ms) | Visible tok/s p50 |",
		"| --- | --- | ---: | ---: | ---: | ---: |",
	);
	for (const summary of result.summary.cases) {
		lines.push(
			`| ${[
				summary.targetId,
				summary.caseId,
				`${summary.valid}/${summary.attempted}`,
				formatNumber(summary.metrics.ttftMs),
				formatNumber(summary.metrics.totalMs),
				formatNumber(summary.metrics.visibleTokensPerSecond),
			]
				.map(markdownCell)
				.join(" | ")} |`,
		);
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
						formatNumber(summary.metrics.ttftMs),
						formatNumber(summary.metrics.totalMs),
						formatNumber(summary.metrics.visibleTokensPerSecond),
					],
					"td",
				)}</tr>`,
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
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:1200px;margin:40px auto;padding:0 20px}table{border-collapse:collapse;width:100%;margin:16px 0 32px}th,td{border:1px solid #8886;padding:8px;text-align:left}th{background:#8882}code{font-family:ui-monospace,monospace}small{color:#777}
</style>
</head>
<body>
<h1>Model benchmark</h1>
<p><small>Started ${escapeHtml(result.startedAt)} · Finished ${escapeHtml(result.finishedAt)} · Reference ${escapeHtml(result.config.referenceTargetId ?? "—")}</small></p>
<h2>Summary</h2>
<table><thead><tr>${htmlCells(["Target", "Successful", "Valid", "Quality", "Score", "Reference agreement", "TTFT p50 (ms)", "Total p50 (ms)", "Visible tok/s p50"], "th")}</tr></thead><tbody>${summaryRows}</tbody></table>
<h2>Cases</h2>
<table><thead><tr>${htmlCells(["Target", "Case", "Valid", "TTFT p50 (ms)", "Total p50 (ms)", "Visible tok/s p50"], "th")}</tr></thead><tbody>${caseRows}</tbody></table>
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
