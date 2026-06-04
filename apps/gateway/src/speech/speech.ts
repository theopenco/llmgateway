import { OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { buildRoutingAttempt } from "@/chat/tools/build-routing-attempt.js";
import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import { getFinishReasonFromError } from "@/chat/tools/get-finish-reason-from-error.js";
import { getProviderEnv } from "@/chat/tools/get-provider-env.js";
import {
	getErrorType,
	isRetryableErrorType,
	shouldRetryAlternateKey,
} from "@/chat/tools/retry-with-fallback.js";
import { validateSource } from "@/chat/tools/validate-source.js";
import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import {
	reportKeyError,
	reportKeySuccess,
	reportTrackedKeyError,
	reportTrackedKeySuccess,
} from "@/lib/api-key-health.js";
import { assertApiKeyWithinUsageLimits } from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
} from "@/lib/cached-queries.js";
import { getClientIpFromRequest } from "@/lib/client-ip.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { createFailedKeyTracker } from "@/lib/failed-key-tracker.js";
import { throwIamException, validateModelAccess } from "@/lib/iam.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { createCombinedSignal, isTimeoutError } from "@/lib/timeout-config.js";

import { getProviderHeaders } from "@llmgateway/actions";
import { shortid } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getProviderEnvValue,
	models as modelDefinitions,
} from "@llmgateway/models";

import type { RoutingAttempt } from "@/chat/tools/retry-with-fallback.js";
import type { ServerTypes } from "@/vars.js";
import type { RoutingMetadata } from "@llmgateway/actions";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

const speechRequestSchema = z.object({
	model: z.string().openapi({
		description: "ID of the speech generation (text-to-speech) model to use.",
		example: "gemini-2.5-flash-preview-tts",
	}),
	input: z.string().min(1).openapi({
		description: "The text to synthesize into speech.",
		example: "Hello, welcome to LLM Gateway!",
	}),
	voice: z.string().optional().openapi({
		description:
			"The prebuilt voice to use. Defaults to the model's default voice when omitted.",
		example: "Kore",
	}),
	response_format: z
		.enum(["wav", "pcm", "mp3", "opus", "aac", "flac"])
		.optional()
		.openapi({
			description:
				"The audio format of the returned audio. Gemini speech models emit PCM, so only `wav` (default) and `pcm` are supported.",
			example: "wav",
		}),
	speed: z.number().min(0.25).max(4).optional().openapi({
		description:
			"Playback speed hint. Accepted for OpenAI compatibility but not applied by Gemini speech models.",
		example: 1,
	}),
	instructions: z.string().optional().openapi({
		description:
			"Optional style/delivery instructions prepended to the input as a natural-language directive (e.g. 'Say cheerfully').",
		example: "Say in a warm, friendly tone",
	}),
});

type SpeechRequest = z.infer<typeof speechRequestSchema>;

interface SpeechErrorBody {
	error: {
		message: string;
		type: string;
		param: string | null;
		code: string;
	};
}

const PROVIDER_BASE_URL_DEFAULTS: Partial<Record<string, string>> = {
	"google-ai-studio": "https://generativelanguage.googleapis.com",
};

/**
 * Wrap raw signed 16-bit little-endian PCM samples in a minimal WAV container
 * so callers receive a directly playable file. Gemini returns mono PCM at the
 * sample rate encoded in the inlineData mimeType (e.g. `audio/L16;rate=24000`).
 */
