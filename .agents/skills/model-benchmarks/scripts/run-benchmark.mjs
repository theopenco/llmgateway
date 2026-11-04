#!/usr/bin/env node

import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const rendererPath = fileURLToPath(
	new URL("./render-results.mjs", import.meta.url),
);

const HELP = `Usage:
  node .agents/skills/model-benchmarks/scripts/run-benchmark.mjs <model-id> [benchmark options]

Defaults:
  --mapping '*'
  --profile smoke
  --budget per profile: smoke 120000, standard 900000, load 3600000,
           coding 900000, --suite/--external 600000
  --timeout 300000

Results are written beneath .context/benchmarks. Set BENCHMARK_OUTPUT_DIR to
override that directory. Do not pass --output or --format.
`;

function hasOption(arguments_, names) {
	return arguments_.some((argument) =>
		names.some((name) => argument === name || argument.startsWith(`${name}=`)),
	);
}

// Per-target budgets sized so slow providers finish the profile; `standard`
// runs its throughput case last, so a short budget drops it.
const DEFAULT_BUDGET_MS = {
	smoke: 120_000,
	standard: 900_000,
	load: 3_600_000,
	coding: 900_000,
};
const DEFAULT_CUSTOM_BUDGET_MS = 600_000;
// A 60-second request timeout aborts long streams from slow providers and
// reports them as `stream_read_error`.
const DEFAULT_TIMEOUT_MS = 300_000;

function optionValue(arguments_, name) {
	for (const [index, argument] of arguments_.entries()) {
		if (argument === name) {
			return arguments_[index + 1];
		}
		if (argument.startsWith(`${name}=`)) {
			return argument.slice(name.length + 1);
		}
	}
	return undefined;
}

function run(command, arguments_) {
	const result = spawnSync(command, arguments_, {
		cwd: repositoryRoot,
		env: process.env,
		stdio: "inherit",
	});
	if (result.error) {
		throw result.error;
	}
	return result.status ?? 1;
}

const arguments_ = process.argv.slice(2);
if (arguments_.length === 0 || hasOption(arguments_, ["--help", "-h"])) {
	process.stdout.write(HELP);
	process.exit(arguments_.length === 0 ? 1 : 0);
}

const modelId = arguments_.shift();
if (!modelId || modelId.startsWith("-")) {
	throw new Error("The first argument must be a model id");
}
if (hasOption(arguments_, ["--model", "--output", "-o", "--format"])) {
	throw new Error(
		"Pass one positional model id and omit --output and --format",
	);
}

const benchmarkArguments = ["--model", modelId, ...arguments_];
if (!hasOption(arguments_, ["--mapping"])) {
	benchmarkArguments.push("--mapping", "*");
}
const hasProfile = hasOption(arguments_, ["--profile"]);
const hasCustomCases = hasOption(arguments_, ["--suite", "--external"]);
if (!hasProfile && !hasCustomCases) {
	benchmarkArguments.push("--profile", "smoke");
}
if (!hasOption(arguments_, ["--budget", "--no-budget"])) {
	let budgetMs = DEFAULT_BUDGET_MS.smoke;
	if (hasProfile) {
		budgetMs =
			DEFAULT_BUDGET_MS[optionValue(arguments_, "--profile")] ??
			DEFAULT_CUSTOM_BUDGET_MS;
	} else if (hasCustomCases) {
		budgetMs = DEFAULT_CUSTOM_BUDGET_MS;
	}
	benchmarkArguments.push("--budget", String(budgetMs));
}
if (!hasOption(arguments_, ["--timeout"])) {
	benchmarkArguments.push("--timeout", String(DEFAULT_TIMEOUT_MS));
}

const outputDirectory = resolve(
	repositoryRoot,
	process.env.BENCHMARK_OUTPUT_DIR ?? ".context/benchmarks",
);
mkdirSync(outputDirectory, { recursive: true });
const safeModelId = modelId.replaceAll(/[^a-zA-Z0-9._-]+/g, "-");
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const jsonPath = join(outputDirectory, `${safeModelId}-${timestamp}.json`);

const buildStatus = run("pnpm", [
	"turbo",
	"run",
	"build",
	"--filter=@llmgateway/benchmarks",
]);
if (buildStatus !== 0) {
	process.exit(buildStatus);
}

const benchmarkStatus = run("pnpm", [
	"--filter",
	"@llmgateway/benchmarks",
	"benchmark",
	"--",
	...benchmarkArguments,
	"--format",
	"json",
	"--output",
	jsonPath,
]);

if (existsSync(jsonPath)) {
	const renderStatus = run(process.execPath, [rendererPath, jsonPath]);
	if (renderStatus !== 0) {
		process.exit(renderStatus);
	}
}
if (benchmarkStatus !== 0) {
	process.exit(benchmarkStatus);
}
if (!existsSync(jsonPath)) {
	throw new Error(`Benchmark completed without saving ${jsonPath}`);
}
