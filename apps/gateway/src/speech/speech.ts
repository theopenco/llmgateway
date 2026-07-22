import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
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
import {
	assertApiKeyWithinUsageLimits,
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
} from "@/lib/cached-queries.js";
import { getClientIpFromRequest } from "@/lib/client-ip.js";
import { assertProviderCompliant } from "@/lib/compliance.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { createFailedKeyTracker } from "@/lib/failed-key-tracker.js";
import { throwIamException, validateRequestModelAccess } from "@/lib/iam.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { createCombinedSignal, isTimeoutError } from "@/lib/timeout-config.js";

import { getProviderHeaders } from "@llmgateway/actions";
import { shortid } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	ELEVENLABS_VOICE_IDS,
	getProviderEnvValue,
	models as modelDefinitions,
	resolveVertexTokenType,
} from "@llmgateway/models";

import type { RoutingAttempt } from "@/chat/tools/retry-with-fallback.js";
import type { ServerTypes } from "@/vars.js";
import type { RoutingMetadata } from "@llmgateway/actions";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type {
	ModelDefinition,
	ProviderModelMapping,
	VertexTokenType,
} from "@llmgateway/models";

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
				"The audio format of the returned audio. OpenAI models support mp3 (default), opus, aac, flac, wav and pcm. Gemini models emit PCM, so only wav (default) and pcm are supported.",
			example: "wav",
		}),
	speed: z.number().min(0.25).max(4).optional().openapi({
		description:
			"Playback speed hint. Forwarded to OpenAI models; not applied by Gemini speech models.",
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

const speechErrorSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		param: z.string().nullable(),
		code: z.string(),
	}),
});

/** Minimal shape of a Gemini `generateContent` response part. */
interface GeminiPart {
	text?: string;
	inlineData?: { mimeType?: string; data?: string };
}

/** Minimal shape of the Gemini `generateContent` response we consume. */
interface GeminiResponse {
	candidates?: Array<{
		content?: { parts?: GeminiPart[] };
		finishReason?: string;
	}>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
	};
	error?: { message?: string };
}

/** Minimal shape of an OpenAI `/v1/audio/speech` SSE event. */
interface SpeechSseEvent {
	type?: string;
	audio?: string;
	usage?: { input_tokens?: number; output_tokens?: number };
	error?: { message?: string };
}

function hasInlineAudio(
	part: GeminiPart,
): part is GeminiPart & { inlineData: { data: string; mimeType?: string } } {
	return typeof part.inlineData?.data === "string";
}

function extractUpstreamErrorMessage(value: unknown, fallback: string): string {
	if (typeof value === "string" && value) {
		return value;
	}
	if (value && typeof value === "object") {
		const message = (value as { error?: { message?: unknown } }).error?.message;
		if (typeof message === "string" && message) {
			return message;
		}
	}
	return fallback;
}

const PROVIDER_BASE_URL_DEFAULTS: Partial<Record<string, string>> = {
	"google-ai-studio": "https://generativelanguage.googleapis.com",
	"google-vertex": "https://aiplatform.googleapis.com",
	openai: "https://api.openai.com",
	elevenlabs: "https://api.elevenlabs.io",
};

const SUPPORTED_PROVIDERS = new Set([
	"google-ai-studio",
	"google-vertex",
	"openai",
	"elevenlabs",
]);

// Response formats Gemini can satisfy. Gemini emits raw PCM, so the gateway can
// only return PCM directly or wrapped in a WAV container.
const GOOGLE_RESPONSE_FORMATS = new Set(["wav", "pcm"]);

// OpenAI's speech endpoint returns the audio already encoded in the requested
// format, so all of its formats pass straight through.
const OPENAI_RESPONSE_FORMATS = new Set([
	"mp3",
	"opus",
	"aac",
	"flac",
	"wav",
	"pcm",
]);

const OPENAI_CONTENT_TYPES: Record<string, string> = {
	mp3: "audio/mpeg",
	opus: "audio/opus",
	aac: "audio/aac",
	flac: "audio/flac",
	wav: "audio/wav",
	pcm: "audio/pcm",
};

// ElevenLabs returns the audio already encoded in the requested format. It does
// not support aac/flac, but adds first-class WAV (RIFF-wrapped) output, so the
// gateway can pass every supported format straight through.
const ELEVENLABS_RESPONSE_FORMATS = new Set(["mp3", "wav", "pcm", "opus"]);

