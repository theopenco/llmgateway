/* eslint-disable no-console */
/**
 * Benchmark a model's response performance across every provider that serves
 * it. Hits each provider's upstream directly (not through the gateway) so the
 * numbers reflect raw model/provider performance, using the gateway's own
 * endpoint + header resolution from the model registry.
 *
 * Measures time-to-first-token (TTFT), total latency, decode throughput
 * (output tokens / generation time), and runs verifiable quality checks so a
 * degraded/quantized variant on any provider is caught.
 *
 * Usage (env vars must hold the provider API keys, e.g. via `--env-file`):
 *   pnpm --filter @llmgateway/scripts benchmark-model <model-id> [providers] [runs]
 *   pnpm --filter @llmgateway/scripts benchmark-model kimi-k2.6
 *   pnpm --filter @llmgateway/scripts benchmark-model kimi-k2.6 moonshot,tundra 2
 *
 * Only OpenAI-compatible chat providers are supported (the benchmark sends a
 * plain OpenAI chat-completions body); other providers are reported as errors.
 */
import { writeFileSync } from "fs";

import { getProviderEndpoint, getProviderHeaders } from "@llmgateway/actions";
import {
	models,
	getProviderEnvVar,
	expandAllProviderRegions,
	type ProviderModelMapping,
} from "@llmgateway/models";

interface Prompt {
	id: string;
	maxTokens: number;
	messages: { role: string; content: string }[];
	check?: (content: string) => { ok: boolean | null; detail: string };
}

