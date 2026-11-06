import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractContent } from "@/chat/tools/extract-content.js";
import { extractReasoning } from "@/chat/tools/extract-reasoning.js";
import { extractTokenUsage } from "@/chat/tools/extract-token-usage.js";
import { extractToolCalls } from "@/chat/tools/extract-tool-calls.js";
import { parseTrailingUpstreamError } from "@/chat/tools/parse-trailing-upstream-error.js";
import { getAvailableCredits } from "@/chat/tools/resolve-provider-context.js";
import { transformStreamingToOpenai } from "@/chat/tools/transform-streaming-to-openai.js";
import {
	assertApiKeyWithinUsageLimits,
	assertMemberProjectAccess,
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";
import { raceClientAbort } from "@/lib/client-abort.js";
import {
	assertProviderCompliant,
	getEffectiveRetentionLevel,
} from "@/lib/compliance.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { fetchProvider } from "@/lib/fetch-provider.js";
import { throwIamException, validateRequestModelAccess } from "@/lib/iam.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { formatUsedModelForDisplay } from "@/lib/model-response-id.js";
import { assertOrganizationUsable } from "@/lib/organization-access.js";
import { streamSSE } from "@/lib/pending-work.js";
import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";
import { assertSpendLimit } from "@/lib/spend-limit.js";

import {
	calculateCosts,
	openAirsideInference,
	redactToken,
	getProviderApiTransport,
	reportedWebSearchCount,
	signAirsideInferenceResponse,
	extractAssistantText,
	billedServerToolUseCount,
} from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { db, shortid } from "@llmgateway/db";
import { PROVIDER_API_FORMATS } from "@llmgateway/models";
import {
	estimateTokensFromText,
	estimateTokensFromTextLength,
} from "@llmgateway/shared";
import { getClientIpFromRequest } from "@llmgateway/shared/client-ip";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import type { AnthropicToolSearchState } from "@/chat/tools/transform-streaming-to-openai.js";
import type { ServerTypes } from "@/vars.js";
import type { GoogleThoughtSignatureState } from "@llmgateway/actions";
import type {
	ModelDefinition,
	Provider,
	ProviderModelMapping,
} from "@llmgateway/models";
import type { Context } from "hono";

const price = z
	.string()
	.regex(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
	.refine((value) => Number.isFinite(Number(value)));
const peakRatesSchema = z.object({
	inputPrice: price,
	outputPrice: price,
	cachedInputPrice: price.optional(),
});
const tierPeakSchema = z.object({
	peak: peakRatesSchema,
	offPeak: peakRatesSchema,
});
const payloadSchema = z.object({
	runId: z.string().min(1).max(200),
	providerKeyId: z.string().min(1).optional(),
	target: z
		.object({
			providerId: z.string().min(1),
			modelName: z.string().min(1),
			externalId: z.string().min(1),
			apiFormat: z.enum(PROVIDER_API_FORMATS).optional(),
			region: z.string().nullable().optional(),
			decisions: z.boolean().optional(),
			streaming: z.boolean(),
			reasoning: z.boolean(),
		})
		.passthrough(),
	pricing: z.object({
		inputPrice: price,
		outputPrice: price,
		cachedInputPrice: price.optional(),
		requestPrice: price.optional(),
		inputAudioPrice: price.optional(),
		cachedInputAudioPrice: price.optional(),
		imageInputPrice: price.optional(),
		cachedImageInputPrice: price.optional(),
		imageInputTokensByResolution: z
			.record(z.string(), z.number().int().nonnegative())
			.optional(),
		cacheReadInputPrice: price.optional(),
		cacheWriteInputPrice: price.optional(),
		cacheWriteInputPrice1h: price.optional(),
		webSearchPrice: price.optional(),
		peakPricing: tierPeakSchema
			.extend({
				hoursUtc: z.array(
					z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)]),
				),
				offPeakDaysUtc: z.array(z.number().int().min(0).max(6)).optional(),
			})
			.optional(),
		pricingTiers: z
			.array(
				z.object({
					name: z.string(),
					upToTokens: z.number().nonnegative(),
					inputPrice: price,
					outputPrice: price,
					cachedInputPrice: price.optional(),
					cacheReadInputPrice: price.optional(),
					cacheWriteInputPrice: price.optional(),
					cacheWriteInputPrice1h: price.optional(),
					peakPricing: tierPeakSchema.optional(),
				}),
			)
			.optional(),
	}),
	responseFormat: z.literal("openai-chat-completions").optional(),
	endpoint: z.string().url(),
	headers: z.record(z.string(), z.string()),
	body: z.string(),
});

