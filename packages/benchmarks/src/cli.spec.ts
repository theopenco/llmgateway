import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runBenchmarkCli } from "./cli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, {
				force: true,
				recursive: true,
			}),
		),
	);
});

function streamResponse(): Response {
	const answer = Array.from({ length: 100 }, (_, index) => index + 1).join(" ");
	return new Response(
		`data: ${JSON.stringify({ choices: [{ delta: { content: `FINAL: ${answer}` } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { completion_tokens: 100, prompt_tokens: 10 } })}\n\ndata: [DONE]\n\n`,
	);
}

describe("runBenchmarkCli", () => {
	it.each([
		["report.md", "# Model benchmark"],
		["report.html", "<!doctype html>"],
	])("infers and saves %s reports", async (filename, expected) => {
		const directory = await mkdtemp(join(tmpdir(), "benchmarks-"));
		temporaryDirectories.push(directory);
		const output = join(directory, filename);
		vi.stubEnv("BENCHMARK_TEST_KEY", "key");
		const fetchMock: typeof fetch = async () => streamResponse();
		vi.stubGlobal("fetch", fetchMock);

		const exitCode = await runBenchmarkCli([
			"--model",
			"deepseek-v4-flash",
			"--mapping",
			"deepseek",
			"--suite",
			"performance",
			"--runs",
			"1",
			"--warmup",
			"0",
			"--api-key-env",
			"BENCHMARK_TEST_KEY",
			"--output",
			output,
			"--quiet",
		]);

		expect(exitCode).toBe(0);
		expect(await readFile(output, "utf8")).toContain(expected);
	});

	it("runs the IFEval external adapter from JSONL", async () => {
		const directory = await mkdtemp(join(tmpdir(), "benchmarks-"));
		temporaryDirectories.push(directory);
		const dataset = join(directory, "ifeval.jsonl");
		const output = join(directory, "report.json");
		await writeFile(
			dataset,
			`${JSON.stringify({
				key: 1,
				prompt: "Do not use a comma.",
				instruction_id_list: ["punctuation:no_comma"],
				kwargs: [{}],
			})}\n`,
		);
		vi.stubEnv("BENCHMARK_TEST_KEY", "key");
		vi.stubGlobal("fetch", async () => streamResponse());

		const exitCode = await runBenchmarkCli([
			"--model",
			"deepseek-v4-flash",
			"--mapping",
			"deepseek",
			"--external",
			"ifeval",
			"--external-data",
			dataset,
			"--no-budget",
			"--api-key-env",
			"BENCHMARK_TEST_KEY",
			"--output",
			output,
			"--quiet",
		]);
		const result = JSON.parse(await readFile(output, "utf8")) as {
			summary: { targets: Array<{ quality: { instructionScore: number } }> };
			trials: Array<{ caseId: string }>;
		};

		expect(exitCode).toBe(0);
		expect(result.trials).toMatchObject([{ caseId: "ifeval-1" }]);
		expect(result.summary.targets[0].quality.instructionScore).toBe(1);
	});
});
