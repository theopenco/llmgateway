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

void test("runner preserves pairs, records router failures and resumes without spending", () => {
	mkdirSync(".context", { recursive: true });
	const directory = mkdtempSync(resolve(".context/saina-runner-"));
	try {
		writeFileSync(
			`${directory}/ifeval.jsonl`,
			Array.from({ length: 40 }, (_, key) =>
				JSON.stringify({
					key,
					prompt: `Say hello ${key}`,
					instruction_id_list: ["punctuation:no_comma"],
					kwargs: [{}],
				}),
			).join("\n"),
		);
		const config = {
			model: "router",
			revision: "a".repeat(40),
			classifierReserveUsd: "0.001",
			candidates: ["gpt-6-luna", "gpt-6-sol"].map((model) => ({
				model,
				description: "Synthetic test candidate",
				estimatedRequestCostUsd: "1",
			})),
		};
		writeFileSync(`${directory}/config.json`, JSON.stringify(config));
		writeFileSync(
			`${directory}/fetch.mjs`,
			`
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
let routes = 0;
globalThis.fetch = async (url, options) => {
 const path = new URL(url).pathname;
 appendFileSync(process.env.BENCHMARK_DIR + "/calls.jsonl", JSON.stringify(path) + "\\n");
 if (path === "/v1/models") return Response.json({data:[{id:"router",revision:"a".repeat(40)}]});
 if (path === "/v1/key") return Response.json({data:{usage:"0"}});
 if (path === "/v1/ask") {
  routes++;
  if (routes === 1) return Response.json({}, {status:503});
  const body = JSON.parse(options.body);
  assert.deepEqual(Object.keys(body.questions.route.options), ["option_0", "option_1"]);
  return Response.json({model:"router",answers:{route:{probabilities:{option_0:0.8,option_1:0.2}}}});
 }
 assert.equal(path, "/v1/chat/completions");
 const body = JSON.parse(options.body);
 assert.notEqual(body.model, "saina");
 assert.equal(body.max_tokens, 8192);
 assert.equal(options.headers["x-no-cache"], "true");
 assert.equal(options.headers["x-no-fallback"], "true");
 const data = {model:body.model,choices:[{delta:{content:"answer"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}};
 return new Response("data: " + JSON.stringify(data) + "\\n\\ndata: [DONE]\\n\\n");
};
`,
		);
		const run = () =>
			spawnSync(
				process.execPath,
				[
					"--import",
					"tsx",
					"--import",
					`${directory}/fetch.mjs`,
					"scripts/benchmarks/smart-routing.ts",
				],
				{
					encoding: "utf8",
					env: {
						...process.env,
						BENCHMARK_DIR: directory,
						SAINA_CONFIG: `${directory}/config.json`,
						SAINA_BASE_URL: "https://example.com",
						SAINA_API_KEY: "test-token",
						LLM_GATEWAY_API_KEY: "test-token",
					},
				},
			);
		const result = run();
		assert.equal(result.status, 0, result.stderr);
		const lines = (name: string) =>
			readFileSync(`${directory}/${name}`, "utf8").trim().split("\n");
		const trials = lines("trials.jsonl").map(
			(line) =>
				JSON.parse(line) as {
					arm: string;
					response: { error: unknown };
					evaluation: { passed: boolean };
				},
		);
		assert.equal(trials.length, 400);
		const failed = trials.filter(
			(row) => row.arm === "saina" && row.response.error,
		);
		assert.equal(failed.length, 1);
		assert.equal(failed[0].evaluation.passed, false);
		assert.equal(lines("saina-routing.jsonl").length, 80);
		const paidCalls = () =>
			lines("calls.jsonl").filter(
				(line) =>
					line.includes("/v1/ask") || line.includes("/v1/chat/completions"),
			).length;
		assert.equal(paidCalls(), 479);
		assert.equal(run().status, 0);
		assert.equal(paidCalls(), 479);
		assert.equal(lines("trials.jsonl").length, 400);
		writeFileSync(`${directory}/saina-pending.json`, "{}");
		assert.notEqual(run().status, 0);
		assert.equal(paidCalls(), 479);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
