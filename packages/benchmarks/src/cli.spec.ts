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

const gatewayModels = {
	data: [
		{
			id: "deepseek-v4.1-flash-1017",
			name: "DeepSeek V4.1 Flash",
			providers: [
				{ providerId: "deepseek", externalId: "deepseek-flash" },
				{
					providerId: "airside-carrier",
					externalId: "DeepSeek-V4.1-Flash-1017",
					pricing: { prompt: "0.00000015", completion: "0.0000006" },
				},
			],
		},
	],
};

function gatewayFetch(input: Parameters<typeof fetch>[0]): Promise<Response> {
	const url = input instanceof Request ? input.url : String(input);
	return Promise.resolve(
		url.includes("/v1/models")
			? Response.json(gatewayModels)
			: streamResponse(),
	);
}

describe("runBenchmarkCli", () => {
	it("rejects an invalid report format before requesting a benchmark", async () => {
		vi.stubEnv("BENCHMARK_TEST_KEY", "key");
		const request = vi.fn(async () => streamResponse());
		vi.stubGlobal("fetch", request);
		await expect(
			runBenchmarkCli([
				"--model",
				"deepseek-v4.1-flash-1017",
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
				"--format",
				"invalid",
				"--quiet",
			]),
		).rejects.toThrow("Unknown output format");
		expect(request).not.toHaveBeenCalled();
	});
	it.each([
		["report.md", "# Model benchmark"],
		["report.html", "<!doctype html>"],
	])("infers and saves %s reports", async (filename, expected) => {
		const directory = await mkdtemp(join(tmpdir(), "benchmarks-"));
		temporaryDirectories.push(directory);
		const output = join(directory, filename);
		vi.stubEnv("BENCHMARK_TEST_KEY", "key");
		vi.stubGlobal("fetch", gatewayFetch);

		const exitCode = await runBenchmarkCli([
			"--model",
			"deepseek-v4.1-flash-1017",
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
		vi.stubGlobal("fetch", gatewayFetch);

		const exitCode = await runBenchmarkCli([
			"--model",
			"deepseek-v4.1-flash-1017",
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

	it("benchmarks an Airside listing that only the gateway catalogue has", async () => {
		const directory = await mkdtemp(join(tmpdir(), "benchmarks-"));
		temporaryDirectories.push(directory);
		const output = join(directory, "report.json");
		vi.stubEnv("BENCHMARK_TEST_KEY", "key");
		const request = vi.fn(gatewayFetch);
		vi.stubGlobal("fetch", request);

		const exitCode = await runBenchmarkCli([
			"--model",
			"deepseek-v4.1-flash-1017",
			"--mapping",
			"airside-carrier",
			"--suite",
			"performance",
			"--runs",
			"1",
			"--warmup",
			"0",
			"--api-key-env",
			"BENCHMARK_TEST_KEY",
			"--url",
			"http://gateway.test/v1/chat/completions",
			"--output",
			output,
			"--quiet",
		]);
		const result = JSON.parse(await readFile(output, "utf8")) as {
			targets: Array<{ id: string; metadata: { source: string } }>;
		};

		expect(exitCode).toBe(0);
		expect(String(request.mock.calls[0][0])).toBe(
			"http://gateway.test/v1/models?include_deactivated=true",
		);
		expect(result.targets).toMatchObject([
			{
				id: "airside-carrier/deepseek-v4.1-flash-1017",
				metadata: { source: "airside" },
			},
		]);
	});

	it("keeps the static catalogue available offline", async () => {
		vi.stubEnv("BENCHMARK_TEST_KEY", "key");
		const request = vi.fn(gatewayFetch);
		vi.stubGlobal("fetch", request);

		await expect(
			runBenchmarkCli([
				"--model",
				"deepseek-v4.1-flash-1017",
				"--mapping",
				"airside-carrier",
				"--catalogue",
				"static",
				"--api-key-env",
				"BENCHMARK_TEST_KEY",
				"--quiet",
			]),
		).rejects.toThrow("No selected model has mapping(s): airside-carrier");
		expect(request).not.toHaveBeenCalled();
	});
});
