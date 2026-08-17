import { logger } from "@llmgateway/logger";
import { models, type ProviderModelMapping } from "@llmgateway/models";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import { describeNetworkFailure } from "./provider-key/network-error.js";
import { redactToken } from "./provider-key/redact.js";

export type ProviderEndpointCheckId =
	"chat" | "streaming" | "json_mode" | "tool_calls";

export const PROVIDER_ENDPOINT_CHECKS: ProviderEndpointCheckId[] = [
	"chat",
	"streaming",
	"json_mode",
	"tool_calls",
];

export interface ProviderEndpointCheckResult {
	check: ProviderEndpointCheckId;
	passed: boolean;
	latencyMs: number;
	error?: string;
}

export interface ProviderEndpointProbeOptions {
	/** OpenAI-compatible base URL; probes hit `<baseUrl>/v1/chat/completions`. */
	baseUrl: string;
	token: string;
	/** Model id the upstream endpoint expects. */
	externalModelId: string;
	/** Subset of checks to run; defaults to all. */
	checks?: ProviderEndpointCheckId[];
	/** Per-check timeout. */
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Which checks a listed deployment of a catalogue model must pass: chat and
 * streaming always; json_mode / tool_calls only when the model declares the
 * capability on any live catalogue mapping, since routing would otherwise
 * send capability-dependent requests to a deployment that cannot serve them.
 */
export function getRequiredChecksForModel(
	modelId: string,
): ProviderEndpointCheckId[] {
	const modelDef = models.find((m) => m.id === modelId);
	const now = new Date();
	const liveMappings =
		(
			modelDef?.providers as readonly ProviderModelMapping[] | undefined
		)?.filter((p) => !(p.deactivatedAt && now >= p.deactivatedAt)) ?? [];
	const required: ProviderEndpointCheckId[] = ["chat", "streaming"];
	if (liveMappings.some((p) => p.jsonOutput)) {
		required.push("json_mode");
	}
	if (liveMappings.some((p) => p.tools)) {
		required.push("tool_calls");
	}
	return required;
}

interface ProbeRequest {
	body: Record<string, unknown>;
	validate: (res: Response, text: string) => string | null;
}

function nonEmptyContent(json: {
	choices?: { message?: { content?: unknown } }[];
}): string | null {
	const content = json.choices?.[0]?.message?.content;
	if (typeof content !== "string" || content.trim() === "") {
		return "Response has no assistant message content";
	}
	return null;
}

// Probe bodies deliberately set no token cap: OpenAI-compatible endpoints
// disagree on max_tokens vs max_completion_tokens, and either spelling 400s
// somewhere. The prompts are small enough to keep responses cheap.
function buildProbe(
	check: ProviderEndpointCheckId,
	externalModelId: string,
): ProbeRequest {
	switch (check) {
		case "chat":
			return {
				body: {
					model: externalModelId,
					messages: [
						{ role: "user", content: "Reply with exactly the word: pong" },
					],
				},
				validate: (_res, text) => {
					let json;
					try {
						json = JSON.parse(text);
					} catch {
						return "Response is not valid JSON";
					}
					const contentError = nonEmptyContent(json);
					if (contentError) {
						return contentError;
					}
					// The gateway bills on usage, so an endpoint that omits token
					// accounting cannot be listed.
					const total = json.usage?.total_tokens;
					if (typeof total !== "number" || total <= 0) {
						return "Response is missing usage.total_tokens";
					}
					return null;
				},
			};
		case "streaming":
			return {
				body: {
					model: externalModelId,
					messages: [{ role: "user", content: "Count from 1 to 5." }],
					stream: true,
				},
				validate: (res, text) => {
					const contentType = res.headers.get("content-type") ?? "";
					if (!contentType.includes("text/event-stream")) {
						return `Expected text/event-stream, got ${contentType || "no content-type"}`;
					}
					const dataLines = text
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trim());
					if (!dataLines.some((line) => line === "[DONE]")) {
						return "Stream did not terminate with data: [DONE]";
					}
					let sawChunk = false;
					for (const line of dataLines) {
						if (line === "[DONE]" || line === "") {
							continue;
						}
						let chunk;
						try {
							chunk = JSON.parse(line);
						} catch {
							return "Stream contains a non-JSON data line";
						}
						if (chunk.object !== "chat.completion.chunk") {
							return `Stream chunk has object "${chunk.object}", expected "chat.completion.chunk"`;
						}
						if (chunk.choices?.[0]?.delta !== undefined) {
							sawChunk = true;
						}
					}
					if (!sawChunk) {
						return "Stream contained no completion chunks with a delta";
					}
					return null;
				},
			};
		case "json_mode":
			return {
				body: {
					model: externalModelId,
					messages: [
						{
							role: "user",
							content:
								'Return a JSON object with a single key "ok" set to true.',
						},
					],
					response_format: { type: "json_object" },
				},
				validate: (_res, text) => {
					let json;
					try {
						json = JSON.parse(text);
					} catch {
						return "Response is not valid JSON";
					}
					const contentError = nonEmptyContent(json);
					if (contentError) {
						return contentError;
					}
					try {
						const parsed = JSON.parse(json.choices[0].message.content);
						if (typeof parsed !== "object" || parsed === null) {
							return "Message content is JSON but not an object";
						}
					} catch {
						return "Message content is not valid JSON";
					}
					return null;
				},
			};
		case "tool_calls":
			return {
				body: {
					model: externalModelId,
					messages: [
						{ role: "user", content: "What is the weather in Paris?" },
					],
					tools: [
						{
							type: "function",
							function: {
								name: "get_weather",
								description: "Get the current weather for a city",
								parameters: {
									type: "object",
									properties: {
										city: { type: "string", description: "The city name" },
									},
									required: ["city"],
								},
							},
						},
					],
					tool_choice: "required",
				},
				validate: (_res, text) => {
					let json;
					try {
						json = JSON.parse(text);
					} catch {
						return "Response is not valid JSON";
					}
					const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
					if (!toolCall) {
						return "Response contains no tool calls";
					}
					if (toolCall.function?.name !== "get_weather") {
						return `Tool call named "${toolCall.function?.name}", expected "get_weather"`;
					}
					try {
						JSON.parse(toolCall.function.arguments);
					} catch {
						return "Tool call arguments are not valid JSON";
					}
					return null;
				},
			};
	}
}

