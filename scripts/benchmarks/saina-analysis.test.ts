import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { sainaFailure } from "./saina-routing.js";

void test("analysis includes failed routes and their reconciled overhead", () => {
	mkdirSync(".context", { recursive: true });
	const directory = mkdtempSync(resolve(".context/saina-analysis-"));
	try {
		const arms = ["smart", "gpt-6-astra", "saina"];
		const fixtures = ["easy", "reasoning", "ifeval"].map((category) => ({
			id: category,
			category,
			arms,
		}));
		const pin = {
			model: "router",
			revision: "a".repeat(40),
			adapterSha256: "b".repeat(64),
			candidates: [
				{
					model: "gpt-6-astra",
					description: "private configuration",
					estimatedRequestCostUsd: "1",
				},
			],
			classifierReserveUsd: "1",
		};
		writeFileSync(
			`${directory}/protocol.json`,
			JSON.stringify({ arms, fixtures, maximumOutputTokens: 8192, saina: pin }),
		);
		const trials = fixtures.flatMap((fixture) =>
			arms.map((arm) => {
				const failed = arm === "saina" && fixture.id === "easy";
				const routing = {
					caseId: fixture.id,
					model: pin.model,
					revision: pin.revision,
					selectedModel: failed ? null : "gpt-6-astra",
					latencyMs: 10,
					requestId: null,
					error: failed ? "saina_request_error" : null,
				};
				const response = {
					...sainaFailure(routing),
					error: failed
						? { code: "saina_request_error", message: "Routing failed" }
						: null,
					content: "answer",
					responseModel: failed ? null : "gpt-6-astra",
					usage: {
						promptTokens: 1,
						completionTokens: 1,
						reasoningTokens: 0,
						visibleCompletionTokens: 1,
						raw: { cost: failed ? 0 : 1 },
					},
				};
				return {
					caseId: fixture.id,
					category: fixture.category,
					arm,
					at: "2026-01-01T00:00:00Z",
					cost: failed ? 0 : 1,
					storageCost: 0,
					response,
					evaluation: { passed: !failed },
					...(arm === "saina" ? { routing } : {}),
				};
			}),
		);
		writeFileSync(
			`${directory}/trials.jsonl`,
			trials.map((row) => JSON.stringify(row)).join("\n"),
		);
		writeFileSync(
			`${directory}/billing.json`,
			JSON.stringify({
				done: true,
				error: null,
				rows: trials.map((row) => ({
					caseId: row.caseId,
					arm: row.arm,
					logs: row.response.error
						? []
						: [
								{
									usedModel: "gpt-6-astra",
									cost: 1,
									dataStorageCost: "0",
									estimatedCost: false,
									cached: false,
									usedMode: "credits",
									hasError: false,
									routingMetadata: {
										smartRouting: {
											classifier: "typesafe/jev-1.13.0",
											selectedModel: "gpt-6-astra",
											classifierCost: 0,
											classifierFailed: false,
										},
									},
								},
							],
				})),
			}),
		);
		const charges = fixtures.map((f) => ({
			caseId: f.id,
			cost: "0.25",
			basis: "estimated",
		}));
		writeFileSync(`${directory}/saina-billing.json`, JSON.stringify(charges));
		const run = () =>
			spawnSync(
				process.execPath,
				["--import", "tsx", "scripts/benchmarks/analyze-smart-routing.ts"],
				{ env: { ...process.env, BENCHMARK_DIR: directory }, encoding: "utf8" },
			);
		const result = run();
		assert.equal(result.status, 0, result.stderr);
		const report = JSON.parse(
			readFileSync(`${directory}/analysis-private.json`, "utf8"),
		) as {
			summaries: {
				arm: string;
				n: number;
				errors: number;
				totalCost: number;
				classifierCostBasis: string;
			}[];
			comparisons: { router: string; arm: string }[];
		};
		const saina = report.summaries.find((row) => row.arm === "saina")!;
		assert.equal(saina.n, 3);
		assert.equal(saina.errors, 1);
		assert.equal(saina.totalCost, 2.75);
		assert.equal(saina.classifierCostBasis, "includes estimates");
		assert.ok(
			report.comparisons.some(
				(row) => row.router === "saina" && row.arm === "gpt-6-astra",
			),
		);
		const publicText = readFileSync(`${directory}/results-public.json`, "utf8");
		assert.ok(!publicText.includes("classifierReserveUsd"));
		assert.ok(!publicText.includes("estimatedRequestCostUsd"));
		assert.ok(!publicText.includes("private configuration"));
		writeFileSync(
			`${directory}/saina-billing.json`,
			JSON.stringify(charges.slice(1)),
		);
		assert.notEqual(
			run().status,
			0,
			"unknown router charges must stop analysis",
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
