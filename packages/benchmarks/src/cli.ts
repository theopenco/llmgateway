#!/usr/bin/env node
/* eslint-disable no-console */

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { renderBenchmarkResult } from "./reporters.js";
import { runBenchmark } from "./runner.js";
import { getBuiltInSuite } from "./suites/index.js";
import { resolveBenchmarkTargets } from "./targets.js";

import type { BenchmarkOutputFormat } from "./types.js";

const HELP = `Usage:
  pnpm benchmark -- --model <model-id> [options]
  pnpm benchmark -- <model-id> [mapping1,mapping2] [runs]

Options:
  --model <id>                 Model to benchmark; repeatable
  --mapping <provider[:region]> Mapping selector; repeatable, comma-separated
  --suite <core|quality|performance>
  --case <id>                  Run selected case; repeatable, comma-separated
  --runs <count>               Override measured runs for every case
  --warmup <count>             Override warm-up runs for every case
  --concurrency <count>        Concurrent target/case groups (default: 1)
  --reference <target|mapping> Reference target for answer agreement
  --url <chat-completions-url> Gateway endpoint
  --api-key-env <name>         API key environment variable
  --reasoning-effort <effort>  Override every case
  --max-tokens <count>         Override every case
  --temperature <number>       Override every case
  --timeout <milliseconds>     Per-request timeout
  --format <json|markdown|html> Output format (default: JSON)
  --output <path>              Save output; .md/.html infer format
  --no-responses               Omit response and reasoning text from results
  --allow-cache                Allow gateway response-cache replay
  --allow-fallback             Allow fallback away from pinned mappings
  --include-deactivated        Include deactivated mappings
  --quiet                      Suppress progress on stderr
  --help                       Show this help
`;

function integer(value: string | undefined, name: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return parsed;
}

function finiteNumber(
	value: string | undefined,
	name: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`${name} must be a number`);
	}
	return parsed;
}

function csv(values: string[] | undefined): string[] | undefined {
	return values?.flatMap((value) =>
		value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean),
	);
}

function inferFormat(
	explicit: string | undefined,
	output: string | undefined,
): BenchmarkOutputFormat {
	const inferred =
		explicit ??
		(output?.endsWith(".md")
			? "markdown"
			: output?.endsWith(".html") || output?.endsWith(".htm")
				? "html"
				: "json");
	if (!new Set(["html", "json", "markdown"]).has(inferred)) {
		throw new Error(`Unknown output format: ${inferred}`);
	}
	return inferred as BenchmarkOutputFormat;
}

export async function runBenchmarkCli(args: string[]): Promise<number> {
	const normalizedArgs = args.filter(
		(argument, index) => argument !== "--" || index > 0,
	);
	const { values, positionals } = parseArgs({
		args: normalizedArgs,
		allowPositionals: true,
		options: {
			"allow-cache": { type: "boolean" },
			"allow-fallback": { type: "boolean" },
			"api-key-env": { type: "string" },
			case: { type: "string", multiple: true },
			concurrency: { type: "string" },
			format: { type: "string" },
			help: { type: "boolean", short: "h" },
			"include-deactivated": { type: "boolean" },
			mapping: { type: "string", multiple: true },
			"max-tokens": { type: "string" },
			model: { type: "string", multiple: true },
			"no-responses": { type: "boolean" },
			output: { type: "string", short: "o" },
			quiet: { type: "boolean" },
			reasoning: { type: "string" },
			"reasoning-effort": { type: "string" },
			reference: { type: "string" },
			runs: { type: "string" },
			suite: { type: "string" },
			temperature: { type: "string" },
			timeout: { type: "string" },
			url: { type: "string" },
			warmup: { type: "string" },
		},
		strict: true,
	});
	if (values.help) {
		process.stdout.write(HELP);
		return 0;
	}

	const modelIds = values.model ?? (positionals[0] ? [positionals[0]] : []);
	if (modelIds.length === 0) {
		throw new Error("Missing --model. Use --help for usage.");
	}
	const mappingValues =
		values.mapping ?? (positionals[1] ? [positionals[1]] : undefined);
	const targets = resolveBenchmarkTargets({
		modelIds,
		mappings: csv(mappingValues),
		includeDeactivated: values["include-deactivated"],
	});
	const selectedCaseIds = csv(values.case);
	const suite = getBuiltInSuite(values.suite ?? "core");
	const cases = selectedCaseIds
		? suite.filter((benchmarkCase) =>
				selectedCaseIds.includes(benchmarkCase.id),
			)
		: suite;
	if (selectedCaseIds && cases.length !== selectedCaseIds.length) {
		const found = new Set(cases.map((benchmarkCase) => benchmarkCase.id));
		throw new Error(
			`Unknown case(s): ${selectedCaseIds.filter((id) => !found.has(id)).join(", ")}`,
		);
	}

	const apiKeyEnv = values["api-key-env"] ?? "LLM_GATEWAY_API_KEY";
	const apiKey =
		process.env[apiKeyEnv] ??
		(apiKeyEnv === "LLM_GATEWAY_API_KEY"
			? process.env.LLMGATEWAY_API_KEY
			: undefined);
	if (!apiKey) {
		throw new Error(`Missing API key in ${apiKeyEnv}`);
	}
	const referenceTargetId = values.reference
		? (targets.find(
				(target) =>
					target.id === values.reference || target.mapping === values.reference,
			)?.id ?? values.reference)
		: targets[0].id;
	const runs = integer(values.runs ?? positionals[2], "runs");
	const warmupRuns = integer(values.warmup, "warmup");
	const concurrency = integer(values.concurrency, "concurrency");
	const timeoutMs = integer(values.timeout, "timeout");
	const maxTokens = integer(values["max-tokens"], "max-tokens");
	const temperature = finiteNumber(values.temperature, "temperature");
	const quiet = values.quiet ?? false;
	const result = await runBenchmark({
		client: {
			url:
				values.url ??
				process.env.BENCHMARK_API_URL ??
				"https://api.llmgateway.io/v1/chat/completions",
			apiKey,
			disableCache: !values["allow-cache"],
			disableFallback: !values["allow-fallback"],
		},
		targets,
		cases,
		runs,
		warmupRuns,
		concurrency,
		timeoutMs,
		includeResponses: !values["no-responses"],
		referenceTargetId,
		request: {
			maxTokens,
			reasoningEffort: values["reasoning-effort"] ?? values.reasoning,
			temperature,
		},
		onProgress: quiet
			? undefined
			: (event) => {
					if (event.type === "run-completed") {
						const status = event.result?.response.error
							? "ERROR"
							: event.result?.evaluation?.passed === false
								? "FAIL"
								: "OK";
						process.stderr.write(
							`[${status}] ${event.targetId} ${event.caseId} ${event.warmup ? "warmup" : `run ${event.run}`}\n`,
						);
					}
				},
	});
	const output = values.output;
	const format = inferFormat(values.format, output);
	const rendered = renderBenchmarkResult(result, format);
	if (output) {
		await writeFile(output, rendered);
		if (!quiet) {
			process.stderr.write(`Saved ${format} report to ${output}\n`);
		}
	} else {
		process.stdout.write(rendered);
	}
	return 0;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	runBenchmarkCli(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