function safeCount(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

/** Native bodies stay unchanged; only accounting reads the response frames. */
export function airsideInferenceUsage(
	text: string,
	provider: Provider,
	contentType: string,
) {
	let input: number | null = null;
	let output: number | null = null;
	let cached: number | null = null;
	let audioInputTokens: number | null = null;
	let cachedAudioInputTokens: number | null = null;
	let imageInputTokens: number | null = null;
	let reasoningTokens: number | null = null;
	let cacheWrite: number | null = null;
	let cacheWrite1h: number | null = null;
	let searches = 0;
	let providerError =
		contentType.includes("text/event-stream") &&
		/^event:\s*(?:error|response\.failed)\s*$/m.test(text);
	let searchEvents = 0;
	let billedSearches: number | null = null;
	let completionCharacters = 0;
	const frames = contentType.includes("text/event-stream")
		? text
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.filter((line) => line && line !== "[DONE]")
		: [text];
	for (const frame of frames) {
		let data: unknown;
		try {
			data = JSON.parse(frame);
		} catch {
			continue;
		}
		if (!data || typeof data !== "object") {
			continue;
		}
		const object = data as Record<string, unknown>;
		providerError ||=
			object.type === "response.failed" ||
			parseTrailingUpstreamError(frame) !== null;
		const usage = extractTokenUsage(object, provider);
		completionCharacters += completionTextForEstimate(
			object,
			provider,
			contentType.includes("text/event-stream"),
		).length;
		const nativeUsage = objectRecord(
			object.usage ?? objectRecord(object.response ?? object.message).usage,
		);
		input =
			safeCount(usage.promptTokens) ??
			safeCount(nativeUsage.input_tokens) ??
			input;
		output =
			safeCount(usage.completionTokens) ??
			safeCount(nativeUsage.output_tokens) ??
			output;
		cached = safeCount(usage.cachedTokens) ?? cached;
		const details = objectRecord(
			nativeUsage.prompt_tokens_details ?? nativeUsage.input_tokens_details,
		);
		audioInputTokens =
			safeCount(usage.audioInputTokens) ??
			safeCount(details.audio_tokens) ??
			audioInputTokens;
		cachedAudioInputTokens =
			safeCount(usage.cachedAudioInputTokens) ??
			safeCount(objectRecord(details.cached_tokens_details).audio_tokens) ??
			cachedAudioInputTokens;
		imageInputTokens =
			safeCount(usage.imageInputTokens) ??
			safeCount(details.image_tokens) ??
			imageInputTokens;
		reasoningTokens = safeCount(usage.reasoningTokens) ?? reasoningTokens;
		cacheWrite = safeCount(usage.cacheCreationTokens) ?? cacheWrite;
		cacheWrite1h = safeCount(usage.cacheCreation1hTokens) ?? cacheWrite1h;
		const search = nativeSearchUsage(object);
		billedSearches = search.billed ?? billedSearches;
		searches = Math.max(searches, safeCount(search.reported) ?? 0);
		searchEvents += search.events;
	}
	return {
		input,
		output,
		cached,
		audioInputTokens,
		cachedAudioInputTokens,
		imageInputTokens,
		reasoningTokens,
		cacheWrite,
		cacheWrite1h,
		searches,
		searchEvents,
		billedSearches,
		completionCharacters,
		providerError,
	};
}

function redactUpstream(
	text: string,
	endpoint: string,
	headers: Record<string, string>,
): string {
	const secrets = Object.entries(headers)
		.filter(([name]) => /authorization|api[-_]?key|token/i.test(name))
		.flatMap(([, value]) => [value, value.replace(/^Bearer\s+/i, "")]);
	for (const [name, value] of new URL(endpoint).searchParams) {
		if (/key|token|secret/i.test(name)) {
			secrets.push(value);
		}
	}
	return secrets
		.flatMap((secret) => [
			secret,
			JSON.stringify(secret).slice(1, -1),
			encodeURIComponent(secret),
		])
		.reduce((result, secret) => redactToken(result, secret), text);
}

async function readBoundedResponse(
	response: Response,
	signal: AbortSignal,
	controller: AbortController,
): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) {
		return "";
	}
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { value, done } = await raceClientAbort(
				reader.read(),
				signal,
				controller,
			);
			if (done) {
				return Buffer.concat(chunks).toString("utf8");
			}
			bytes += value.byteLength;
			if (bytes > 32 * 1024 * 1024) {
				throw new AirsideInferenceInfrastructureFailure();
			}
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
}