function pcmToWav(
	pcm: Buffer,
	sampleRate: number,
	channels = 1,
	bitsPerSample = 16,
): Buffer {
	const byteRate = (sampleRate * channels * bitsPerSample) / 8;
	const blockAlign = (channels * bitsPerSample) / 8;
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

function parseSampleRate(mimeType: string | undefined): number {
	const match = mimeType?.match(/rate=(\d+)/);
	const rate = match ? Number(match[1]) : NaN;
	return Number.isFinite(rate) && rate > 0 ? rate : 24000;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
	return buf.buffer.slice(
		buf.byteOffset,
		buf.byteOffset + buf.byteLength,
	) as ArrayBuffer;
}

function findSpeechMapping(modelId: string): {
	mapping: ProviderModelMapping;
	modelDef: ModelDefinition;
	modelDefId: string;
	explicitProvider: boolean;
} | null {
	let requestedProvider: string | undefined;
	let modelKey = modelId;
	const slashIdx = modelId.indexOf("/");
	if (slashIdx > 0) {
		requestedProvider = modelId.slice(0, slashIdx);
		modelKey = modelId.slice(slashIdx + 1);
	}
	for (const model of modelDefinitions) {
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (!candidate.speechGenerations) {
				continue;
			}
			if (requestedProvider && candidate.providerId !== requestedProvider) {
				continue;
			}
			if (model.id === modelKey || candidate.externalId === modelKey) {
				return {
					mapping: candidate,
					modelDef: model,
					modelDefId: model.id,
					explicitProvider: requestedProvider !== undefined,
				};
			}
		}
	}
	return null;
}

function getAvailableCredits(
	organization: InferSelectModel<typeof tables.organization>,
) {
	const regularCredits = parseFloat(organization.credits ?? "0");
	const devPlanCreditsRemaining =
		organization.devPlan !== "none"
			? parseFloat(organization.devPlanCreditsLimit ?? "0") -
				parseFloat(organization.devPlanCreditsUsed ?? "0")
			: 0;

	return {
		devPlanCreditsRemaining,
		totalAvailableCredits: regularCredits + devPlanCreditsRemaining,
	};
}

function assertCreditsAvailable(
	organization: InferSelectModel<typeof tables.organization>,
	modelDef: ModelDefinition,
	insufficientCreditsMessage: string,
	devPlanCreditLimitMessage: (renewalDate: string) => string,
) {
	const { devPlanCreditsRemaining, totalAvailableCredits } =
		getAvailableCredits(organization);

	if (totalAvailableCredits > 0 || modelDef.free) {
		return;
	}

	if (organization.devPlan !== "none" && devPlanCreditsRemaining <= 0) {
		const renewalDate = organization.devPlanExpiresAt
			? new Date(organization.devPlanExpiresAt).toLocaleDateString()
			: "your next billing date";
		throw new HTTPException(402, {
			message: devPlanCreditLimitMessage(renewalDate),
		});
	}

	throw new HTTPException(402, { message: insufficientCreditsMessage });
}

export const speech = new OpenAPIHono<ServerTypes>();