// Maps the gateway's generic response_format to the concrete ElevenLabs
// `output_format` query value (codec + sample rate + bitrate). WAV and PCM use
// 32 kHz — the highest rate available across all paid plans (and free), since
// the 44.1 kHz WAV/PCM variants are gated behind the Pro tier.
const ELEVENLABS_OUTPUT_FORMATS: Record<string, string> = {
	mp3: "mp3_44100_128",
	wav: "wav_32000",
	pcm: "pcm_32000",
	opus: "opus_48000_128",
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
			if (model.id === modelKey) {
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
	const chatPlanCreditsRemaining =
		organization.chatPlan !== "none"
			? parseFloat(organization.chatPlanCreditsLimit ?? "0") -
				parseFloat(organization.chatPlanCreditsUsed ?? "0")
			: 0;

	return {
		devPlanCreditsRemaining,
		chatPlanCreditsRemaining,
		totalAvailableCredits:
			regularCredits + devPlanCreditsRemaining + chatPlanCreditsRemaining,
	};
}

function assertCreditsAvailable(
	organization: InferSelectModel<typeof tables.organization>,
	modelDef: ModelDefinition,
	insufficientCreditsMessage: string,
	devPlanCreditLimitMessage: (renewalDate: string) => string,
) {
	const {
		devPlanCreditsRemaining,
		chatPlanCreditsRemaining,
		totalAvailableCredits,
	} = getAvailableCredits(organization);

	if (totalAvailableCredits > 0 || modelDef.free) {
		return;
	}

	if (
		organization.chatPlan !== "none" &&
		chatPlanCreditsRemaining <= 0 &&
		devPlanCreditsRemaining <= 0
	) {
		const renewalDate = organization.chatPlanExpiresAt
			? new Date(organization.chatPlanExpiresAt).toLocaleDateString()
			: "your next billing date";
		throw new HTTPException(402, {
			message: `Chat Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
		});
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

const createSpeech = createRoute({
	operationId: "v1_audio_speech",
	summary: "Create speech",
	description:
		"Generates audio from input text (text-to-speech). Returns the audio file as binary data.",
	method: "post",
	path: "/",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {
		body: {
			content: {
				"application/json": {
					schema: speechRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"audio/wav": { schema: z.any() },
				"audio/mpeg": { schema: z.any() },
				"application/octet-stream": { schema: z.any() },
			},
			description: "Generated audio.",
		},
		400: {
			content: { "application/json": { schema: speechErrorSchema } },
			description: "Invalid request body or parameters.",
		},
		401: {
			content: { "application/json": { schema: speechErrorSchema } },
			description: "Unauthorized request.",
		},
		402: {
			content: { "application/json": { schema: speechErrorSchema } },
			description: "Payment required / insufficient credits.",
		},
		403: {
			content: { "application/json": { schema: speechErrorSchema } },
			description: "Forbidden.",
		},
		500: {
			content: { "application/json": { schema: speechErrorSchema } },
			description: "Internal server error.",
		},
		502: {
			content: { "application/json": { schema: speechErrorSchema } },
			description: "Failed to connect to the upstream provider.",
		},
		504: {
			content: { "application/json": { schema: speechErrorSchema } },
			description: "Upstream provider timeout.",
		},
	},
});

speech.openapi(createSpeech, async (c): Promise<Response> => {
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
	const isOpenAI = providerId === "openai";
	const isElevenLabs = providerId === "elevenlabs";
	const isGoogleVertex = providerId === "google-vertex";
	// OpenAI and ElevenLabs both return audio already encoded in the requested
	// format and bill independently of Gemini's inline-PCM path.
	const isEncodedPassthrough = isOpenAI || isElevenLabs;
	// OpenAI models split into two billing/transport modes:
	//   - character-billed (tts-1, tts-1-hd): plain binary response, no usage.
	//   - token-billed (gpt-4o-mini-tts): request stream_format=sse so the
	//     speech.audio.done event reports input/output token usage exactly.
	const billByCharacters =
		isOpenAI && mapping.inputCharacterPrice !== undefined;
	const useSse = isOpenAI && !billByCharacters;

	if (!SUPPORTED_PROVIDERS.has(providerId)) {
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

	const responseFormat =
		request.response_format ?? (isEncodedPassthrough ? "mp3" : "wav");
	const allowedFormats = isOpenAI
		? OPENAI_RESPONSE_FORMATS
		: isElevenLabs
			? ELEVENLABS_RESPONSE_FORMATS
			: GOOGLE_RESPONSE_FORMATS;
	if (!allowedFormats.has(responseFormat)) {
		return c.json(
			{
				error: {
					message: isOpenAI
						? `Unsupported response_format '${responseFormat}'.`
						: isElevenLabs
							? `Unsupported response_format '${responseFormat}'. ElevenLabs supports 'mp3', 'wav', 'pcm' and 'opus'.`
							: `Unsupported response_format '${responseFormat}'. Gemini speech models only support 'wav' and 'pcm'.`,
					type: "invalid_request_error",
					param: "response_format",
					code: "unsupported_response_format",
				},
			} satisfies SpeechErrorBody,
			400,
		);
	}

	const supportedVoices = mapping.supportedVoices ?? [];
	if (
		request.voice !== undefined &&
		supportedVoices.length > 0 &&
		!supportedVoices.includes(request.voice)
	) {
		return c.json(
			{
				error: {
					message: `Unsupported voice '${request.voice}' for model ${modelDefId}. Supported voices: ${supportedVoices.join(", ")}.`,
					type: "invalid_request_error",
					param: "voice",
					code: "unsupported_voice",
				},
			} satisfies SpeechErrorBody,
			400,
		);
	}
	const voice =
		request.voice ?? supportedVoices[0] ?? (isOpenAI ? "alloy" : "Kore");

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

	if (!apiKey) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. The token could not be found. Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	if (apiKey.status !== "active") {
		throw new HTTPException(401, {
			message:
				"Unauthorized: This LLMGateway API token is not active (it may be disabled or deleted). Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		throw new HTTPException(500, { message: "Could not find project" });
	}
	if (project.status === "deleted") {
		throw new HTTPException(410, {
			message: "Project has been archived and is no longer accessible",
		});
	}

	// User-level limits take priority: enforce the per-member budget (set on the
	// Teams page; fails open on read errors) before the per-key usage limits, so a
	// member who is over budget is denied even if the key itself is within limits.
	await assertMemberWithinBudget(apiKey.createdBy, project.organizationId);
	assertApiKeyWithinUsageLimits(apiKey);

	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		throw new HTTPException(500, { message: "Could not find organization" });
	}
	if (organization.status === "deleted") {
		throw new HTTPException(410, {
			message: "Organization has been disabled and is no longer accessible",
		});
	}

	if (organization.kind === "devpass" && organization.devPlan !== "none") {
		throw new HTTPException(403, {
			message:
				"Speech generation is not available for coding plans. Coding plans only include text-based inference.",
		});
	}

	const retentionLevel = organization.retentionLevel ?? "none";
	const iamValidation = await validateRequestModelAccess({
		apiKey,
		organizationId: project.organizationId,
		requestedModel: modelDefId,
		requestedProvider: providerId,
		activeModelInfo: modelDef,
		clientIp: getClientIpFromRequest(c),
	});
	if (!iamValidation.allowed) {
		throwIamException(iamValidation.reason ?? "Model access denied");
	}

	// Enterprise provider compliance policy: speech resolves to a single
	// provider, so block before sending if it doesn't meet the org's policy.
	await assertProviderCompliant(organization, providerId, {
		organizationId: project.organizationId,
		modelId: modelDefId,
		apiKeyId: apiKey.id,
		model: requestedModel,
	});

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

	const upstreamRequestBody: Record<string, unknown> = isOpenAI
		? {
				model: upstreamModel,
				input: request.input,
				voice,
				response_format: responseFormat,
				...(request.speed !== undefined ? { speed: request.speed } : {}),
				// `instructions` and SSE streaming only apply to gpt-4o-mini-tts;
				// tts-1/tts-1-hd reject both.
				...(useSse && request.instructions
					? { instructions: request.instructions }
					: {}),
				...(useSse ? { stream_format: "sse" } : {}),
			}
		: isElevenLabs
			? {
					// The voice id is encoded in the URL path; the output format is a
					// query param. `speed` is forwarded via voice_settings when set.
					text: request.input,
					model_id: upstreamModel,
					...(request.speed !== undefined
						? { voice_settings: { speed: request.speed } }
						: {}),
				}
			: {
					contents: [{ role: "user", parts: [{ text: promptText }] }],
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
		vertexTokenType?: VertexTokenType;
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

		const elevenLabsOutputFormat =
			ELEVENLABS_OUTPUT_FORMATS[responseFormat] ?? "mp3_44100_128";
		// ElevenLabs voices are addressed by id. Resolve our friendly voice name
		// to the upstream id, falling back to the raw value so callers may also
		// pass a voice id directly.
		const elevenLabsVoiceId = ELEVENLABS_VOICE_IDS[voice] ?? voice;

		let upstreamUrl: string;
		let vertexTokenType: VertexTokenType | undefined;
		if (isOpenAI) {
			upstreamUrl = `${resolvedBaseUrl}/v1/audio/speech`;
		} else if (isElevenLabs) {
			upstreamUrl = `${resolvedBaseUrl}/v1/text-to-speech/${encodeURIComponent(elevenLabsVoiceId)}?output_format=${elevenLabsOutputFormat}`;
		} else if (isGoogleVertex) {
			const vertexProjectId =
				providerKey?.options?.google_vertex_project_id ??
				getProviderEnvValue("google-vertex", "project", configIndex);
			if (!vertexProjectId) {
				throw new HTTPException(500, {
					message:
						"Google Vertex requires a project ID. Set LLM_GOOGLE_CLOUD_PROJECT or configure google_vertex_project_id on the provider key.",
				});
			}
			const vertexRegion =
				getProviderEnvValue("google-vertex", "region", configIndex, "global") ??
				"global";
			// OAuth tokens are sent via the Authorization header; only API keys go
			// in the `?key=` query param. Resolve once so the header and the query
			// param agree.
			vertexTokenType = resolveVertexTokenType(
				"google-vertex",
				providerKey?.options ?? undefined,
				configIndex,
				providerKey !== undefined,
			);
			const vertexAuthQuery =
				vertexTokenType === "oauth"
					? ""
					: `?key=${encodeURIComponent(usedToken)}`;
			upstreamUrl = `${resolvedBaseUrl}/v1/projects/${vertexProjectId}/locations/${vertexRegion}/publishers/google/models/${upstreamModel}:generateContent${vertexAuthQuery}`;
		} else {
			upstreamUrl = `${resolvedBaseUrl}/v1beta/models/${upstreamModel}:generateContent?key=${encodeURIComponent(usedToken)}`;
		}

		return {
			providerKey,
			usedToken,
			configIndex,
			envVarName,
			upstreamUrl,
			vertexTokenType,
		};
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
					// SSRF: never follow redirects on an authenticated provider request. A
					// tenant-supplied baseUrl could 3xx to an internal host at request
					// time, and a redirect would also leak the upstream token.
					redirect: "error",
					headers: {
						"Content-Type": "application/json",
						...getProviderHeaders(providerId, attempt.usedToken, {
							requestId,
							tokenType: attempt.vertexTokenType,
						}),
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

				// A client-initiated abort is not the provider key's fault, so don't
				// penalize key health for it.
				if (!isCanceled) {
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

			const duration = Date.now() - startedAt;

			if (!upstreamResponse.ok) {
				const upstreamText = await upstreamResponse.text();
				const responseSize = upstreamText.length;
				let upstreamJson: unknown = null;
				if (upstreamText) {
					try {
						upstreamJson = JSON.parse(upstreamText);
					} catch {
						upstreamJson = upstreamText;
					}
				}
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
						message: extractUpstreamErrorMessage(
							upstreamJson,
							upstreamResponse.statusText || "Upstream error",
						),
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

			// HTTP 200 — the credential worked.
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

			// OpenAI and ElevenLabs return the audio already encoded in the
			// requested format. ElevenLabs bills by input characters, matching the
			// binary (non-SSE) OpenAI path below.
			if (isEncodedPassthrough) {
				let out: Buffer;
				let contentType: string;
				let inputCost: number;
				let outputCost = 0;
				let promptTokens: number | null = null;
				let completionTokens: number | null = null;
				const requestCost = Number(mapping.requestPrice ?? "0");

				if (useSse) {
					// gpt-4o-mini-tts: parse the SSE stream, concatenating the base64
					// audio deltas and reading exact token usage from the done event.
					const sseText = await upstreamResponse.text();
					const chunks: Buffer[] = [];
					let inputTokens: number | null = null;
					let outputTokens: number | null = null;
					let sseErrorMessage: string | null = null;
					for (const line of sseText.split("\n")) {
						const trimmed = line.trim();
						if (!trimmed.startsWith("data:")) {
							continue;
						}
						const payload = trimmed.slice(5).trim();
						if (!payload || payload === "[DONE]") {
							continue;
						}
						let event: SpeechSseEvent;
						try {
							event = JSON.parse(payload) as SpeechSseEvent;
						} catch {
							continue;
						}
						if (event.type === "speech.audio.delta" && event.audio) {
							chunks.push(Buffer.from(event.audio, "base64"));
						} else if (event.type === "speech.audio.done" && event.usage) {
							inputTokens =
								typeof event.usage.input_tokens === "number"
									? event.usage.input_tokens
									: null;
							outputTokens =
								typeof event.usage.output_tokens === "number"
									? event.usage.output_tokens
									: null;
						} else if (event.type === "error") {
							sseErrorMessage = event.error?.message ?? "Speech stream error";
						}
					}

					// A 200 SSE stream can still carry an error frame or yield no audio;
					// surface that as a failure instead of returning an empty 200.
					if (sseErrorMessage !== null || chunks.length === 0) {
						logger.warn("Speech API - no audio in SSE stream", {
							requestId,
							model: upstreamModel,
							sseError: sseErrorMessage,
						});
						routingAttempts.push(
							buildRoutingAttempt(
								providerId,
								modelDefId,
								upstreamResponse.status,
								"upstream_error",
								false,
								{ apiKeyHash: usedApiKeyHash, logId: finalLogId },
							),
						);
						await insertLog({
							...baseLogEntry,
							id: finalLogId,
							routingMetadata: buildSpeechRoutingMetadata(usedApiKeyHash),
							duration,
							timeToFirstToken: null,
							timeToFirstReasoningToken: null,
							responseSize: sseText.length,
							content: null,
							reasoningContent: null,
							finishReason: "upstream_error",
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
								responseText: (sseErrorMessage ?? sseText).slice(0, 2000),
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
										sseErrorMessage ??
										"The model did not return any audio. The content may have been filtered.",
									type: "upstream_error",
									param: null,
									code: "no_audio",
								},
							} satisfies SpeechErrorBody,
							502,
						);
					}

					out = Buffer.concat(chunks);
					contentType = OPENAI_CONTENT_TYPES[responseFormat] ?? "audio/mpeg";
					promptTokens = inputTokens;
					completionTokens = outputTokens;
					const inputPrice = Number(mapping.inputPrice ?? "0");
					const outputAudioPrice = Number(
						mapping.outputAudioPrice ?? mapping.outputPrice ?? "0",
					);
					inputCost = inputTokens !== null ? inputTokens * inputPrice : 0;
					outputCost =
						outputTokens !== null ? outputTokens * outputAudioPrice : 0;
				} else {
					// tts-1 / tts-1-hd and all ElevenLabs models: binary passthrough
					// billed by input characters.
					out = Buffer.from(await upstreamResponse.arrayBuffer());
					contentType =
						upstreamResponse.headers.get("content-type") ??
						OPENAI_CONTENT_TYPES[responseFormat] ??
						"audio/mpeg";
					const characters = request.input.length;
					const inputCharacterPrice = Number(
						mapping.inputCharacterPrice ?? "0",
					);
					inputCost = characters * inputCharacterPrice;
				}

				const cost = inputCost + outputCost + requestCost;
				const totalTokens =
					promptTokens !== null || completionTokens !== null
						? (promptTokens ?? 0) + (completionTokens ?? 0)
						: null;
				// SSE bills on reported usage; flag estimated if the done event is
				// missing usage (character-billed models are always exact).
				const estimatedCost =
					useSse && (promptTokens === null || completionTokens === null);

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
					content: `[audio: ${out.length} bytes, ${contentType}]`,
					reasoningContent: null,
					finishReason: "stop",
					promptTokens: promptTokens !== null ? promptTokens.toString() : null,
					completionTokens:
						completionTokens !== null ? completionTokens.toString() : null,
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
					estimatedCost,
					discount: null,
					pricingTier: null,
					dataStorageCost: calculateDataStorageCost(
						promptTokens,
						null,
						completionTokens,
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

			// Google (AI Studio or Vertex): parse the inline PCM audio from the
			// JSON generateContent response — both return the same shape.
			const upstreamText = await upstreamResponse.text();
			const responseSize = upstreamText.length;
			let upstreamJson: GeminiResponse = {};
			if (upstreamText) {
				try {
					upstreamJson = JSON.parse(upstreamText) as GeminiResponse;
				} catch {
					upstreamJson = {};
				}
			}

			// Extract the audio payload from the Gemini response.
			const parts = upstreamJson.candidates?.[0]?.content?.parts ?? [];
			const audioPart = parts.find(hasInlineAudio);
			const base64Audio: string | undefined = audioPart?.inlineData.data;
			const audioMimeType: string | undefined = audioPart?.inlineData.mimeType;

			if (!base64Audio) {
				const finishReason =
					upstreamJson.candidates?.[0]?.finishReason ?? "error";
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

			const pcm = Buffer.from(base64Audio, "base64");
			const sampleRate = parseSampleRate(audioMimeType);
			const out = responseFormat === "pcm" ? pcm : pcmToWav(pcm, sampleRate);
			const contentType = responseFormat === "pcm" ? "audio/pcm" : "audio/wav";

			const usage = upstreamJson.usageMetadata ?? {};
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