export const airsideInference = new OpenAPIHono<ServerTypes>();

async function handleAirsideInference(c: Context<ServerTypes>) {
	const startedAt = Date.now();
	const token = extractApiToken(c);
	const apiKey = await findApiKeyByToken(token);
	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, { message: "Invalid gateway API key" });
	}
	const project = await findProjectById(apiKey.projectId);
	if (!project || project.status === "deleted") {
		throw new HTTPException(403, { message: "Project is unavailable" });
	}
	await assertMemberProjectAccess(apiKey, project.organizationId);
	await assertMemberWithinBudget(apiKey.createdBy, project.organizationId);
	assertApiKeyWithinUsageLimits(apiKey);
	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		throw new HTTPException(403, { message: "Organization is unavailable" });
	}
	assertOrganizationUsable(organization);
	// Operator traffic cannot borrow customer wallets or subscription allowances.
	if (
		apiKey.endUserSession ||
		apiKey.endCustomerWalletId ||
		organization.kind !== "default" ||
		organization.devPlan !== "none" ||
		organization.chatPlan !== "none"
	) {
		throw new HTTPException(403, {
			message: "Internal inference requires an operator project key",
		});
	}
	let opened: ReturnType<typeof openAirsideInference>;
	try {
		opened = openAirsideInference(await c.req.json(), token);
	} catch {
		throw new HTTPException(403, {
			message: "Invalid internal inference envelope",
		});
	}
	const parsed = payloadSchema.safeParse(opened.payload);
	if (!parsed.success) {
		throw new HTTPException(400, {
			message: "Invalid internal inference payload",
		});
	}
	const payload = parsed.data;
	const { target } = payload;
	const mapping: ProviderModelMapping = {
		...payload.pricing,
		providerId: target.providerId as Provider,
		externalId: target.externalId,
		region: target.region ?? undefined,
		streaming: target.streaming,
	};
	const model: ModelDefinition = {
		id: target.modelName,
		family: "custom",
		providers: [mapping],
	};
	const iam = await validateRequestModelAccess({
		apiKey,
		organizationId: project.organizationId,
		providerAccessRestriction: organization.providerAccessRestriction,
		requestedModel: target.modelName,
		requestedProvider: target.providerId,
		activeModelInfo: model,
		clientIp: getClientIpFromRequest(c),
	});
	if (!iam.allowed) {
		throwIamException(iam.reason ?? "Model access denied");
	}
	await assertProviderCompliant(
		organization,
		target.providerId,
		{
			organizationId: project.organizationId,
			modelId: target.modelName,
			apiKeyId: apiKey.id,
		},
		apiKey,
	);
	await assertSpendLimit(c, organization, false);
	if (getAvailableCredits(organization).totalAvailableCredits <= 0) {
		throw new HTTPException(402, { message: "Insufficient operator credits" });
	}
	if (payload.providerKeyId) {
		const key = await db.query.providerKey.findFirst({
			where: { id: payload.providerKeyId },
		});
		if (
			!key ||
			!key.managed ||
			key.organizationId ||
			key.provider !== target.providerId ||
			key.status === "deleted" ||
			key.status === "pending_deletion"
		) {
			throw new HTTPException(403, {
				message: "Invalid internal inference provider key",
			});
		}
	}
	const rateLimit = await checkProviderRateLimit(
		project.organizationId,
		target.providerId,
		target.modelName,
	);
	if (!rateLimit.allowed) {
		throw new HTTPException(429, { message: "Provider rate limit exceeded" });
	}
	// Fail closed on replay-store failure; a captured request cannot trigger another paid attempt.
	const reserved = await redisClient.set(
		`airside-inference:${opened.envelope.keyHash}:${opened.envelope.nonce}`,
		"1",
		"PX",
		Math.max(1, opened.envelope.expiresAt - Date.now()),
		"NX",
	);
	if (reserved !== "OK") {
		throw new HTTPException(409, {
			message: "Internal inference was already submitted",
		});
	}
	const retentionLevel = getEffectiveRetentionLevel(organization, apiKey);
	const requestId = shortid();
	const base = createLogEntry({
		requestId,
		project,
		apiKey,
		usedProviderKeyId: payload.providerKeyId,
		usedModel: formatUsedModelForDisplay(
			target.providerId,
			target.modelName,
			undefined,
			target.region ?? undefined,
		),
		usedModelMapping: target.externalId,
		usedProvider: target.providerId,
		requestedModel: target.modelName,
		requestedProvider: target.providerId,
		messages: [],
		source: "airside",
		apiOrigin: target.decisions ? "decisions" : "chat-completions",
		customHeaders: { "x-airside-run-id": payload.runId },
		debugMode: false,
	});
	const controller = new AbortController();
	const signal = AbortSignal.any([
		c.req.raw.signal,
		AbortSignal.timeout(300_000),
		controller.signal,
	]);
	const usageProvider = getProviderApiTransport(
		target.providerId as Provider,
		opened.payload.target.apiFormat,
	);
	let usage = airsideInferenceUsage("", usageProvider, "application/json");
	let status = 502;
	let responseSize = 0;
	let firstTokenAt: number | null = null;
	let attempted = false;
	let completed = false;
	const nativeInput = nativeInputAccounting(payload.body);
	let failed = false;
	async function recordResult() {
		const ok = status >= 200 && status < 300;
		const input =
			usage.input ??
			(ok && !usage.providerError
				? estimateTokensFromText(requestTextForEstimate(payload.body))
				: 0);
		const output =
			usage.output ??
			(ok && completed && !usage.providerError
				? estimateTokensFromTextLength(usage.completionCharacters)
				: 0);
		const costs = await calculateCosts(
			target.modelName,
			target.providerId,
			target.region ?? null,
			input,
			output,
			usage.cached,
			undefined,
			usage.reasoningTokens,
			0,
			undefined,
			nativeInput.imageCount,
			usage.billedSearches ?? Math.max(usage.searches, usage.searchEvents),
			project!.organizationId,
			undefined,
			usage.imageInputTokens,
			null,
			{
				customPricing: mapping,
				cacheWriteTokens: usage.cacheWrite,
				cacheWrite1hTokens: usage.cacheWrite1h,
				audioInputTokens: usage.audioInputTokens,
				cachedAudioInputTokens: usage.cachedAudioInputTokens,
				explicitCacheUsed: nativeInput.explicitCacheUsed,
				allowOutputEstimate: false,
				rejectionWithoutUsage:
					(usage.providerError || !ok) &&
					usage.input === null &&
					usage.output === null,
			},
		);
		await insertLog(
			{
				...base,
				id: requestId,
				duration: Date.now() - startedAt,
				timeToFirstToken:
					firstTokenAt === null ? null : firstTokenAt - startedAt,
				timeToFirstReasoningToken: null,
				responseSize,
				content: null,
				reasoningContent: null,
				finishReason: ok && !failed ? "stop" : "upstream_error",
				promptTokens: input.toString(),
				completionTokens:
					usage.output === null && (!completed || usage.providerError)
						? null
						: output.toString(),
				totalTokens: (input + output).toString(),
				reasoningTokens: usage.reasoningTokens?.toString() ?? null,
				audioInputTokens: usage.audioInputTokens?.toString() ?? null,
				audioInputCost: costs.audioInputCost,
				imageInputTokens:
					usage.imageInputTokens?.toString() ??
					costs.imageInputTokens?.toString() ??
					null,
				imageInputCost: costs.imageInputCost,
				cachedTokens: usage.cached?.toString() ?? null,
				hasError: !ok || failed,
				streamed: streaming,
				canceled: !completed && signal.aborted,
				errorDetails:
					ok && !failed
						? null
						: {
								statusCode: status,
								statusText: "Upstream error",
								responseText: "Internal inference upstream failed",
							},
				inputCost: costs.inputCost,
				outputCost: costs.outputCost,
				cachedInputCost: costs.cachedInputCost,
				cacheWriteInputCost: costs.cacheWriteInputCost,
				requestCost: costs.requestCost,
				webSearchCost: costs.webSearchCost,
				cost: costs.totalCost,
				estimatedCost:
					ok &&
					!usage.providerError &&
					(usage.input === null || (completed && usage.output === null)),
				discount: costs.discount ?? null,
				pricingTier: costs.pricingTier ?? null,
				dataStorageCost: calculateDataStorageCost(
					input,
					usage.cached,
					output,
					null,
					retentionLevel,
				),
				cached: false,
				toolResults: null,
			},
			{ retentionLevel },
		);
	}
	let response: Response;
	let streaming = false;
	try {
		await raceClientAbort(
			assertSafeProviderUrl(payload.endpoint),
			signal,
			controller,
		);
		signal.throwIfAborted();
		const headers = new Headers(payload.headers);
		for (const name of [
			"host",
			"connection",
			"content-length",
			"transfer-encoding",
			"cookie",
			"forwarded",
			"x-forwarded-for",
		]) {
			headers.delete(name);
		}
		attempted = true;
		response = await raceClientAbort(
			fetchProvider(
				payload.endpoint,
				{
					method: "POST",
					headers,
					body: payload.body,
					redirect: "error",
					signal,
				},
				payload.endpoint,
			),
			signal,
			controller,
		);
		status = response.status;
	} catch {
		status = signal.aborted ? 504 : 502;
		failed = true;
		await recordResult();
		return new Response(
			JSON.stringify({
				error: { message: "Internal inference upstream failed" },
			}),
			{
				status,
				headers: attempted
					? {
							"content-type": "application/json",
							"x-request-id": requestId,
							"x-airside-inference": signAirsideInferenceResponse(
								opened.envelope,
								status,
							),
						}
					: { "content-type": "application/json" },
			},
		);
	}
	const contentType =
		response.headers.get("content-type") ?? "application/json";
	streaming = response.ok && contentType.includes("text/event-stream");
	c.header("x-request-id", requestId);
	c.header(
		"x-airside-inference",
		signAirsideInferenceResponse(opened.envelope, status),
	);
	if (!streaming) {
		let infrastructureFailure = false;
		let text = JSON.stringify({
			error: { message: "Internal inference upstream failed" },
		});
		try {
			text = redactUpstream(
				await readBoundedResponse(response, signal, controller),
				payload.endpoint,
				payload.headers,
			);
			usage = airsideInferenceUsage(text, usageProvider, contentType);
			failed ||= usage.providerError;
			completed = true;
			responseSize = Buffer.byteLength(text);
		} catch (error) {
			failed = true;
			infrastructureFailure =
				error instanceof AirsideInferenceInfrastructureFailure;
			status = infrastructureFailure ? 503 : signal.aborted ? 504 : 502;
			if (infrastructureFailure) {
				c.header("x-airside-inference", undefined);
			}
		}
		await recordResult();
		return new Response(text, {
			status,
			headers: {
				"content-type": contentType,
				"x-request-id": requestId,
				...(!infrastructureFailure
					? {
							"x-airside-inference": signAirsideInferenceResponse(
								opened.envelope,
								status,
							),
						}
					: {}),
			},
		});
	}
	return streamSSE(c, async (stream) => {
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		const toolIndices = new Set<number>();
		const toolSearchState: AnthropicToolSearchState = new Map();
		const toolCallIndices = new Set<number>();
		const googleToolCallIndices = new Map<number, number>();
		const googleThoughtSignatureState = new Map<
			number,
			GoogleThoughtSignatureState
		>();
		const anthropicThinkingText = new Map<number, string>();
		stream.onAbort(() => controller.abort());
		async function emit(frame: string) {
			const safe = redactUpstream(frame, payload.endpoint, payload.headers);
			const next = airsideInferenceUsage(
				safe,
				usageProvider,
				"text/event-stream",
			);
			usage = {
				input: next.input ?? usage.input,
				output: next.output ?? usage.output,
				cached: next.cached ?? usage.cached,
				audioInputTokens: next.audioInputTokens ?? usage.audioInputTokens,
				cachedAudioInputTokens:
					next.cachedAudioInputTokens ?? usage.cachedAudioInputTokens,
				imageInputTokens: next.imageInputTokens ?? usage.imageInputTokens,
				reasoningTokens: next.reasoningTokens ?? usage.reasoningTokens,
				cacheWrite: next.cacheWrite ?? usage.cacheWrite,
				cacheWrite1h: next.cacheWrite1h ?? usage.cacheWrite1h,
				searches: Math.max(next.searches, usage.searches),
				searchEvents: usage.searchEvents + next.searchEvents,
				billedSearches: next.billedSearches ?? usage.billedSearches,
				completionCharacters:
					usage.completionCharacters + next.completionCharacters,
				providerError: usage.providerError || next.providerError,
			};
			failed ||= next.providerError;
			if (next.completionCharacters) {
				firstTokenAt ??= Date.now();
			}
			if (!payload.responseFormat) {
				await stream.write(`${safe}\n\n`);
				return;
			}
			if (next.providerError) {
				await stream.writeSSE({
					event: "error",
					data: JSON.stringify({
						error: {
							type: "provider_error",
							message: "Provider inference failed",
						},
					}),
				});
				return;
			}
			const data = safe
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.join("\n");
			if (!data || data === "[DONE]") {
				return;
			}
			let parsed: unknown;
			let transformed: unknown;
			try {
				parsed = JSON.parse(data);
				if (!parsed || typeof parsed !== "object") {
					throw new AirsideInferenceInfrastructureFailure();
				}
				transformed = transformStreamingToOpenai(
					usageProvider,
					target.modelName,
					parsed,
					[],
					toolIndices,
					target.reasoning,
					toolSearchState,
					toolCallIndices,
					{
						cacheThoughtSignatures: false,
						googleToolCallIndices,
						googleThoughtSignatureState,
						anthropicThinkingText,
					},
				);
			} catch {
				throw new AirsideInferenceInfrastructureFailure();
			}
			if (transformed) {
				await stream.writeSSE({ data: JSON.stringify(transformed) });
			}
		}
		try {
			for (;;) {
				const { value, done } = await raceClientAbort(
					reader.read(),
					signal,
					controller,
				);
				if (done) {
					buffer += decoder.decode();
					if (buffer.trim()) {
						await emit(buffer);
					}
					completed = true;
					break;
				}
				responseSize += value.byteLength;
				buffer += decoder.decode(value, { stream: true });

				let boundary = /\r?\n\r?\n/.exec(buffer);
				while (boundary) {
					const frame = buffer.slice(0, boundary.index);
					if (Buffer.byteLength(frame) > 1024 * 1024) {
						throw new AirsideInferenceInfrastructureFailure();
					}
					buffer = buffer.slice(boundary.index + boundary[0].length);
					await emit(frame);
					boundary = /\r?\n\r?\n/.exec(buffer);
				}
				if (Buffer.byteLength(buffer) > 1024 * 1024) {
					throw new AirsideInferenceInfrastructureFailure();
				}
			}
			if (payload.responseFormat) {
				await stream.writeSSE({ data: "[DONE]" });
			}
		} catch (error) {
			failed = true;
			if (
				!signal.aborted &&
				error instanceof AirsideInferenceInfrastructureFailure
			) {
				await stream.write(
					`event: airside-infrastructure-error\ndata: ${signAirsideInferenceResponse(opened.envelope, 0)}\n\n`,
				);
			} else if (!signal.aborted) {
				await stream.writeSSE({
					event: "error",
					data: JSON.stringify({
						error: { message: "Internal inference stream failed" },
					}),
				});
			}
		} finally {
			try {
				await reader.cancel();
			} finally {
				await recordResult();
			}
		}
	});
}

