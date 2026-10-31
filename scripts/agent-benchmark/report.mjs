import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const suite = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const suiteDir = join(here, "results", suite);
const models = JSON.parse(
	readFileSync(join(here, "models.json"), "utf8"),
).models;
const agentOrder = ["empryo", "claude-code", "opencode"];

function pricesAt(model, ts) {
	const peak = model.peak;
	if (!peak) {
		return model.prices;
	}
	const date = new Date(ts);
	const offPeakDay = peak.offPeakDaysUtc?.includes(date.getUTCDay());
	const hour = date.getUTCHours();
	const inPeak =
		!offPeakDay &&
		peak.hoursUtc.some(([from, to]) => hour >= from && hour < to);
	return inPeak ? peak.prices : model.prices;
}

function requestCost(model, record) {
	const u = record.usage;
	const p = pricesAt(model, record.ts);
	const uncached = Math.max(0, u.input - u.cacheRead - u.cacheWrite);
	const creation =
		record.rawUsage?.cache_creation ??
		record.rawUsage?.prompt_tokens_details?.cache_creation;
	const write1h = Math.min(
		u.cacheWrite,
		creation?.ephemeral_1h_input_tokens ?? 0,
	);
	const write5m = u.cacheWrite - write1h;
	const writePrice = p.cacheWrite ?? p.input;
	return (
		(uncached * p.input +
			u.cacheRead * p.cacheRead +
			write5m * writePrice +
			write1h * (p.cacheWrite1h ?? writePrice) +
			u.output * p.output) /
		1e6
	);
}

