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
  --budget 120000

Results are written beneath .context/benchmarks. Set BENCHMARK_OUTPUT_DIR to
override that directory. Do not pass --output or --format.
`;

function hasOption(arguments_, names) {
	return arguments_.some((argument) =>
		names.some((name) => argument === name || argument.startsWith(`${name}=`)),
	);
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
if (!hasOption(arguments_, ["--profile", "--suite", "--external"])) {
	benchmarkArguments.push("--profile", "smoke");
}
if (!hasOption(arguments_, ["--budget", "--no-budget"])) {
	benchmarkArguments.push("--budget", "120000");
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
