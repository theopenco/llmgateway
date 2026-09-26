import { createHash } from "node:crypto";
import {
	existsSync,
	readFileSync,
	writeFileSync,
	appendFileSync,
	mkdirSync,
} from "node:fs";
import { resolve } from "node:path";

import {
	executeStreamingRequest,
	ifevalAdapter,
} from "../../packages/benchmarks/dist/index.js";
import { qualityCases } from "../../packages/benchmarks/dist/suites/quality.js";

import type {
	BenchmarkCase,
	BenchmarkRequest,
	BenchmarkRunContext,
	BenchmarkResponse,
} from "../../packages/benchmarks/dist/types.js";

async function main(): Promise<void> {
	const directory = resolve(
		process.env.BENCHMARK_DIR ?? ".context/benchmarks/smart-routing",
	);
	mkdirSync(directory, { recursive: true });
	const maximumOutputTokens = Number(
		process.env.BENCHMARK_MAX_TOKENS ?? "8192",
	);
	if (![4096, 8192].includes(maximumOutputTokens)) {
		throw new Error("BENCHMARK_MAX_TOKENS must be 4096 or 8192");
	}
	const seed = 20260926;
	let state = seed;
	function random(): number {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	}
	function shuffled<T>(values: T[]): T[] {
		const result = [...values];
		for (let i = result.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[result[i], result[j]] = [result[j], result[i]];
		}
		return result;
	}
	const arms = ["smart", "gpt-6-luna", "gpt-6-sol", "gpt-6-astra"];
	const context: BenchmarkRunContext = {
		seed,
		run: 0,
		warmup: false,
		caseId: "",
		target: { id: "", model: "" },
	};
	const simple: BenchmarkCase[] = Array.from({ length: 25 }, (_, i) => {
		const offsetA = i * 7;
		const a = 17 + offsetA;
		const offsetB = i * 3;
		const b = 9 + offsetB;
		const choices = [
			[`Return only the integer: ${a} + ${b}.`, String(a + b)],
			[
				`Extract the order code. Return only the code. Note: order=ORD-${a}-${b}; state=ready; items=3.`,
				`ORD-${a}-${b}`,
			],
			[
				`Sort these integers ascending, separated by commas without spaces: ${a}, ${b}, -${i}, 0.`,
				[-i, 0, b, a].sort((x, y) => x - y).join(","),
			],
			[
				`Return only the lowercase version of this string: GATEWAY-${a}-READY.`,
				`gateway-${a}-ready`,
			],
			[
				`Classify this message as POSITIVE or NEGATIVE. Return only the label. "This worked perfectly on all ${a} attempts. Thank you."`,
				"POSITIVE",
			],
		];
		const [prompt, expected] = choices[i % choices.length];
		return {
			id: `easy-${i}`,
			name: `Easy ${i}`,
			kind: "quality",
			category: "easy",
			request: { messages: [{ role: "user", content: prompt }] },
			evaluate: (response) => ({
				passed: response.content.trim() === expected,
				answer: response.content.trim(),
				expected,
			}),
		};
	});
	const ifeval = shuffled(
		await ifevalAdapter.load({
			source: `${directory}/ifeval.jsonl`,
			mode: "strict",
			unsupported: "skip",
		}),
	).slice(0, 40);
	const cases = shuffled([...simple, ...qualityCases, ...ifeval]);
	const fixtures = cases.map((test) => {
		const original =
			typeof test.request === "function" ? test.request(context) : test.request;
		const request: BenchmarkRequest = {
			messages: original.messages,
			maxTokens: maximumOutputTokens,
		};
		return {
			id: test.id,
			category: test.category,
			request,
			arms: shuffled(arms),
		};
	});
	const protocol = {
		version: 1,
		seed,
		arms,
		count: fixtures.length,
		maximumOutputTokens,
		timeoutMs: 180000,
		concurrency: 1,
		fallback: false,
		responseCache: false,
		reasoning: "Model defaults, including shipping smart-routing adjustments",
		temperature: "Model defaults",
		selection:
			"25 generated easy cases; all 15 repository exact-answer quality cases; 40 seeded-shuffled supported IFEval cases",
		ifevalSha256: createHash("sha256")
			.update(readFileSync(`${directory}/ifeval.jsonl`))
			.digest("hex"),
		fixtures,
	};
	const protocolText = JSON.stringify(protocol, null, 2);
	const protocolPath = `${directory}/protocol.json`;
	if (
		existsSync(protocolPath) &&
		readFileSync(protocolPath, "utf8") !== protocolText
	) {
		throw new Error("Protocol changed: use a fresh output directory");
	}
	if (!existsSync(protocolPath)) {
		writeFileSync(protocolPath, protocolText);
	}
	process.stdout.write(
		`Protocol: ${fixtures.length} paired prompts, ${fixtures.length * arms.length} requests, SHA256 ${createHash("sha256").update(protocolText).digest("hex")}\n`,
	);
	if (process.argv.includes("--prepare")) {
		process.exit(0);
	}
	const apiKey = process.env.LLM_GATEWAY_API_KEY;
	if (!apiKey) {
		throw new Error("Set LLM_GATEWAY_API_KEY");
	}
	const resultPath = `${directory}/trials.jsonl`;
	interface Trial {
		caseId: string;
		arm: string;
		cost: number;
		storageCost: number;
		response: BenchmarkResponse;
	}
	const previous: Trial[] = existsSync(resultPath)
		? readFileSync(resultPath, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as Trial)
		: [];
	const reconciliationPath = `${directory}/reconciled-errors.json`;
	const reconciled = (
		existsSync(reconciliationPath)
			? JSON.parse(readFileSync(reconciliationPath, "utf8"))
			: {}
	) as Record<string, { cost: number; storageCost: number }>;
	let inference = 0;
	for (const row of previous) {
		if (typeof row.response.usage.raw?.cost === "number") {
			inference += row.cost + row.storageCost;
			continue;
		}
		const charge = reconciled[row.response.requestId ?? ""];
		if (
			!charge ||
			!Number.isFinite(charge.cost) ||
			!Number.isFinite(charge.storageCost)
		) {
			throw new Error(
				`Reconcile missing usage before resuming: ${row.caseId}/${row.arm}`,
			);
		}
		inference += charge.cost + charge.storageCost;
	}
	let smartCount = previous.filter((row) => row.arm === "smart").length;
	const completed = new Set(previous.map((row) => `${row.caseId}/${row.arm}`));
	if (!existsSync(`${directory}/key.json`)) {
		if (previous.length > 0) {
			throw new Error("Missing initial usage snapshot for existing trials");
		}
		const initial = await fetch("https://api.llmgateway.io/v1/key", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(30000),
		});
		if (!initial.ok) {
			throw new Error(`Initial usage check failed: ${initial.status}`);
		}
		writeFileSync(
			`${directory}/key.json`,
			JSON.stringify({ data: await initial.json() }),
			{ mode: 0o600 },
		);
	}
	const baseline = JSON.parse(
		readFileSync(`${directory}/key.json`, "utf8"),
	) as { data: { data: { usage: string } } };
	const usageStart = Number(baseline.data.data.usage);
	let done = previous.length;
	for (const fixture of fixtures) {
		const pending = fixture.arms.filter(
			(arm) => !completed.has(`${fixture.id}/${arm}`),
		);
		if (pending.length === 0) {
			continue;
		}
		const keyResponse = await fetch("https://api.llmgateway.io/v1/key", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(30000),
		});
		if (!keyResponse.ok) {
			throw new Error(`Usage check failed: ${keyResponse.status}`);
		}
		const usage = (await keyResponse.json()) as { data: { usage: string } };
		const keyDelta = Number(usage.data.usage) - usageStart;
		appendFileSync(
			`${directory}/usage.jsonl`,
			JSON.stringify({
				at: new Date().toISOString(),
				done,
				keyDelta,
				inference,
			}) + "\n",
		);
		const classifierReserve = smartCount * 0.01;
		if (Math.max(keyDelta, inference + classifierReserve) + 3 > 26) {
			process.stdout.write(
				"Budget stop before starting another paired prompt\n",
			);
			break;
		}
		const test = cases.find((entry) => entry.id === fixture.id)!;
		for (const arm of pending) {
			const at = new Date().toISOString();
			const response = await executeStreamingRequest({
				client: {
					url: "https://api.llmgateway.io/v1/chat/completions",
					apiKey,
					disableCache: true,
					disableFallback: true,
				},
				request: fixture.request,
				model: arm,
				timeoutMs: protocol.timeoutMs,
				fetch,
			});
			const cost = response.usage.raw?.cost;
			const details = response.usage.raw?.cost_details as
				Record<string, unknown> | undefined;
			const storageCost =
				typeof details?.data_storage_cost === "number"
					? details.data_storage_cost
					: 0;
			const scored = await test.evaluate!(response, context);
			const passed =
				!response.error &&
				!["length", "incomplete"].includes(response.finishReason ?? "") &&
				scored.passed === true;
			const trial = {
				caseId: fixture.id,
				category: fixture.category,
				arm,
				at,
				response,
				evaluation: { ...scored, passed },
				cost: typeof cost === "number" ? cost : 0,
				storageCost,
			};
			appendFileSync(resultPath, JSON.stringify(trial) + "\n");
			inference += trial.cost + storageCost;
			if (arm === "smart") {
				smartCount++;
			}
			done++;
			process.stdout.write(
				`${done}/${fixtures.length * arms.length} ${fixture.id} ${arm} -> ${response.responseModel} ${passed ? "PASS" : "FAIL"} ${response.finishReason} ${Math.round(response.timing.totalMs)}ms inference=${inference.toFixed(6)}\n`,
			);
			if (typeof cost !== "number") {
				throw new Error(
					"Missing billed usage: trial saved; stop to reconcile before spending more",
				);
			}
		}
	}
}

void main();