speech.post("/", async (c): Promise<Response> => {
	const requestId = c.req.header("x-request-id")?.trim() || shortid(40);
	c.header("x-request-id", requestId);

	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch {
		return c.json(
			{
				error: {
					message: "Invalid JSON in request body",
					type: "invalid_request_error",
					param: null,
					code: "invalid_json",
				},
			} satisfies SpeechErrorBody,
			400,
		);
	}

	const validationResult = speechRequestSchema.safeParse(rawBody);
	if (!validationResult.success) {
		return c.json(
			{
				error: {
					message: `Invalid request parameters: ${validationResult.error.issues
						.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
						.join(", ")}`,
					type: "invalid_request_error",
					param: null,
					code: "invalid_parameters",
				},
			} satisfies SpeechErrorBody,
			400,
		);
	}

	const request: SpeechRequest = validationResult.data;
	const requestedModel = request.model;

	const responseFormat = request.response_format ?? "wav";
	if (responseFormat !== "wav" && responseFormat !== "pcm") {
		return c.json(
			{
				error: {
					message: `Unsupported response_format '${responseFormat}'. Gemini speech models only support 'wav' and 'pcm'.`,
					type: "invalid_request_error",
					param: "response_format",
					code: "unsupported_response_format",
				},
			} satisfies SpeechErrorBody,
			400,
		);
	}

	const match = findSpeechMapping(requestedModel);
	if (!match) {
		return c.json(
			{
				error: {
					message: `Speech generation model not found: ${requestedModel}`,
					type: "invalid_request_error",
					param: "model",
					code: "model_not_found",
				},
			} satisfies SpeechErrorBody,
			400,
		);
	}

	const { mapping, modelDef, modelDefId, explicitProvider } = match;
	const upstreamModel = mapping.externalId;
	const providerId = mapping.providerId;

	if (providerId !== "google-ai-studio") {
		return c.json(
			{
				error: {
					message: `Speech generation is not supported for provider ${providerId}.`,
					type: "invalid_request_error",
					param: "model",
					code: "unsupported_provider",
				},
			} satisfies SpeechErrorBody,
			400,
		);
	}

	const voice = request.voice ?? mapping.supportedVoices?.[0] ?? "Kore";

	const startedAt = Date.now();
	const source = validateSource(
		c.req.header("x-source"),
		c.req.header("HTTP-Referer"),
	);
	const userAgent = c.req.header("User-Agent") ?? undefined;
	const debugMode =
		c.req.header("x-debug") === "true" ||
		process.env.FORCE_DEBUG_MODE === "true" ||
		process.env.NODE_ENV !== "production";
	const customHeaders = extractCustomHeaders(c);
	const normalizedMessages = [
		{ role: "user" as const, content: request.input },
	];

	const token = extractApiToken(c);
	const apiKey = await findApiKeyByToken(token);

	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. Please make sure the token is not deleted or disabled. Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	assertApiKeyWithinUsageLimits(apiKey);

	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		throw new HTTPException(500, { message: "Could not find project" });
	}
	if (project.status === "deleted") {
		throw new HTTPException(410, {
			message: "Project has been archived and is no longer accessible",
		});
	}

	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		throw new HTTPException(500, { message: "Could not find organization" });
	}
	if (organization.status === "deleted") {
		throw new HTTPException(410, {
			message: "Organization has been disabled and is no longer accessible",
		});
	}

	const retentionLevel = organization.retentionLevel ?? "none";
	const iamValidation = await validateModelAccess(
		apiKey.id,
		modelDefId,
		providerId,
		modelDef,
		getClientIpFromRequest(c),
	);
	if (!iamValidation.allowed) {
		throwIamException(iamValidation.reason ?? "Model access denied");
	}

	const finalLogId = shortid();
	const failedKeys = createFailedKeyTracker();

	const selectionReason = explicitProvider
		? "direct-provider-specified"
		: "single-provider-available";
	const routingAttempts: RoutingAttempt[] = [];
	const buildSpeechRoutingMetadata = (
		usedApiKeyHash: string | undefined,
	): RoutingMetadata => ({
		availableProviders: [providerId],
		selectedProvider: providerId,
		selectionReason,
		...(usedApiKeyHash ? { usedApiKeyHash } : {}),
		providerScores: [],
		...(routingAttempts.length > 0 ? { routing: routingAttempts } : {}),
	});

	const retryProject = {
		mode: project.mode,
		organizationId: project.organizationId,
	};
	const retryOrganization = organization;

	const promptText = request.instructions
		? `${request.instructions}: ${request.input}`
		: request.input;

	const upstreamRequestBody: Record<string, unknown> = {
		contents: [{ parts: [{ text: promptText }] }],
		generationConfig: {
			responseModalities: ["AUDIO"],
			speechConfig: {
				voiceConfig: {
					prebuiltVoiceConfig: { voiceName: voice },
				},
			},
		},
	};

	interface SpeechAttempt {
		providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		usedToken: string;
		configIndex: number;
		envVarName: string | undefined;
		upstreamUrl: string;
	}

	async function resolveAttempt(): Promise<SpeechAttempt> {
		let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		let usedToken: string | undefined;
		let configIndex = 0;
		let envVarName: string | undefined;

		const excludedProviderKeyIds = failedKeys.providerKeyIdsFor(
			providerId,
			undefined,
		);
		const excludedEnvKeyIndices = failedKeys.envKeyIndicesFor(
			providerId,
			undefined,
		);

		if (retryProject.mode === "api-keys") {
			providerKey = await findProviderKey(
				retryProject.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (!providerKey) {
				throw new HTTPException(400, {
					message: `No API key set for provider: ${providerId}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
				});
			}
			usedToken = providerKey.token;
		} else if (retryProject.mode === "credits") {
			assertCreditsAvailable(
				retryOrganization,
				modelDef,
				`Organization ${retryOrganization.id} has insufficient credits`,
				(renewalDate) =>
					`Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
			);

			const envResult = getProviderEnv(providerId, {
				selectionScope: upstreamModel,
				excludedIndices: excludedEnvKeyIndices,
			});
			usedToken = envResult.token;
			configIndex = envResult.configIndex;
			envVarName = envResult.envVarName;
		} else if (retryProject.mode === "hybrid") {
			providerKey = await findProviderKey(
				retryProject.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (providerKey) {
				usedToken = providerKey.token;
			} else {
				assertCreditsAvailable(
					retryOrganization,
					modelDef,
					"No API key set for provider and organization has insufficient credits",
					(renewalDate) =>
						`No API key set for provider. Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
				);

				const envResult = getProviderEnv(providerId, {
					selectionScope: upstreamModel,
					excludedIndices: excludedEnvKeyIndices,
				});
				usedToken = envResult.token;
				configIndex = envResult.configIndex;
				envVarName = envResult.envVarName;
			}
		} else {
			throw new HTTPException(400, {
				message: `Invalid project mode: ${retryProject.mode}`,
			});
		}

		if (retentionLevel === "retain") {
			const { totalAvailableCredits } = getAvailableCredits(retryOrganization);
			if (totalAvailableCredits <= 0) {
				throw new HTTPException(402, {
					message:
						"Organization has insufficient credits for data retention. Data retention requires credits for storage costs ($0.01 per 1M tokens). Please add credits or disable data retention in organization settings.",
				});
			}
		}

		if (!usedToken) {
			throw new HTTPException(500, { message: "No token" });
		}

		const envBaseUrl = getProviderEnvValue(providerId, "baseUrl", configIndex);
		const resolvedBaseUrl =
			providerKey?.baseUrl ??
			envBaseUrl ??
			PROVIDER_BASE_URL_DEFAULTS[providerId] ??
			"https://generativelanguage.googleapis.com";

		const upstreamUrl = `${resolvedBaseUrl}/v1beta/models/${upstreamModel}:generateContent?key=${encodeURIComponent(usedToken)}`;

		return { providerKey, usedToken, configIndex, envVarName, upstreamUrl };
	}

	async function resolveNextAttempt(
		failedAttempt: SpeechAttempt,
	): Promise<SpeechAttempt | null> {
		failedKeys.remember(providerId, undefined, {
			envVarName: failedAttempt.envVarName,
			configIndex: failedAttempt.configIndex,
			providerKeyId: failedAttempt.providerKey?.id,
		});
		try {
			const next = await resolveAttempt();
			if (
				next.usedToken === failedAttempt.usedToken &&
				next.envVarName === failedAttempt.envVarName &&
				next.configIndex === failedAttempt.configIndex &&
				next.providerKey?.id === failedAttempt.providerKey?.id
			) {
				return null;
			}
			return next;
		} catch {
			return null;
		}
	}

	let attempt: SpeechAttempt = await resolveAttempt();

	const controller = new AbortController();
	const onAbort = () => {
		controller.abort();
	};
	c.req.raw.signal.addEventListener("abort", onAbort);

	try {
		while (true) {
			const attemptLogId = shortid();
			const usedApiKeyHash = getApiKeyFingerprint(attempt.usedToken);
			const baseLogEntry = createLogEntry({
				requestId,
				project,
				apiKey,
				providerKeyId: attempt.providerKey?.id,
				usedModel: `${providerId}/${modelDefId}`,
				usedModelMapping: upstreamModel,
				usedProvider: providerId,
				requestedModel,
				requestedProvider: providerId,
				messages: normalizedMessages,
				source,
				customHeaders,
				debugMode,
				userAgent,
				rawRequest: rawBody,
				upstreamRequest: upstreamRequestBody,
			});

			let upstreamResponse: Response;
			let fetchError: Error | null = null;
			try {
				const fetchSignal = createCombinedSignal(controller);
				upstreamResponse = await fetch(attempt.upstreamUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...getProviderHeaders(providerId, attempt.usedToken, { requestId }),
					},
					body: JSON.stringify(upstreamRequestBody),
					signal: fetchSignal,
				});
			} catch (error) {
				const isCanceled =
					error instanceof Error && error.name === "AbortError";
				const isTimeout = isTimeoutError(error);
				const isNetworkError = error instanceof TypeError;
				if (!isCanceled && !isTimeout && !isNetworkError) {
					throw error;
				}
				fetchError = error instanceof Error ? error : new Error(String(error));
				upstreamResponse = undefined as unknown as Response;
			}

			if (fetchError !== null) {
				const isCanceled = fetchError.name === "AbortError";
				const isTimeout = isTimeoutError(fetchError);
				const duration = Date.now() - startedAt;

				if (attempt.envVarName !== undefined) {
					reportKeyError(
						attempt.envVarName,
						attempt.configIndex,
						0,
						undefined,
						upstreamModel,
					);
				}
				if (attempt.providerKey?.id) {
					reportTrackedKeyError(
						attempt.providerKey.id,
						0,
						undefined,
						upstreamModel,
					);
				}

				const networkErrorType = isTimeout
					? "upstream_timeout"
					: "network_error";
				const nextAttempt =
					!isCanceled && isRetryableErrorType(networkErrorType)
						? await resolveNextAttempt(attempt)
						: null;
				const willRetry = nextAttempt !== null;

				if (!isCanceled) {
					routingAttempts.push(
						buildRoutingAttempt(
							providerId,
							modelDefId,
							0,
							networkErrorType,
							false,
							{
								apiKeyHash: usedApiKeyHash,
								logId: willRetry ? attemptLogId : finalLogId,
							},
						),
					);
				}

				await insertLog({
					...baseLogEntry,
					id: willRetry ? attemptLogId : finalLogId,
					routingMetadata: buildSpeechRoutingMetadata(usedApiKeyHash),
					duration,
					timeToFirstToken: null,
					timeToFirstReasoningToken: null,
					responseSize: 0,
					content: null,
					reasoningContent: null,
					finishReason: isCanceled ? "canceled" : "upstream_error",
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
					hasError: !isCanceled,
					streamed: false,
					canceled: isCanceled,
					errorDetails: isCanceled
						? null
						: {
								statusCode: 0,
								statusText: fetchError.name,
								responseText: fetchError.message,
							},
					inputCost: 0,
					outputCost: 0,
					cachedInputCost: 0,
					requestCost: 0,
					webSearchCost: 0,
					imageInputTokens: null,
					imageOutputTokens: null,
					imageInputCost: null,
					imageOutputCost: null,
					cost: 0,
					estimatedCost: false,
					discount: null,
					pricingTier: null,
					dataStorageCost: calculateDataStorageCost(
						null,
						null,
						null,
						null,
						retentionLevel,
					),
					cached: false,
					toolResults: null,
					retried: willRetry,
					retriedByLogId: willRetry ? finalLogId : null,
				});

				if (willRetry && nextAttempt) {
					attempt = nextAttempt;
					continue;
				}

				if (isCanceled) {
					return c.json(
						{
							error: {
								message: "Request canceled by client",
								type: "canceled",
								param: null,
								code: "request_canceled",
							},
						} satisfies SpeechErrorBody,
						400,
					);
				}

				return c.json(
					{
						error: {
							message: isTimeout
								? `Upstream provider timeout: ${fetchError.message}`
								: `Failed to connect to provider: ${fetchError.message}`,
							type: isTimeout ? "upstream_timeout" : "upstream_error",
							param: null,
							code: isTimeout ? "timeout" : "fetch_failed",
						},
					} satisfies SpeechErrorBody,
					isTimeout ? 504 : 502,
				);
			}

			const upstreamText = await upstreamResponse.text();
			const duration = Date.now() - startedAt;
			const responseSize = upstreamText.length;

			let upstreamJson: any = null;
			if (upstreamText) {
				try {
					upstreamJson = JSON.parse(upstreamText);
				} catch {
					upstreamJson = upstreamText;
				}
			}

			if (!upstreamResponse.ok) {
				const status = upstreamResponse.status;
				if (attempt.envVarName !== undefined) {
					reportKeyError(
						attempt.envVarName,
						attempt.configIndex,
						status,
						upstreamText,
						upstreamModel,
					);
				}
				if (attempt.providerKey?.id) {
					reportTrackedKeyError(
						attempt.providerKey.id,
						status,
						upstreamText,
						upstreamModel,
					);
				}

				const finishReason = getFinishReasonFromError(status, upstreamText);
				const nextAttempt = shouldRetryAlternateKey(
					finishReason,
					status,
					upstreamText,
				)
					? await resolveNextAttempt(attempt)
					: null;
				const willRetry = nextAttempt !== null;

				routingAttempts.push(
					buildRoutingAttempt(
						providerId,
						modelDefId,
						status,
						getErrorType(status),
						false,
						{
							apiKeyHash: usedApiKeyHash,
							logId: willRetry ? attemptLogId : finalLogId,
						},
					),
				);

				await insertLog({
					...baseLogEntry,
					id: willRetry ? attemptLogId : finalLogId,
					routingMetadata: buildSpeechRoutingMetadata(usedApiKeyHash),
					duration,
					timeToFirstToken: null,
					timeToFirstReasoningToken: null,
					responseSize,
					content: null,
					reasoningContent: null,
					finishReason,
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
					hasError: true,
					streamed: false,
					canceled: false,
					errorDetails: {
						statusCode: status,
						statusText: upstreamResponse.statusText,
						responseText: upstreamText,
					},
					inputCost: 0,
					outputCost: 0,
					cachedInputCost: 0,
					requestCost: 0,
					webSearchCost: 0,
					imageInputTokens: null,
					imageOutputTokens: null,
					imageInputCost: null,
					imageOutputCost: null,
					cost: 0,
					estimatedCost: false,
					discount: null,
					pricingTier: null,
					dataStorageCost: calculateDataStorageCost(
						null,
						null,
						null,
						null,
						retentionLevel,
					),
					cached: false,
					toolResults: null,
					retried: willRetry,
					retriedByLogId: willRetry ? finalLogId : null,
				});

				if (willRetry && nextAttempt) {
					attempt = nextAttempt;
					continue;
				}

				const normalizedUpstreamError: SpeechErrorBody = {
					error: {
						message:
							typeof upstreamJson === "string"
								? upstreamJson
								: (upstreamJson?.error?.message ??
									upstreamResponse.statusText ??
									"Upstream error"),
						type: "upstream_error",
						param: null,
						code: "upstream_error",
					},
				};

				return c.json(
					normalizedUpstreamError,
					status as 400 | 401 | 403 | 404 | 410 | 429 | 500 | 502 | 503 | 504,
				);
			}

			// Extract the audio payload from the Gemini response.
			const parts = upstreamJson?.candidates?.[0]?.content?.parts ?? [];
			const audioPart = Array.isArray(parts)
				? parts.find((p: any) => p?.inlineData?.data)
				: undefined;
			const base64Audio: string | undefined = audioPart?.inlineData?.data;
			const audioMimeType: string | undefined = audioPart?.inlineData?.mimeType;

			if (!base64Audio) {
				const finishReason =
					upstreamJson?.candidates?.[0]?.finishReason ?? "error";
				logger.warn("Speech API - no audio in response", {
					requestId,
					model: upstreamModel,
					finishReason,
				});

				routingAttempts.push(
					buildRoutingAttempt(
						providerId,
						modelDefId,
						upstreamResponse.status,
						"none",
						false,
						{
							apiKeyHash: usedApiKeyHash,
							logId: finalLogId,
						},
					),
				);

				await insertLog({
					...baseLogEntry,
					id: finalLogId,
					routingMetadata: buildSpeechRoutingMetadata(usedApiKeyHash),
					duration,
					timeToFirstToken: null,
					timeToFirstReasoningToken: null,
					responseSize,
					content: null,
					reasoningContent: null,
					finishReason: "content_filter",
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
					hasError: true,
					streamed: false,
					canceled: false,
					errorDetails: {
						statusCode: upstreamResponse.status,
						statusText: "no_audio",
						responseText: upstreamText.slice(0, 2000),
					},
					inputCost: 0,
					outputCost: 0,
					cachedInputCost: 0,
					requestCost: 0,
					webSearchCost: 0,
					imageInputTokens: null,
					imageOutputTokens: null,
					imageInputCost: null,
					imageOutputCost: null,
					cost: 0,
					estimatedCost: false,
					discount: null,
					pricingTier: null,
					dataStorageCost: calculateDataStorageCost(
						null,
						null,
						null,
						null,
						retentionLevel,
					),
					cached: false,
					toolResults: null,
				});

				return c.json(
					{
						error: {
							message:
								"The model did not return any audio. The content may have been filtered.",
							type: "upstream_error",
							param: null,
							code: "no_audio",
						},
					} satisfies SpeechErrorBody,
					500,
				);
			}

			if (attempt.envVarName !== undefined) {
				reportKeySuccess(
					attempt.envVarName,
					attempt.configIndex,
					upstreamModel,
				);
			}
			if (attempt.providerKey?.id) {
				reportTrackedKeySuccess(attempt.providerKey.id, upstreamModel);
			}

			const pcm = Buffer.from(base64Audio, "base64");
			const sampleRate = parseSampleRate(audioMimeType);
			const out = responseFormat === "pcm" ? pcm : pcmToWav(pcm, sampleRate);
			const contentType = responseFormat === "pcm" ? "audio/pcm" : "audio/wav";

			const usage = upstreamJson?.usageMetadata ?? {};
			const promptTokens =
				typeof usage.promptTokenCount === "number"
					? usage.promptTokenCount
					: null;
			const audioOutputTokens =
				typeof usage.candidatesTokenCount === "number"
					? usage.candidatesTokenCount
					: null;

			const inputPrice = Number(mapping.inputPrice ?? "0");
			const outputAudioPrice = Number(
				mapping.outputAudioPrice ?? mapping.outputPrice ?? "0",
			);
			const inputCost = promptTokens !== null ? promptTokens * inputPrice : 0;
			const outputCost =
				audioOutputTokens !== null ? audioOutputTokens * outputAudioPrice : 0;
			const requestCost = Number(mapping.requestPrice ?? "0");
			const cost = inputCost + outputCost + requestCost;
			const totalTokens =
				promptTokens !== null || audioOutputTokens !== null
					? (promptTokens ?? 0) + (audioOutputTokens ?? 0)
					: null;

			routingAttempts.push(
				buildRoutingAttempt(
					providerId,
					modelDefId,
					upstreamResponse.status,
					"none",
					true,
					{
						apiKeyHash: usedApiKeyHash,
						logId: finalLogId,
					},
				),
			);

			await insertLog({
				...baseLogEntry,
				id: finalLogId,
				routingMetadata: buildSpeechRoutingMetadata(usedApiKeyHash),
				duration,
				timeToFirstToken: null,
				timeToFirstReasoningToken: null,
				responseSize: out.length,
				content: `[audio: ${out.length} bytes, ${audioMimeType ?? "audio/wav"}]`,
				reasoningContent: null,
				finishReason: "stop",
				promptTokens: promptTokens !== null ? promptTokens.toString() : null,
				completionTokens:
					audioOutputTokens !== null ? audioOutputTokens.toString() : null,
				totalTokens: totalTokens !== null ? totalTokens.toString() : null,
				reasoningTokens: null,
				cachedTokens: null,
				hasError: false,
				streamed: false,
				canceled: false,
				errorDetails: null,
				inputCost,
				outputCost,
				cachedInputCost: 0,
				requestCost,
				webSearchCost: 0,
				imageInputTokens: null,
				imageOutputTokens: null,
				imageInputCost: null,
				imageOutputCost: null,
				cost,
				estimatedCost: promptTokens === null || audioOutputTokens === null,
				discount: null,
				pricingTier: null,
				dataStorageCost: calculateDataStorageCost(
					promptTokens,
					null,
					audioOutputTokens,
					null,
					retentionLevel,
				),
				cached: false,
				toolResults: null,
			});

			return c.body(toArrayBuffer(out), 200, {
				"Content-Type": contentType,
				"Content-Length": String(out.length),
				"x-request-id": requestId,
			});
		}
	} finally {
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}
});