const PROMPTS: Prompt[] = [
	{
		id: "reasoning",
		maxTokens: 4000,
		messages: [
			{
				role: "user",
				content:
					"Solve carefully and show your work.\n" +
					"1) A bag has 5 red, 4 blue, and 3 green marbles. You draw 3 at random " +
					"without replacement. Give the exact probability (as a reduced fraction) " +
					"that you draw exactly one marble of each color.\n" +
					"2) How many positive integers n <= 1000 are divisible by 3 or 5 but NOT by 7?\n" +
					"End your answer with a line exactly of the form: FINAL: <p1>; <p2>  " +
					"where p1 is the reduced fraction and p2 is the integer count.",
			},
		],
		check: (content) => {
			// ground truth: 60/220 = 3/11 ; (333+200-66) - (47+28-9) = 401
			const m = content.match(/FINAL:\s*([^\n;]+);\s*([^\n]+)/);
			if (!m) {
				return { ok: null, detail: "no FINAL line" };
			}
			const okP1 = m[1].replace(/\s/g, "") === "3/11";
			const okP2 = /\b401\b/.test(m[2]);
			return {
				ok: okP1 && okP2,
				detail: `p1=${okP1 ? "Y" : "N"} p2=${okP2 ? "Y" : "N"}`,
			};
		},
	},
	{
		id: "coding",
		maxTokens: 4000,
		messages: [
			{
				role: "user",
				content:
					"Write a single JavaScript function `longestPalindrome(s)` that returns the " +
					"longest palindromic substring of s (any one if ties). It must run in " +
					"O(n^2) time or better and handle empty strings. Return ONLY one fenced " +
					"```js code block with just the function, no prose.",
			},
		],
		check: (content) => {
			const m = content.match(
				/```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/,
			);
			const code = m ? m[1] : content;
			try {
				// Intentionally execute the model-generated code to validate it.
				// eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
				const factory = new Function(`${code}\nreturn longestPalindrome;`);
				const fn = factory() as (s: string) => string;
				const cases: [string, string[]][] = [
					["babad", ["bab", "aba"]],
					["cbbd", ["bb"]],
					["", [""]],
					["a", ["a"]],
					["forgeeksskeegfor", ["geeksskeeg"]],
					["abacdfgdcaba", ["aba", "aca"]],
				];
				for (const [s, expected] of cases) {
					const got = fn(s);
					if (!expected.includes(got)) {
						return {
							ok: false,
							detail: `f(${JSON.stringify(s)})=${JSON.stringify(got)} not in ${JSON.stringify(expected)}`,
						};
					}
				}
				return { ok: true, detail: "6/6 cases" };
			} catch (e) {
				return {
					ok: false,
					detail: e instanceof Error ? e.message : String(e),
				};
			}
		},
	},
	{
		id: "throughput",
		maxTokens: 4000,
		messages: [
			{
				role: "user",
				content:
					"Write a clear ~700 word technical explanation of how HTTP/2 multiplexing " +
					"works, how it differs from HTTP/1.1 head-of-line blocking, and what role " +
					"streams, frames, and flow control play. Write continuous prose, no headings.",
			},
		],
		check: (content) => {
			const words = content.trim().split(/\s+/).filter(Boolean).length;
			return { ok: words >= 400, detail: `${words} words` };
		},
	},
];

interface Delta {
	content?: string;
	reasoning_content?: string;
	reasoning?: string;
}
interface Usage {
	completion_tokens?: number;
}
interface Chunk {
	choices?: { delta?: Delta; finish_reason?: string | null }[];
	usage?: Usage;
}

interface CallResult {
	error: string | null;
	ttft: number | null;
	total: number;
	content: string;
	reasoning: string;
	completionTokens: number | null;
	finish: string | null;
}

async function streamCall(
	url: string,
	headers: Record<string, string>,
	body: unknown,
): Promise<CallResult> {
	const t0 = performance.now();
	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
	} catch (e) {
		return blank(t0, `${e instanceof Error ? e.message : String(e)}`);
	}
	if (!res.ok || !res.body) {
		const detail = (await res.text()).slice(0, 200);
		return blank(t0, `HTTP ${res.status}: ${detail}`);
	}

	let ttft: number | null = null;
	let content = "";
	let reasoning = "";
	let completionTokens: number | null = null;
	let finish: string | null = null;

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		buf += decoder.decode(value, { stream: true });
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data:")) {
				continue;
			}
			const payload = trimmed.slice(5).trim();
			if (payload === "[DONE]") {
				continue;
			}
			let chunk: Chunk;
			try {
				chunk = JSON.parse(payload) as Chunk;
			} catch {
				continue;
			}
			if (typeof chunk.usage?.completion_tokens === "number") {
				completionTokens = chunk.usage.completion_tokens;
			}
			const choice = chunk.choices?.[0];
			if (!choice) {
				continue;
			}
			if (choice.finish_reason) {
				finish = choice.finish_reason;
			}
			const piece = choice.delta?.content;
			const rpiece = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
			if (piece) {
				ttft ??= (performance.now() - t0) / 1000;
				content += piece;
			}
			if (rpiece) {
				ttft ??= (performance.now() - t0) / 1000;
				reasoning += rpiece;
			}
		}
	}
	return {
		error: null,
		ttft,
		total: (performance.now() - t0) / 1000,
		content,
		reasoning,
		completionTokens,
		finish,
	};
}

function blank(t0: number, error: string): CallResult {
	return {
		error,
		ttft: null,
		total: (performance.now() - t0) / 1000,
		content: "",
		reasoning: "",
		completionTokens: null,
		finish: null,
	};
}

function fmt(x: number | null): string {
	return typeof x === "number" ? x.toFixed(2) : "-";
}

async function main(): Promise<void> {
	const modelId = process.argv[2];
	if (!modelId) {
		console.error(
			"usage: benchmark-model <model-id> [provider1,provider2] [runs]",
		);
		process.exit(1);
	}
	const providerFilter = process.argv[3]
		? process.argv[3].split(",").map((s) => s.trim())
		: undefined;
	const runs = process.argv[4] ? Number(process.argv[4]) : 1;

	const model = models.find((m) => m.id === modelId);
	if (!model) {
		console.error(`unknown model: ${modelId}`);
		process.exit(1);
	}

	const mappings = expandAllProviderRegions(
		model.providers as ProviderModelMapping[],
	).filter((m) => !providerFilter || providerFilter.includes(m.providerId));

	console.log(
		`Benchmarking ${modelId} across ${mappings.length} provider mapping(s), ${runs} run(s) each\n`,
	);

	const results: Record<string, Record<string, CallResult[]>> = {};

	for (const prompt of PROMPTS) {
		results[prompt.id] = {};
		for (const mapping of mappings) {
			const label = mapping.region
				? `${mapping.providerId}:${mapping.region}`
				: mapping.providerId;
			const envVar = getProviderEnvVar(mapping.providerId);
			const token = envVar
				? process.env[envVar]?.split(",")[0]?.trim()
				: undefined;
			if (!token) {
				console.log(
					`[${prompt.id.padEnd(11)}] ${label.padEnd(16)} no key (${envVar})`,
				);
				continue;
			}

			const runResults: CallResult[] = [];
			for (let i = 0; i < runs; i++) {
				let url: string;
				try {
					url = getProviderEndpoint(
						mapping.providerId,
						undefined,
						modelId,
						token,
						true,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						mapping.region,
						false,
						modelId,
					);
				} catch (e) {
					runResults.push(
						blank(
							performance.now(),
							e instanceof Error ? e.message : String(e),
						),
					);
					continue;
				}
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
					...getProviderHeaders(mapping.providerId, token),
				};
				const body = {
					model: mapping.externalId,
					messages: prompt.messages,
					stream: true,
					stream_options: { include_usage: true },
					max_tokens: prompt.maxTokens,
				};
				const r = await streamCall(url, headers, body);
				runResults.push(r);

				const decode = r.ttft !== null && r.total ? r.total - r.ttft : null;
				const toks =
					r.completionTokens && decode && decode > 0
						? r.completionTokens / decode
						: null;
				console.log(
					`[${prompt.id.padEnd(11)}] ${label.padEnd(16)} run${i + 1} ` +
						`ttft=${fmt(r.ttft)}s total=${fmt(r.total)}s out_tok=${r.completionTokens} ` +
						`tok/s=${fmt(toks)} content=${r.content.length}c reason=${r.reasoning.length}c ` +
						`finish=${r.finish} ${r.error ?? "ok"}`,
				);
			}
			results[prompt.id][label] = runResults;
		}
		console.log();
	}

	console.log("=== QUALITY ===");
	const labels = Array.from(
		new Set(PROMPTS.flatMap((p) => Object.keys(results[p.id] ?? {}))),
	);
	for (const label of labels) {
		const parts: string[] = [];
		for (const prompt of PROMPTS) {
			const rs = results[prompt.id]?.[label];
			const withContent = rs?.find((r) => r.content);
			if (!prompt.check) {
				continue;
			}
			if (!withContent) {
				parts.push(`${prompt.id}[no output]`);
				continue;
			}
			const { ok, detail } = prompt.check(withContent.content);
			const mark = ok === null ? "?" : ok ? "PASS" : "FAIL";
			parts.push(`${prompt.id}[${mark}: ${detail}]`);
		}
		console.log(`${label.padEnd(16)} ${parts.join("  ")}`);
	}

	const out = `benchmark-${modelId.replace(/[^a-z0-9.-]/gi, "_")}.json`;
	writeFileSync(out, JSON.stringify(results, null, 2));
	console.log(`\nRaw results written to ${out}`);
}

void main();