airsideInference.post(
	"/internal/airside/inference",
	bodyLimit({ maxSize: 32 * 1024 * 1024 }),
	handleAirsideInference,
);
function objectRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function toolArguments(calls: unknown): string {
	if (!Array.isArray(calls)) {
		return "";
	}
	return calls
		.map((call: unknown) => {
			const value = objectRecord(objectRecord(call).function).arguments;
			return typeof value === "string" ? value : "";
		})
		.join("");
}
function requestTextForEstimate(body: string): string {
	const data = objectRecord(JSON.parse(body));
	const parts: string[] = [];
	for (const messages of [
		data.messages,
		data.contents,
		Array.isArray(data.input) ? data.input : undefined,
	]) {
		if (!Array.isArray(messages)) {
			continue;
		}
		for (const message of messages) {
			const item = objectRecord(message);
			parts.push(
				extractAssistantText({ content: item.content ?? item.parts }),
				typeof item.output === "string" ? item.output : "",
			);
		}
	}
	for (const value of [
		data.system,
		data.instructions,
		typeof data.input === "string" ? data.input : undefined,
		objectRecord(data.systemInstruction).parts,
	]) {
		parts.push(extractAssistantText({ content: value }));
	}
	return parts.join("");
}
function completionTextForEstimate(
	data: Record<string, unknown>,
	provider: Provider,
	streaming: boolean,
): string {
	if (streaming) {
		const responseDelta =
			typeof data.type === "string" &&
			/^response\.(?:output_text|reasoning_text|reasoning_summary_text|function_call_arguments)\.delta$/.test(
				data.type,
			) &&
			typeof data.delta === "string"
				? data.delta
				: "";
		const calls: unknown = extractToolCalls(data, provider);
		return (
			extractContent(data, provider) +
			extractReasoning(data, provider) +
			responseDelta +
			toolArguments(calls)
		);
	}
	if (Array.isArray(data.choices)) {
		return data.choices
			.map((choice: unknown) => {
				const message = objectRecord(objectRecord(choice).message);
				const reasoning = message.reasoning_content ?? message.reasoning;
				return (
					extractAssistantText({ choices: [choice] }) +
					(typeof reasoning === "string" ? reasoning : "") +
					toolArguments(message.tool_calls)
				);
			})
			.join("");
	}
	const items = Array.isArray(data.output)
		? data.output
		: Array.isArray(data.content)
			? data.content
			: [];
	const thoughtsAndTools = items
		.map((value: unknown) => {
			const item = objectRecord(value);
			return (
				(typeof item.thinking === "string" ? item.thinking : "") +
				(typeof item.arguments === "string" ? item.arguments : "") +
				(item.type === "tool_use" && item.input
					? JSON.stringify(item.input)
					: "")
			);
		})
		.join("");
	return extractAssistantText(data) + thoughtsAndTools;
}
function nativeSearchUsage(data: Record<string, unknown>) {
	const response = objectRecord(data.response ?? data.message ?? data);
	const billed = safeCount(billedServerToolUseCount(response.usage));
	const items = Array.isArray(response.output)
		? response.output
		: Array.isArray(response.content)
			? response.content
			: [];
	let reported = Math.max(
		reportedWebSearchCount(data),
		reportedWebSearchCount(response),
		items.filter((item: unknown) => {
			const value = objectRecord(item);
			return (
				value.type === "web_search_call" ||
				(value.type === "web_search_tool_result" &&
					Array.isArray(value.content))
			);
		}).length,
	);
	const candidates = Array.isArray(data.candidates) ? data.candidates : [];
	for (const candidate of candidates) {
		const grounding = objectRecord(objectRecord(candidate).groundingMetadata);
		reported = Math.max(
			reported,
			Array.isArray(grounding.webSearchQueries)
				? grounding.webSearchQueries.length
				: Array.isArray(grounding.groundingChunks) &&
					  grounding.groundingChunks.length > 0
					? 1
					: 0,
		);
	}
	const block = objectRecord(data.content_block);
	const events =
		data.type === "response.web_search_call.completed" ||
		(data.type === "content_block_start" &&
			block.type === "web_search_tool_result" &&
			Array.isArray(block.content))
			? 1
			: 0;
	return { billed, reported, events };
}
class AirsideInferenceInfrastructureFailure extends Error {}
function nativeInputAccounting(body: string) {
	const root = objectRecord(JSON.parse(body));
	const pending: unknown[] = [
		root.messages,
		root.contents,
		root.input,
		root.system,
		root.systemInstruction,
	];
	let imageCount = 0;
	let explicitCacheUsed =
		typeof root.cachedContent === "string" && root.cachedContent.length > 0;
	while (pending.length) {
		const value = pending.pop();
		if (Array.isArray(value)) {
			for (const item of value) {
				pending.push(item);
			}
			continue;
		}
		const part = objectRecord(value);
		if (part.cache_control !== undefined || part.cachePoint !== undefined) {
			explicitCacheUsed = true;
		}
		const imageUrl =
			typeof part.image_url === "string" ||
			typeof objectRecord(part.image_url).url === "string";
		const inline = objectRecord(part.inlineData);
		if (
			((part.type === "image_url" || part.type === "input_image") &&
				(imageUrl || typeof part.file_id === "string")) ||
			(part.type === "image" && part.source !== undefined) ||
			(typeof inline.mimeType === "string" &&
				inline.mimeType.startsWith("image/") &&
				typeof inline.data === "string")
		) {
			imageCount++;
		}
		for (const child of Object.values(part)) {
			pending.push(child);
		}
	}
	return { imageCount, explicitCacheUsed };
}