async function runSingleCheck(
	check: ProviderEndpointCheckId,
	endpoint: string,
	token: string,
	externalModelId: string,
	timeoutMs: number,
): Promise<ProviderEndpointCheckResult> {
	const probe = buildProbe(check, externalModelId);
	const startedAt = Date.now();
	try {
		const response = await fetch(endpoint, {
			method: "POST",
			// SSRF: never follow redirects on a tenant-supplied baseUrl, which
			// could 3xx to an internal host (and would leak the test credential).
			redirect: "error",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(probe.body),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const text = await response.text();
		const latencyMs = Date.now() - startedAt;

		if (!response.ok) {
			let message = `${response.status} ${response.statusText}`;
			try {
				const errorJson = JSON.parse(text);
				message = errorJson.error?.message ?? errorJson.message ?? message;
			} catch {}
			return {
				check,
				passed: false,
				latencyMs,
				error: redactToken(`HTTP ${response.status}: ${message}`, token),
			};
		}

		const validationError = probe.validate(response, text);
		return {
			check,
			passed: validationError === null,
			latencyMs,
			error: validationError ? redactToken(validationError, token) : undefined,
		};
	} catch (error) {
		const latencyMs = Date.now() - startedAt;
		const networkFailure = describeNetworkFailure(error, endpoint);
		const rawMessage =
			networkFailure?.message ??
			(error instanceof Error ? error.message : "Unknown error");
		return {
			check,
			passed: false,
			latencyMs,
			error: redactToken(rawMessage, token),
		};
	}
}

/**
 * Probe an OpenAI-compatible endpoint with the listing validation suite for
 * one model: basic chat, streaming, JSON mode, and tool calling. Checks run
 * sequentially to keep the load on the candidate endpoint predictable.
 *
 * The baseUrl is tenant-supplied, so it is re-validated against the SSRF
 * guard here (https-only, no internal hosts, DNS-resolved) even though the
 * write path already checked it — the stored value must never be trusted to
 * still be safe.
 */
export async function runProviderEndpointChecks(
	options: ProviderEndpointProbeOptions,
): Promise<ProviderEndpointCheckResult[]> {
	const {
		baseUrl,
		token,
		externalModelId,
		checks = PROVIDER_ENDPOINT_CHECKS,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	} = options;

	await assertSafeProviderUrl(baseUrl);
	const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

	const results: ProviderEndpointCheckResult[] = [];
	for (const check of checks) {
		const result = await runSingleCheck(
			check,
			endpoint,
			token,
			externalModelId,
			timeoutMs,
		);
		logger.debug("Provider endpoint check finished", {
			check,
			model: externalModelId,
			passed: result.passed,
			latencyMs: result.latencyMs,
		});
		results.push(result);
	}
	return results;
}