const allRuns = [];
for (const name of readdirSync(suiteDir)) {
	const resultFile = join(suiteDir, name, "result.json");
	if (!existsSync(resultFile)) {
		continue;
	}
	const result = JSON.parse(readFileSync(resultFile, "utf8"));
	const model = models[result.model];
	const requests = readFileSync(join(suiteDir, name, "requests.jsonl"), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter((r) => r.modelCall);
	const ok = requests.filter((r) => r.usage);
	const sum = (pick) => ok.reduce((total, r) => total + pick(r), 0);
	const modelsUsed = [...new Set(requests.map((r) => r.request.model))];
	allRuns.push({
		runId: result.runId,
		task: result.task,
		agent: result.agent,
		model: result.model,
		rep: result.rep,
		passed: result.passed,
		tests: result.tests,
		timedOut: result.timedOut,
		exitCode: result.code,
		wallSeconds: Math.round(result.wallMs / 1000),
		requests: requests.length,
		failedRequests: requests.length - ok.length,
		inputTokens: sum((r) => r.usage.input),
		cacheReadTokens: sum((r) => r.usage.cacheRead),
		cacheWriteTokens: sum((r) => r.usage.cacheWrite),
		outputTokens: sum((r) => r.usage.output),
		totalTokens: sum((r) => r.usage.input + r.usage.output),
		firstRequestInputTokens:
			ok.find((r) => r.request.toolCount > 0)?.usage.input ?? 0,
		toolsInFirstRequest:
			ok.find((r) => r.request.toolCount > 0)?.request.toolCount ?? 0,
		costUsd: sum((r) => requestCost(model, r)),
		gatewayReportedCostUsd: ok.every((r) => r.usage.gatewayCost !== null)
			? sum((r) => r.usage.gatewayCost)
			: null,
		modelsUsed,
		agentVersion: result.agentVersion,
		patchLines: result.patchLines,
	});
}
const cellKey = (r) => `${r.task}|${r.model}|${r.rep}`;
const agentsPerCell = new Map();
for (const r of allRuns) {
	agentsPerCell.set(cellKey(r), (agentsPerCell.get(cellKey(r)) ?? 0) + 1);
}
const runs = allRuns.filter(
	(r) => agentsPerCell.get(cellKey(r)) === agentOrder.length,
);
const excludedRuns = allRuns
	.filter((r) => !runs.includes(r))
	.map((r) => r.runId);
runs.sort(
	(a, b) =>
		a.task.localeCompare(b.task) ||
		a.model.localeCompare(b.model) ||
		agentOrder.indexOf(a.agent) - agentOrder.indexOf(b.agent),
);

function aggregate(rows) {
	const total = (key) => rows.reduce((s, r) => s + r[key], 0);
	return {
		runs: rows.length,
		passed: rows.filter((r) => r.passed).length,
		requests: total("requests"),
		inputTokens: total("inputTokens"),
		cacheReadTokens: total("cacheReadTokens"),
		cacheWriteTokens: total("cacheWriteTokens"),
		outputTokens: total("outputTokens"),
		totalTokens: total("totalTokens"),
		costUsd: total("costUsd"),
		wallSeconds: total("wallSeconds"),
	};
}

const byAgent = Object.fromEntries(
	agentOrder.map((agent) => [
		agent,
		aggregate(runs.filter((r) => r.agent === agent)),
	]),
);
const byModel = {};
for (const model of Object.keys(models)) {
	const rows = runs.filter((r) => r.model === model);
	if (rows.length) {
		byModel[model] = Object.fromEntries(
			agentOrder.map((agent) => [
				agent,
				aggregate(rows.filter((r) => r.agent === agent)),
			]),
		);
	}
}
const byTask = {};
for (const task of [...new Set(runs.map((r) => r.task))]) {
	byTask[task] = Object.fromEntries(
		agentOrder.map((agent) => [
			agent,
			aggregate(runs.filter((r) => r.task === task && r.agent === agent)),
		]),
	);
}
const pairs = [];
for (const r of runs.filter((r) => r.agent === "empryo")) {
	for (const other of ["claude-code", "opencode"]) {
		const o = runs.find(
			(x) =>
				x.task === r.task &&
				x.model === r.model &&
				x.rep === r.rep &&
				x.agent === other,
		);
		if (o) {
			pairs.push({
				task: r.task,
				model: r.model,
				other,
				empryoTokens: r.totalTokens,
				otherTokens: o.totalTokens,
				empryoLess: r.totalTokens < o.totalTokens,
			});
		}
	}
}
const summary = {
	suite,
	excludedRuns,
	generatedAt: new Date().toISOString(),
	byAgent,
	byModel,
	byTask,
	headToHead: {
		vsClaudeCode: {
			empryoLess: pairs.filter((p) => p.other === "claude-code" && p.empryoLess)
				.length,
			of: pairs.filter((p) => p.other === "claude-code").length,
		},
		vsOpenCode: {
			empryoLess: pairs.filter((p) => p.other === "opencode" && p.empryoLess)
				.length,
			of: pairs.filter((p) => p.other === "opencode").length,
		},
	},
	runs,
};
writeFileSync(join(suiteDir, "summary.json"), JSON.stringify(summary, null, 2));

const m = (n) => (n / 1e6).toFixed(2) + "M";
const usd = (n) => "$" + n.toFixed(n < 1 ? 3 : 2);
const lines = [
	`# Agent token benchmark: ${suite}`,
	"",
	"## By agent (all tasks and models)",
	"",
	"| Agent | Runs | Solved | Requests | Input tokens | Cached | Output tokens | Total tokens | Cost |",
	"| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const [agent, a] of Object.entries(byAgent)) {
	lines.push(
		`| ${agent} | ${a.runs} | ${a.passed} | ${a.requests} | ${m(a.inputTokens)} | ${m(a.cacheReadTokens)} | ${m(a.outputTokens)} | ${m(a.totalTokens)} | ${usd(a.costUsd)} |`,
	);
}
lines.push(
	"",
	"## By model (total tokens, summed over tasks)",
	"",
	"| Model | Empryo | Claude Code | OpenCode | Empryo cost | Claude Code cost | OpenCode cost |",
	"| --- | --- | --- | --- | --- | --- | --- |",
);
for (const [model, a] of Object.entries(byModel)) {
	lines.push(
		`| ${models[model].label} | ${m(a.empryo.totalTokens)} (${a.empryo.passed}/${a.empryo.runs}) | ${m(a["claude-code"].totalTokens)} (${a["claude-code"].passed}/${a["claude-code"].runs}) | ${m(a.opencode.totalTokens)} (${a.opencode.passed}/${a.opencode.runs}) | ${usd(a.empryo.costUsd)} | ${usd(a["claude-code"].costUsd)} | ${usd(a.opencode.costUsd)} |`,
	);
}
lines.push(
	"",
	"## Every run",
	"",
	"| Task | Model | Agent | Solved | Requests | Total tokens | Cached | Output | First request | Cost | Wall |",
	"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
);
for (const r of runs) {
	lines.push(
		`| ${r.task} | ${r.model} | ${r.agent} | ${r.passed ? "yes" : "no"} | ${r.requests} | ${m(r.totalTokens)} | ${m(r.cacheReadTokens)} | ${(r.outputTokens / 1000).toFixed(1)}K | ${(r.firstRequestInputTokens / 1000).toFixed(1)}K | ${usd(r.costUsd)} | ${r.wallSeconds}s |`,
	);
}
writeFileSync(join(suiteDir, "summary.md"), lines.join("\n") + "\n");
console.log(
	lines
		.slice(0, 5 + Object.keys(byAgent).length + 4 + Object.keys(byModel).length)
		.join("\n"),
);
console.log(JSON.stringify(summary.headToHead));
