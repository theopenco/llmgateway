import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { getProviderEnv } from "@/chat/tools/get-provider-env.js";
import {
	getErrorType,
	selectNextProvider,
	shouldRetryRequest,
	type RoutingAttempt,
} from "@/chat/tools/retry-with-fallback.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
} from "@/lib/cached-queries.js";
import { validateModelAccess } from "@/lib/iam.js";

import {
	getCheapestFromAvailableProviders,
	getProviderHeaders,
	getProviderSelectionPrice,
	processImageUrl,
	type RoutingMetadata,
	type VideoPricingContext,
} from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import {
	and,
	db,
	eq,
	getProviderMetricsForCombinations,
	sql,
	shortid,
	tables,
	type InferSelectModel,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getProviderEnvValue,
	hasProviderEnvironmentToken,
	models,
	type ModelDefinition,
	type Provider,
	type ProviderModelMapping,
} from "@llmgateway/models";
import {
	getAvalancheApiBaseUrl,
	getAvalancheFileUploadBaseUrl,
	getAvalancheJobsApiBaseUrl,
	getVideoProxyRedisKey,
	VIDEO_PROXY_REDIS_TTL_SECONDS,
} from "@llmgateway/shared";
import {
	buildVertexVideoOutputStorageUri,
	createSignedGcsReadUrl,
	getGoogleVertexVideoOutputBucket,
	getGoogleVertexVideoOutputPrefix,
	parseGcsUri,
} from "@llmgateway/shared/gcs";
import {
	buildSignedGatewayVideoLogContentUrl,
	verifyVideoContentAccessToken,
} from "@llmgateway/shared/video-access";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

const TERMINAL_VIDEO_STATUSES = new Set([
	"completed",
	"failed",
	"canceled",
	"expired",
]);
const MIN_VIDEO_GENERATION_BALANCE = 1;
const DEFAULT_VIDEO_SIZE = "1280x720";
const SUPPORTED_VIDEO_SIZES = {
	"1280x720": {
		size: "1280x720",
		width: 1280,
		height: 720,
		resolution: "720p",
		orientation: "landscape",
	},
	"720x1280": {
		size: "720x1280",
		width: 720,
		height: 1280,
		resolution: "720p",
		orientation: "portrait",
	},
	"1920x1080": {
		size: "1920x1080",
		width: 1920,
		height: 1080,
		resolution: "1080p",
		orientation: "landscape",
	},
	"1080x1920": {
		size: "1080x1920",
		width: 1080,
		height: 1920,
		resolution: "1080p",
		orientation: "portrait",
	},
	"3840x2160": {
		size: "3840x2160",
		width: 3840,
		height: 2160,
		resolution: "4k",
		orientation: "landscape",
	},
	"2160x3840": {
		size: "2160x3840",
		width: 2160,
		height: 3840,
		resolution: "4k",
		orientation: "portrait",
	},
	"1792x1024": {
		size: "1792x1024",
		width: 1792,
		height: 1024,
		resolution: "hd",
		orientation: "landscape",
	},
	"1024x1792": {
		size: "1024x1792",
		width: 1024,
		height: 1792,
		resolution: "hd",
		orientation: "portrait",
	},
} as const;

type SupportedVideoSize = keyof typeof SUPPORTED_VIDEO_SIZES;
type VideoSizeConfig = (typeof SUPPORTED_VIDEO_SIZES)[SupportedVideoSize];

const videoImageInputSchema = z
	.union([
		z.string(),
		z.object({
			image_url: z.string(),
		}),
	])
	.openapi({
		description:
			"Input image for image-to-video generation. Supports HTTPS URLs and base64 data URLs. Routed to provider-specific image-to-video generation when supported by the selected model.",
		example: {
			image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
		},
	});

const videoReferenceImagesSchema = z.array(videoImageInputSchema).min(1).max(3);

const createVideoRequestSchema = z
	.object({
		model: z.string().default("veo-3.1-generate-preview").openapi({
			description:
				"The video generation model to use. Supports current Veo and Sora video models, including provider-prefixed variants like openai/sora-2 or avalanche/veo-3.1-generate-preview.",
			example: "veo-3.1-generate-preview",
		}),
		prompt: z.string().min(1).openapi({
			description: "Text prompt describing the video to generate.",
			example:
				"A cinematic drone shot flying through a neon-lit futuristic city at night",
		}),
		size: z.string().optional().openapi({
			description:
				"Output resolution in OpenAI widthxheight format. Supported values depend on the selected model and provider mapping.",
			example: "1280x720",
		}),
		callback_url: z.string().url().optional().openapi({
			description:
				"LLMGateway extension. When set, a signed webhook is delivered after the job reaches a terminal state.",
			example: "https://example.com/webhooks/video",
		}),
		callback_secret: z.string().min(1).optional().openapi({
			description:
				"LLMGateway extension. Shared secret used to sign webhook deliveries with HMAC-SHA256.",
			example: "whsec_test_secret",
		}),
		input_reference: z
			.union([videoImageInputSchema, videoReferenceImagesSchema])
			.optional()
			.openapi({
				description:
					"Reference image input alias. Accepts HTTPS URLs or base64 data URLs and routes to provider-specific image-guided video generation when supported.",
			}),
		last_frame: videoImageInputSchema.optional().openapi({
			description:
				"Optional ending frame for frame-to-video generation. Requires image and is routed to providers that support first/last-frame generation.",
			example: {
				image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
			},
		}),
		seconds: z.number().int().min(1).openapi({
			description:
				"Output duration in seconds. Supported values depend on the selected model and provider mapping.",
			example: 8,
		}),
		audio: z.boolean().optional().default(true).openapi({
			description:
				"Whether the generated video should include audio. Support depends on the selected model and provider mapping.",
			example: true,
		}),
		n: z.number().int().optional(),
		image: videoImageInputSchema.optional(),
		reference_images: videoReferenceImagesSchema.optional().openapi({
			description:
				"One to three reference images for provider-specific asset or material-guided video generation.",
			example: [
				{
					image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
				},
			],
		}),
	})
	.superRefine((value, ctx) => {
		const hasCallbackUrl = value.callback_url !== undefined;
		const hasCallbackSecret = value.callback_secret !== undefined;

		if (hasCallbackUrl !== hasCallbackSecret) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"callback_url and callback_secret must either both be provided or both be omitted",
				path: hasCallbackUrl ? ["callback_secret"] : ["callback_url"],
			});
		}

		if (value.n !== undefined && value.n !== 1) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Only n=1 is supported for Veo 3.1 preview models",
				path: ["n"],
			});
		}

		if (value.size !== undefined && !(value.size in SUPPORTED_VIDEO_SIZES)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"size must be one of 1280x720, 720x1280, 1920x1080, 1080x1920, 3840x2160, 2160x3840, 1792x1024, or 1024x1792",
				path: ["size"],
			});
		}

		const hasFrameInput =
			value.image !== undefined || value.last_frame !== undefined;
		const hasReferenceInput =
			value.reference_images !== undefined ||
			value.input_reference !== undefined;

		if (value.last_frame !== undefined && value.image === undefined) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "last_frame requires image to also be provided",
				path: ["last_frame"],
			});
		}

		if (
			value.reference_images !== undefined &&
			value.input_reference !== undefined
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Only one of reference_images or input_reference can be provided for a video request",
				path: ["reference_images"],
			});
		}

		if (hasFrameInput && hasReferenceInput) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Frame inputs (image/last_frame) cannot be combined with reference image inputs",
				path: ["image"],
			});
		}
	});

const videoErrorSchema = z.object({
	code: z.string().optional(),
	message: z.string(),
	details: z.unknown().optional(),
});

const videoContentSchema = z.array(
	z.object({
		type: z.literal("video"),
		url: z.string().url(),
		mime_type: z.string().nullable().optional(),
	}),
);

const videoResponseSchema = z.object({
	id: z.string(),
	object: z.literal("video"),
	model: z.string(),
	status: z.enum([
		"queued",
		"in_progress",
		"completed",
		"failed",
		"canceled",
		"expired",
	]),
	progress: z.number().int().min(0).max(100).nullable(),
	created_at: z.number(),
	completed_at: z.number().nullable(),
	expires_at: z.number().nullable(),
	error: videoErrorSchema.nullable(),
	content: videoContentSchema.optional(),
});

const createVideo = createRoute({
	operationId: "v1_videos_create",
	summary: "Create video",
	description:
		"Creates a new asynchronous video generation job using an OpenAI-compatible request format.",
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
					schema: createVideoRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: videoResponseSchema,
				},
			},
			description: "Video job created.",
		},
	},
});

const getVideo = createRoute({
	operationId: "v1_videos_retrieve",
	summary: "Retrieve video",
	description: "Retrieves the current state of a video generation job.",
	method: "get",
	path: "/{video_id}",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {
		params: z.object({
			video_id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: videoResponseSchema,
				},
			},
			description: "Video job state.",
		},
	},
});

const getVideoContent = createRoute({
	operationId: "v1_videos_content",
	summary: "Video content",
	description:
		"Streams the generated video content once the job has completed successfully.",
	method: "get",
	path: "/{video_id}/content",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {
		params: z.object({
			video_id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"video/mp4": {
					schema: z.any(),
				},
				"application/octet-stream": {
					schema: z.any(),
				},
			},
			description: "Video bytes.",
		},
	},
});

const getVideoLogContent = createRoute({
	operationId: "v1_videos_log_content",
	summary: "Video log content",
	description:
		"Streams generated video content through a gateway-managed proxy URL keyed by log ID.",
	method: "get",
	path: "/logs/{log_id}/content",
	request: {
		params: z.object({
			log_id: z.string(),
		}),
		query: z.object({
			token: z.string().min(1).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"video/mp4": {
					schema: z.any(),
				},
				"application/octet-stream": {
					schema: z.any(),
				},
			},
			description: "Video bytes.",
		},
	},
});

type VideoJobRecord = InferSelectModel<typeof tables.videoJob>;
type LogRecord = InferSelectModel<typeof tables.log>;

interface RequestContext {
	apiKey: InferSelectModel<typeof tables.apiKey>;
	project: InferSelectModel<typeof tables.project>;
	organization: InferSelectModel<typeof tables.organization>;
	requestId: string;
}

interface ProviderContext {
	providerId: Provider;
	baseUrl: string;
	token: string;
	usedMode: "api-keys" | "credits";
	configIndex: number | null;
	vertexProjectId?: string;
	vertexRegion?: string;
	uploadBaseUrl?: string;
}

interface ResolvedVideoExecution {
	providerMapping: ProviderModelMapping;
	providerContext: ProviderContext;
	upstreamModelName: string;
	routingMetadata?: RoutingMetadata;
	orderedMappings: ProviderModelMapping[];
}

interface ParsedVideoRequest {
	rawBody: unknown;
	request: z.infer<typeof createVideoRequestSchema>;
}

type VideoImageInput = z.infer<typeof videoImageInputSchema>;
interface ProcessedVideoImageInput {
	bytesBase64Encoded: string;
	mimeType: string;
}

const OBSIDIAN_SORA_ASYNC_API_KEY_ENV = "LLM_OBSIDIAN_SORA_ASYNC_API_KEY";
const OBSIDIAN_SORA_ASYNC_BASE_URL_ENV = "LLM_OBSIDIAN_SORA_ASYNC_BASE_URL";

function getOptionalMultiValueEnv(
	envVarName: string,
	configIndex: number | null,
): string | undefined {
	const envValue = process.env[envVarName];
	if (!envValue) {
		return undefined;
	}

	if (configIndex === null) {
		return envValue;
	}

	const values = envValue
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);

	if (values.length === 0) {
		return undefined;
	}

	if (configIndex >= values.length) {
		return values[values.length - 1];
	}

	return values[configIndex];
}

function applyObsidianSoraAsyncProviderContextOverride<
	T extends { providerId: Provider; baseUrl: string; token: string },
>(providerContext: T, baseModelName: string, configIndex: number | null): T {
	if (
		providerContext.providerId !== "obsidian" ||
		!isSoraVideoModelName(baseModelName)
	) {
		return providerContext;
	}

	const overrideToken = getOptionalMultiValueEnv(
		OBSIDIAN_SORA_ASYNC_API_KEY_ENV,
		configIndex,
	);
	const overrideBaseUrl = getOptionalMultiValueEnv(
		OBSIDIAN_SORA_ASYNC_BASE_URL_ENV,
		configIndex,
	);

	if (!overrideToken && !overrideBaseUrl) {
		return providerContext;
	}

	return {
		...providerContext,
		token: overrideToken ?? providerContext.token,
		baseUrl: overrideBaseUrl ?? providerContext.baseUrl,
	} as T;
}
type VideoInputMode = "none" | "frames" | "reference";

function getVideoImageFileExtension(mimeType: string): string {
	switch (mimeType) {
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		case "image/png":
		default:
			return "png";
	}
}

function getObsidianInputReferenceImages(
	inputMode: VideoInputMode,
	processedFirstFrame: ProcessedVideoImageInput | null,
	processedLastFrame: ProcessedVideoImageInput | null,
	processedReferenceImages: ProcessedVideoImageInput[],
): ProcessedVideoImageInput[] {
	if (inputMode === "reference") {
		return processedReferenceImages;
	}

	if (inputMode === "frames") {
		return [processedFirstFrame, processedLastFrame].filter(
			(image): image is ProcessedVideoImageInput => image !== null,
		);
	}

	return [];
}

function getAvailableCredits(
	organization: InferSelectModel<typeof tables.organization>,
): number {
	const regularCredits = parseFloat(organization.credits ?? "0");
	const devPlanCreditsRemaining =
		organization.devPlan !== "none"
			? parseFloat(organization.devPlanCreditsLimit ?? "0") -
				parseFloat(organization.devPlanCreditsUsed ?? "0")
			: 0;
	return regularCredits + devPlanCreditsRemaining;
}

function hasSufficientVideoGenerationBalance(
	organization: InferSelectModel<typeof tables.organization>,
): boolean {
	return getAvailableCredits(organization) >= MIN_VIDEO_GENERATION_BALANCE;
}

function getInsufficientVideoGenerationBalanceError(): HTTPException {
	return new HTTPException(402, {
		message:
			"Video generation requires at least $1.00 in available credits. Please add credits and try again.",
	});
}

function isNoFallbackEnabled(c: Context): boolean {
	return (
		c.req.raw.headers.get("x-no-fallback") === "true" ||
		c.req.raw.headers.get("x-no-fallback") === "1"
	);
}

function extractToken(c: Context): string {
	const auth = c.req.header("Authorization");
	const xApiKey = c.req.header("x-api-key");

	if (auth) {
		const split = auth.split("Bearer ");
		if (split.length === 2 && split[1]) {
			return split[1];
		}
	}

	if (xApiKey) {
		return xApiKey;
	}

	throw new HTTPException(401, {
		message:
			"Unauthorized: No API key provided. Expected 'Authorization: Bearer your-api-token' header or 'x-api-key: your-api-token' header",
	});
}

async function requireRequestContext(c: Context): Promise<RequestContext> {
	const token = extractToken(c);
	const apiKey = await findApiKeyByToken(token);

	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. Please make sure the token is not deleted or disabled. Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	if (apiKey.usageLimit && Number(apiKey.usage) >= Number(apiKey.usageLimit)) {
		throw new HTTPException(401, {
			message: "Unauthorized: LLMGateway API key reached its usage limit.",
		});
	}

	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		throw new HTTPException(500, {
			message: "Could not find project",
		});
	}

	if (project.status === "deleted") {
		throw new HTTPException(410, {
			message: "Project has been archived and is no longer accessible",
		});
	}

	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		throw new HTTPException(500, {
			message: "Could not find organization",
		});
	}

	return {
		apiKey,
		project,
		organization,
		requestId: c.req.header("x-request-id") ?? shortid(40),
	};
}

function getVideoModel(model: string): {
	normalizedModel: string;
	requestedProvider: string | undefined;
} {
	const supportedVideoModels = models.filter((modelInfo) =>
		modelInfo.providers.some(
			(provider) => (provider as ProviderModelMapping).videoGenerations,
		),
	);
	const exactMatch = supportedVideoModels.find(
		(modelInfo) => modelInfo.id === model,
	);
	if (exactMatch) {
		return {
			normalizedModel: model,
			requestedProvider: undefined,
		};
	}

	for (const modelInfo of supportedVideoModels) {
		for (const provider of modelInfo.providers as readonly ProviderModelMapping[]) {
			if (!provider.videoGenerations) {
				continue;
			}

			const prefixedModel = `${provider.providerId}/${modelInfo.id}`;
			if (model === prefixedModel) {
				return {
					normalizedModel: modelInfo.id,
					requestedProvider: provider.providerId,
				};
			}
		}
	}

	throw new HTTPException(400, {
		message:
			"Unsupported video model. Use a video-capable model from /v1/models, optionally prefixed with a configured provider like openai/, avalanche/, obsidian/, or google-vertex/.",
	});
}

function getVideoSizeConfig(size: string | undefined): VideoSizeConfig {
	const normalizedSize = size ?? DEFAULT_VIDEO_SIZE;
	return SUPPORTED_VIDEO_SIZES[normalizedSize as SupportedVideoSize];
}

function isSoraVideoModelName(modelName: string): boolean {
	return modelName === "sora-2" || modelName === "sora-2-pro";
}

function getVideoProviderConstraintReasons(
	provider: ProviderModelMapping,
	videoSize: VideoSizeConfig,
	videoDurationSeconds: number,
	inputMode: VideoInputMode,
	inputImageCount: number,
	includeAudio: boolean,
): string[] {
	const reasons: string[] = [];

	if (includeAudio) {
		if (provider.supportsVideoAudio === false) {
			reasons.push("audio output is unsupported for this provider mapping");
		}
	} else if (provider.supportsVideoWithoutAudio !== true) {
		reasons.push(
			"audio=false is unsupported because this provider mapping only supports audio-enabled output",
		);
	}

	if (
		provider.supportedVideoSizes?.length &&
		!provider.supportedVideoSizes.includes(videoSize.size)
	) {
		if (
			provider.providerId === "avalanche" &&
			!isSoraVideoModelName(provider.modelName)
		) {
			reasons.push(
				`size ${videoSize.size} is unsupported because Avalanche uses aspect_ratio and this integration only supports ${provider.supportedVideoSizes.join(", ")}`,
			);
		} else {
			reasons.push(
				`size ${videoSize.size} is unsupported (supported sizes: ${provider.supportedVideoSizes.join(", ")})`,
			);
		}
	}

	if (
		provider.supportedVideoDurationsSeconds?.length &&
		!provider.supportedVideoDurationsSeconds.includes(videoDurationSeconds)
	) {
		const supportedDurations = provider.supportedVideoDurationsSeconds
			.map((duration) => `${duration}s`)
			.join(", ");
		if (
			provider.providerId === "avalanche" &&
			provider.supportedVideoDurationsSeconds.length === 1 &&
			provider.supportedVideoDurationsSeconds[0] === 8
		) {
			reasons.push(
				`duration ${videoDurationSeconds}s is unsupported because Avalanche Veo 3.1 generates fixed 8s clips`,
			);
		} else {
			reasons.push(
				`duration ${videoDurationSeconds}s is unsupported (supported durations: ${supportedDurations})`,
			);
		}
	}

	if (isSoraVideoModelName(provider.modelName) && inputMode === "frames") {
		reasons.push(
			"Sora models do not support image/last_frame inputs. Use input_reference or reference_images with exactly one image.",
		);
	}

	if (
		!isSoraVideoModelName(provider.modelName) &&
		inputMode === "frames" &&
		provider.providerId !== "google-vertex" &&
		provider.providerId !== "avalanche" &&
		provider.providerId !== "obsidian"
	) {
		reasons.push(
			"frame inputs are currently only supported through obsidian, google-vertex, or avalanche",
		);
	}

	if (inputMode === "reference") {
		if (isSoraVideoModelName(provider.modelName)) {
			if (inputImageCount !== 1) {
				reasons.push(
					"Sora reference-image video generation supports exactly 1 input image",
				);
			}

			return reasons;
		}

		if (provider.providerId === "google-vertex") {
			if (provider.modelName !== "veo-3.1-generate-preview") {
				reasons.push(
					"reference images are currently only supported on google-vertex/veo-3.1-generate-preview",
				);
			}
		} else if (provider.providerId === "avalanche") {
			if (provider.modelName !== "veo3_fast") {
				reasons.push(
					"reference images are currently only supported on avalanche/veo-3.1-fast-generate-preview",
				);
			}
		} else if (provider.providerId === "obsidian") {
			if (inputImageCount >= 2) {
				reasons.push(
					"obsidian reference-image video generation supports exactly 1 input image",
				);
			}
		} else {
			reasons.push(
				"reference images are currently only supported through obsidian, google-vertex, or avalanche",
			);
		}

		if (videoDurationSeconds !== 8) {
			reasons.push(
				"reference images are currently only supported for 8 second outputs",
			);
		}
	}

	return reasons;
}

function formatVideoProviderConstraintSummary(
	modelId: string,
	providers: ProviderModelMapping[],
	videoSize: VideoSizeConfig,
	videoDurationSeconds: number,
	inputMode: VideoInputMode,
	inputImageCount: number,
	includeAudio: boolean,
): string {
	const providerSummaries = providers.map((provider) => {
		const reasons = getVideoProviderConstraintReasons(
			provider,
			videoSize,
			videoDurationSeconds,
			inputMode,
			inputImageCount,
			includeAudio,
		);
		return `${provider.providerId}: ${reasons.join("; ")}`;
	});

	if (providers.length === 1) {
		const provider = providers[0];
		return `Requested parameters are not supported for ${provider.providerId}/${modelId}. ${providerSummaries[0]}.`;
	}

	return `Requested parameters are not supported for model ${modelId}. ${providerSummaries.join(". ")}.`;
}

function getEligibleVideoProviderMappings(
	modelInfo: ModelDefinition,
	requestedProvider: string | undefined,
	videoSize: VideoSizeConfig,
	videoDurationSeconds: number,
	inputMode: VideoInputMode,
	inputImageCount: number,
	includeAudio: boolean,
): ProviderModelMapping[] {
	const candidateProviders = modelInfo.providers.filter((provider) => {
		if (!provider.videoGenerations) {
			return false;
		}

		if (requestedProvider && provider.providerId !== requestedProvider) {
			return false;
		}

		return true;
	});

	const matchingProviders = candidateProviders.filter((provider) => {
		return (
			getVideoProviderConstraintReasons(
				provider,
				videoSize,
				videoDurationSeconds,
				inputMode,
				inputImageCount,
				includeAudio,
			).length === 0
		);
	});

	if (matchingProviders.length === 0) {
		throw new HTTPException(400, {
			message: formatVideoProviderConstraintSummary(
				modelInfo.id,
				candidateProviders,
				videoSize,
				videoDurationSeconds,
				inputMode,
				inputImageCount,
				includeAudio,
			),
		});
	}

	return matchingProviders;
}

function getObsidianVideoModelName(
	baseModelName: string,
	videoSize: VideoSizeConfig,
	inputMode: VideoInputMode,
): string {
	if (isSoraVideoModelName(baseModelName)) {
		return baseModelName;
	}

	const isFastModel = baseModelName.endsWith("-fast");
	const baseName = isFastModel
		? baseModelName.slice(0, -"-fast".length)
		: baseModelName;
	const orientationModelName =
		videoSize.orientation === "landscape"
			? `${baseName}-landscape${isFastModel ? "-fast" : ""}`
			: baseModelName;

	return inputMode === "none"
		? orientationModelName
		: `${orientationModelName}-fl`;
}

function getAvalancheVideoModelName(baseModelName: string): string {
	return baseModelName;
}

function getAvalancheSoraTaskModelName(
	baseModelName: string,
	inputMode: VideoInputMode,
): string {
	return `${baseModelName}-${inputMode === "reference" ? "image" : "text"}-to-video`;
}

function getVideoUpstreamModelName(
	providerId: Provider,
	baseModelName: string,
	videoSize: VideoSizeConfig,
	inputMode: VideoInputMode,
): string {
	switch (providerId) {
		case "obsidian":
			return getObsidianVideoModelName(baseModelName, videoSize, inputMode);
		case "avalanche":
			return getAvalancheVideoModelName(baseModelName);
		case "google-vertex":
			return baseModelName;
		default:
			return baseModelName;
	}
}

function getAvalancheAspectRatio(videoSize: VideoSizeConfig): "16:9" | "9:16" {
	return videoSize.orientation === "portrait" ? "9:16" : "16:9";
}

function getAvalancheSoraAspectRatio(
	videoSize: VideoSizeConfig,
): "landscape" | "portrait" {
	return videoSize.orientation === "portrait" ? "portrait" : "landscape";
}

function getAvalancheSoraSizeTier(
	baseModelName: string,
	videoSize: VideoSizeConfig,
): "standard" | "high" | null {
	if (baseModelName !== "sora-2-pro") {
		return null;
	}

	return videoSize.resolution === "hd" ? "high" : "standard";
}

function getVertexAspectRatio(videoSize: VideoSizeConfig): "16:9" | "9:16" {
	return videoSize.orientation === "portrait" ? "9:16" : "16:9";
}

function getVertexResolution(
	videoSize: VideoSizeConfig,
): "720p" | "1080p" | "4k" {
	switch (videoSize.resolution) {
		case "1080p":
			return "1080p";
		case "4k":
			return "4k";
		default:
			return "720p";
	}
}

function getDefaultVideoProviderBaseUrl(providerId: Provider): string | null {
	switch (providerId) {
		case "openai":
			return "https://api.openai.com";
		case "google-vertex":
			return "https://us-central1-aiplatform.googleapis.com";
		default:
			return null;
	}
}

function addRequestedVideoMetadata(
	body: Record<string, unknown>,
	videoSize: VideoSizeConfig,
): Record<string, unknown> {
	return {
		...body,
		size:
			typeof body.size === "string" && body.size.length > 0
				? body.size
				: videoSize.size,
		resolution:
			typeof body.resolution === "string" && body.resolution.length > 0
				? body.resolution
				: videoSize.resolution,
		width:
			typeof body.width === "number" && Number.isFinite(body.width)
				? body.width
				: videoSize.width,
		height:
			typeof body.height === "number" && Number.isFinite(body.height)
				? body.height
				: videoSize.height,
	};
}

async function resolveProviderContext(
	providerId: Provider,
	project: InferSelectModel<typeof tables.project>,
	organizationId: string,
	baseModelName?: string,
): Promise<ProviderContext> {
	const defaultBaseUrl = getDefaultVideoProviderBaseUrl(providerId);
	const sharedVertexProjectId =
		providerId === "google-vertex"
			? getProviderEnvValue("google-vertex", "project")
			: undefined;
	const sharedVertexRegion =
		providerId === "google-vertex"
			? (getProviderEnvValue(
					"google-vertex",
					"region",
					undefined,
					"us-central1",
				) ?? "us-central1")
			: undefined;

	if (project.mode === "api-keys") {
		const providerKey = await findProviderKey(organizationId, providerId);
		if (!providerKey) {
			throw new HTTPException(400, {
				message: `No API key set for provider: ${providerId}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
			});
		}

		const baseUrl =
			providerKey.baseUrl ??
			getProviderEnvValue(providerId, "baseUrl") ??
			defaultBaseUrl;
		if (!baseUrl) {
			throw new HTTPException(400, {
				message: `No base URL set for provider: ${providerId}`,
			});
		}

		if (providerId === "google-vertex" && !sharedVertexProjectId) {
			throw new HTTPException(500, {
				message:
					"LLM_GOOGLE_CLOUD_PROJECT environment variable is required for google-vertex video generation",
			});
		}

		const providerContext: ProviderContext = {
			providerId,
			baseUrl,
			token: providerKey.token,
			usedMode: "api-keys",
			configIndex: null,
			vertexProjectId: sharedVertexProjectId,
			vertexRegion: sharedVertexRegion,
			uploadBaseUrl:
				providerId === "avalanche"
					? getProviderEnvValue(providerId, "fileUploadBaseUrl")
					: undefined,
		};

		return applyObsidianSoraAsyncProviderContextOverride(
			providerContext,
			baseModelName ?? "",
			null,
		);
	}

	if (project.mode === "credits") {
		const env = getProviderEnv(providerId);
		const baseUrl =
			getProviderEnvValue(providerId, "baseUrl", env.configIndex) ??
			defaultBaseUrl;
		if (!baseUrl) {
			throw new HTTPException(500, {
				message: `Base URL environment variable is required for ${providerId} provider`,
			});
		}

		const vertexProjectId =
			providerId === "google-vertex"
				? getProviderEnvValue("google-vertex", "project", env.configIndex)
				: undefined;
		const vertexRegion =
			providerId === "google-vertex"
				? (getProviderEnvValue(
						"google-vertex",
						"region",
						env.configIndex,
						"us-central1",
					) ?? "us-central1")
				: undefined;

		if (providerId === "google-vertex" && !vertexProjectId) {
			throw new HTTPException(500, {
				message:
					"LLM_GOOGLE_CLOUD_PROJECT environment variable is required for google-vertex video generation",
			});
		}

		const providerContext: ProviderContext = {
			providerId,
			baseUrl,
			token: env.token,
			usedMode: "credits",
			configIndex: env.configIndex,
			vertexProjectId,
			vertexRegion,
			uploadBaseUrl:
				providerId === "avalanche"
					? getProviderEnvValue(
							providerId,
							"fileUploadBaseUrl",
							env.configIndex,
						)
					: undefined,
		};

		return applyObsidianSoraAsyncProviderContextOverride(
			providerContext,
			baseModelName ?? "",
			env.configIndex,
		);
	}

	const providerKey = await findProviderKey(organizationId, providerId);
	if (providerKey) {
		const baseUrl =
			providerKey.baseUrl ??
			getProviderEnvValue(providerId, "baseUrl") ??
			defaultBaseUrl;
		if (!baseUrl) {
			throw new HTTPException(400, {
				message: `No base URL set for provider: ${providerId}`,
			});
		}

		if (providerId === "google-vertex" && !sharedVertexProjectId) {
			throw new HTTPException(500, {
				message:
					"LLM_GOOGLE_CLOUD_PROJECT environment variable is required for google-vertex video generation",
			});
		}

		const providerContext: ProviderContext = {
			providerId,
			baseUrl,
			token: providerKey.token,
			usedMode: "api-keys",
			configIndex: null,
			vertexProjectId: sharedVertexProjectId,
			vertexRegion: sharedVertexRegion,
			uploadBaseUrl:
				providerId === "avalanche"
					? getProviderEnvValue(providerId, "fileUploadBaseUrl")
					: undefined,
		};

		return applyObsidianSoraAsyncProviderContextOverride(
			providerContext,
			baseModelName ?? "",
			null,
		);
	}

	if (!hasProviderEnvironmentToken(providerId)) {
		throw new HTTPException(400, {
			message: `No provider key or environment token set for provider: ${providerId}. Please add the provider key in the settings or switch the project mode to credits or hybrid.`,
		});
	}

	const env = getProviderEnv(providerId);
	const baseUrl =
		getProviderEnvValue(providerId, "baseUrl", env.configIndex) ??
		defaultBaseUrl;
	if (!baseUrl) {
		throw new HTTPException(500, {
			message: `Base URL environment variable is required for ${providerId} provider`,
		});
	}

	const vertexProjectId =
		providerId === "google-vertex"
			? getProviderEnvValue("google-vertex", "project", env.configIndex)
			: undefined;
	const vertexRegion =
		providerId === "google-vertex"
			? (getProviderEnvValue(
					"google-vertex",
					"region",
					env.configIndex,
					"us-central1",
				) ?? "us-central1")
			: undefined;

	if (providerId === "google-vertex" && !vertexProjectId) {
		throw new HTTPException(500, {
			message:
				"LLM_GOOGLE_CLOUD_PROJECT environment variable is required for google-vertex video generation",
		});
	}

	const providerContext: ProviderContext = {
		providerId,
		baseUrl,
		token: env.token,
		usedMode: "credits",
		configIndex: env.configIndex,
		vertexProjectId,
		vertexRegion,
		uploadBaseUrl:
			providerId === "avalanche"
				? getProviderEnvValue(providerId, "fileUploadBaseUrl", env.configIndex)
				: undefined,
	};

	return applyObsidianSoraAsyncProviderContextOverride(
		providerContext,
		baseModelName ?? "",
		env.configIndex,
	);
}

async function hasVideoProviderConfiguration(
	providerId: Provider,
	project: InferSelectModel<typeof tables.project>,
	organizationId: string,
): Promise<boolean> {
	const defaultBaseUrl = getDefaultVideoProviderBaseUrl(providerId);

	if (project.mode === "api-keys") {
		const providerKey = await findProviderKey(organizationId, providerId);
		return Boolean(
			providerKey &&
				(providerKey.baseUrl ??
					getProviderEnvValue(providerId, "baseUrl") ??
					defaultBaseUrl) &&
				(providerId !== "google-vertex" ||
					Boolean(getProviderEnvValue("google-vertex", "project"))),
		);
	}

	if (project.mode === "credits") {
		return Boolean(
			hasProviderEnvironmentToken(providerId) &&
				(getProviderEnvValue(
					providerId,
					"baseUrl",
					getProviderEnv(providerId).configIndex,
				) ??
					defaultBaseUrl) &&
				(providerId !== "google-vertex" ||
					Boolean(
						getProviderEnvValue(
							"google-vertex",
							"project",
							getProviderEnv(providerId).configIndex,
						),
					)),
		);
	}

	const providerKey = await findProviderKey(organizationId, providerId);
	if (providerKey) {
		return Boolean(
			(providerKey.baseUrl ??
				getProviderEnvValue(providerId, "baseUrl") ??
				defaultBaseUrl) &&
				(providerId !== "google-vertex" ||
					Boolean(getProviderEnvValue("google-vertex", "project"))),
		);
	}

	return Boolean(
		hasProviderEnvironmentToken(providerId) &&
			(getProviderEnvValue(
				providerId,
				"baseUrl",
				getProviderEnv(providerId).configIndex,
			) ??
				defaultBaseUrl) &&
			(providerId !== "google-vertex" ||
				Boolean(
					getProviderEnvValue(
						"google-vertex",
						"project",
						getProviderEnv(providerId).configIndex,
					),
				)),
	);
}

async function resolveVideoExecution(
	modelInfo: ModelDefinition,
	requestedProvider: string | undefined,
	videoSize: VideoSizeConfig,
	videoDurationSeconds: number,
	inputMode: VideoInputMode,
	inputImageCount: number,
	includeAudio: boolean,
	project: InferSelectModel<typeof tables.project>,
	organizationId: string,
	noFallback: boolean,
): Promise<ResolvedVideoExecution> {
	const videoPricing: VideoPricingContext = {
		durationSeconds: videoDurationSeconds,
		includeAudio,
		resolution:
			videoSize.resolution === "4k"
				? "4k"
				: videoSize.resolution === "hd"
					? "hd"
					: "default",
	};
	const eligibleMappings = getEligibleVideoProviderMappings(
		modelInfo,
		requestedProvider,
		videoSize,
		videoDurationSeconds,
		inputMode,
		inputImageCount,
		includeAudio,
	);
	const configuredEligibleMappings: ProviderModelMapping[] = [];
	for (const providerMapping of eligibleMappings) {
		if (
			await hasVideoProviderConfiguration(
				providerMapping.providerId as Provider,
				project,
				organizationId,
			)
		) {
			configuredEligibleMappings.push(providerMapping);
		}
	}

	if (!requestedProvider) {
		const configuredProviders: Provider[] = [];
		for (const providerMapping of modelInfo.providers) {
			const providerId = providerMapping.providerId as Provider;
			if (
				providerMapping.videoGenerations &&
				(await hasVideoProviderConfiguration(
					providerId,
					project,
					organizationId,
				))
			) {
				configuredProviders.push(providerId);
			}
		}

		if (configuredProviders.length > 0) {
			const configuredProviderMappings = modelInfo.providers.filter(
				(provider) =>
					provider.videoGenerations &&
					configuredProviders.includes(provider.providerId as Provider),
			);
			const configuredEligibleMappings = eligibleMappings.filter((provider) =>
				configuredProviders.includes(provider.providerId as Provider),
			);
			if (configuredEligibleMappings.length === 0) {
				throw new HTTPException(400, {
					message: formatVideoProviderConstraintSummary(
						modelInfo.id,
						configuredProviderMappings,
						videoSize,
						videoDurationSeconds,
						inputMode,
						inputImageCount,
						includeAudio,
					),
				});
			}
		}
	}

	if (configuredEligibleMappings.length === 0) {
		throw new HTTPException(400, {
			message: `No configured provider is available for model ${modelInfo.id} and size ${videoSize.size}.`,
		});
	}

	let routingMetadata: RoutingMetadata | undefined;
	let orderedMappings = configuredEligibleMappings;

	if (configuredEligibleMappings.length > 1) {
		const metricsCombinations = configuredEligibleMappings.map((provider) => ({
			modelId: modelInfo.id,
			providerId: provider.providerId,
		}));
		const metricsMap =
			await getProviderMetricsForCombinations(metricsCombinations);

		if (
			requestedProvider &&
			!noFallback &&
			metricsMap.has(`${modelInfo.id}:${requestedProvider}`)
		) {
			const requestedMetrics = metricsMap.get(
				`${modelInfo.id}:${requestedProvider}`,
			);
			const requestedUptime = requestedMetrics?.uptime;

			if (requestedUptime !== undefined && requestedUptime < 90) {
				const betterMappings = configuredEligibleMappings.filter((provider) => {
					if (provider.providerId === requestedProvider) {
						return false;
					}

					const providerMetrics = metricsMap.get(
						`${modelInfo.id}:${provider.providerId}`,
					);
					return (
						!providerMetrics ||
						(providerMetrics.uptime ?? 100) > requestedUptime
					);
				});

				if (betterMappings.length > 0) {
					const betterResult = getCheapestFromAvailableProviders(
						betterMappings,
						modelInfo,
						{ metricsMap, isStreaming: false, videoPricing },
					);

					if (betterResult) {
						const originalMapping = configuredEligibleMappings.find(
							(provider) => provider.providerId === requestedProvider,
						);
						const originalPrice = originalMapping
							? getProviderSelectionPrice(originalMapping, videoPricing)
							: 0;
						routingMetadata = {
							...betterResult.metadata,
							selectionReason: "low-uptime-fallback",
							originalProvider: requestedProvider,
							originalProviderUptime: requestedUptime,
							providerScores: [
								{
									providerId: requestedProvider,
									score: -1,
									price: originalPrice,
									uptime: requestedUptime,
									latency: requestedMetrics?.averageLatency,
									throughput: requestedMetrics?.throughput,
								},
								...betterResult.metadata.providerScores,
							],
							...(noFallback ? { noFallback: true } : {}),
						};

						const orderedProviderIds = [
							betterResult.provider.providerId,
							requestedProvider,
							...betterResult.metadata.providerScores
								.filter(
									(score) =>
										score.providerId !== betterResult.provider.providerId,
								)
								.map((score) => score.providerId),
						];
						orderedMappings = orderedProviderIds
							.map((providerId) =>
								configuredEligibleMappings.find(
									(provider) => provider.providerId === providerId,
								),
							)
							.filter((provider): provider is ProviderModelMapping =>
								Boolean(provider),
							);
					}
				}
			}
		}

		if (!routingMetadata) {
			const cheapestResult = getCheapestFromAvailableProviders(
				configuredEligibleMappings,
				modelInfo,
				{ metricsMap, isStreaming: false, videoPricing },
			);
			if (cheapestResult) {
				routingMetadata = {
					...cheapestResult.metadata,
					...(noFallback ? { noFallback: true } : {}),
				};
				const orderedProviderIds = [
					cheapestResult.provider.providerId,
					...cheapestResult.metadata.providerScores
						.filter(
							(score) =>
								score.providerId !== cheapestResult.provider.providerId,
						)
						.sort((a, b) => a.score - b.score)
						.map((score) => score.providerId),
				];
				orderedMappings = orderedProviderIds
					.map((providerId) =>
						configuredEligibleMappings.find(
							(provider) => provider.providerId === providerId,
						),
					)
					.filter((provider): provider is ProviderModelMapping =>
						Boolean(provider),
					);
			}
		}
	}

	routingMetadata ??= {
		availableProviders: configuredEligibleMappings.map(
			(provider) => provider.providerId,
		),
		selectedProvider: orderedMappings[0].providerId,
		selectionReason: requestedProvider
			? "direct-provider-specified"
			: configuredEligibleMappings.length === 1
				? "single-provider-available"
				: "fallback-first-available",
		providerScores: configuredEligibleMappings.map((provider) => ({
			providerId: provider.providerId,
			score: provider.providerId === orderedMappings[0].providerId ? 0 : 1,
			price: getProviderSelectionPrice(provider, videoPricing),
		})),
		...(noFallback ? { noFallback: true } : {}),
	};

	const providerMapping = orderedMappings[0];
	const providerContext = await resolveProviderContext(
		providerMapping.providerId as Provider,
		project,
		organizationId,
		providerMapping.modelName,
	);
	return {
		providerMapping,
		providerContext,
		upstreamModelName: getVideoUpstreamModelName(
			providerMapping.providerId as Provider,
			providerMapping.modelName,
			videoSize,
			inputMode,
		),
		routingMetadata,
		orderedMappings,
	};
}

function joinUrl(baseUrl: string, path: string): string {
	const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
	return new URL(normalizedPath, normalizedBaseUrl).toString();
}

function appendQueryParam(url: string, key: string, value: string): string {
	const resolvedUrl = new URL(url);
	resolvedUrl.searchParams.set(key, value);
	return resolvedUrl.toString();
}

function getVideoDurationSeconds(
	modelInfo: ModelDefinition,
	seconds: number,
): number {
	if (
		modelInfo.maxVideoDurationSeconds !== undefined &&
		seconds > modelInfo.maxVideoDurationSeconds
	) {
		throw new HTTPException(400, {
			message: `duration ${seconds}s exceeds the maximum supported duration of ${modelInfo.maxVideoDurationSeconds}s for model ${modelInfo.id}`,
		});
	}

	return seconds;
}

function normalizeVideoStatus(value: unknown): VideoJobRecord["status"] {
	if (typeof value !== "string") {
		return "queued";
	}

	switch (value.toLowerCase()) {
		case "queued":
		case "pending":
		case "submitted":
		case "waiting":
		case "queuing":
			return "queued";
		case "in_progress":
		case "in-progress":
		case "processing":
		case "running":
		case "generating":
			return "in_progress";
		case "completed":
		case "succeeded":
		case "success":
			return "completed";
		case "failed":
		case "error":
			return "failed";
		case "canceled":
		case "cancelled":
			return "canceled";
		case "expired":
			return "expired";
		default:
			return "queued";
	}
}

function parseTimestamp(value: unknown): Date | null {
	if (value instanceof Date) {
		return value;
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		return new Date(value > 1_000_000_000_000 ? value : value * 1000);
	}

	if (typeof value === "string" && value.length > 0) {
		const asNumber = Number(value);
		if (!Number.isNaN(asNumber)) {
			return new Date(
				asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000,
			);
		}

		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed;
		}
	}

	return null;
}

function extractProgress(body: Record<string, unknown>): number {
	const candidates = [
		body.progress,
		body.progress_percent,
		body.progressPercentage,
		body.data && typeof body.data === "object"
			? (body.data as Record<string, unknown>).progress
			: undefined,
	];

	for (const candidate of candidates) {
		if (typeof candidate === "number" && Number.isFinite(candidate)) {
			return Math.max(0, Math.min(100, Math.round(candidate)));
		}
		if (typeof candidate === "string" && candidate.length > 0) {
			const parsed = Number(candidate);
			if (!Number.isNaN(parsed)) {
				return Math.max(0, Math.min(100, Math.round(parsed)));
			}
		}
	}

	return 0;
}

function extractContentUrl(body: Record<string, unknown>): string | null {
	const candidates = [
		body.url,
		body.video_url,
		body.output_url,
		body.content,
		body.output,
	];

	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.startsWith("http")) {
			return candidate;
		}

		if (Array.isArray(candidate)) {
			for (const item of candidate) {
				if (
					item &&
					typeof item === "object" &&
					"url" in item &&
					typeof item.url === "string"
				) {
					return item.url;
				}
			}
		}

		if (candidate && typeof candidate === "object") {
			const obj = candidate as Record<string, unknown>;
			if (typeof obj.url === "string") {
				return obj.url;
			}
		}
	}

	return null;
}

function extractStorageUri(body: Record<string, unknown>): string | null {
	const candidates = [
		body.gcsUri,
		body.storage_uri,
		body.storageUri,
		body.output_gcs_uri,
	];

	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.startsWith("gs://")) {
			return candidate;
		}
	}

	const response =
		body.response && typeof body.response === "object"
			? (body.response as Record<string, unknown>)
			: null;
	const videos =
		response && Array.isArray(response.videos) ? response.videos : null;
	const firstVideo =
		videos && videos[0] && typeof videos[0] === "object"
			? (videos[0] as Record<string, unknown>)
			: null;

	return firstVideo && typeof firstVideo.gcsUri === "string"
		? firstVideo.gcsUri
		: null;
}

function extractError(body: Record<string, unknown>): VideoJobRecord["error"] {
	const candidate =
		body.error && typeof body.error === "object"
			? (body.error as Record<string, unknown>)
			: undefined;

	if (!candidate) {
		return null;
	}

	return {
		code: typeof candidate.code === "string" ? candidate.code : undefined,
		message:
			typeof candidate.message === "string"
				? candidate.message
				: "Video generation failed",
		details: candidate,
	};
}

function toUnixTimestamp(value: Date | null): number | null {
	return value ? Math.floor(value.getTime() / 1000) : null;
}

async function getExternalVideoContentUrl(
	job: VideoJobRecord,
): Promise<string | null> {
	if (job.storageUri) {
		try {
			return await createSignedGcsReadUrl(job.storageUri);
		} catch (error) {
			logger.error(
				"Failed to create signed URL for video job",
				error instanceof Error ? error : new Error(String(error)),
				{
					videoJobId: job.id,
					storageUri: job.storageUri,
				},
			);
		}
	}

	return job.contentUrl;
}

async function cacheVideoProxySourceUrl(
	logId: string,
	sourceUrl: string,
): Promise<void> {
	try {
		await redisClient.set(
			getVideoProxyRedisKey(logId),
			sourceUrl,
			"EX",
			VIDEO_PROXY_REDIS_TTL_SECONDS,
		);
	} catch (error) {
		logger.warn("Failed to cache video proxy source URL", {
			logId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function getInlineGoogleVertexVideoFromBodies(
	candidates: Array<unknown>,
): { bytesBase64Encoded: string; mimeType: string } | null {
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object") {
			continue;
		}

		const response =
			"response" in candidate &&
			candidate.response &&
			typeof candidate.response === "object"
				? (candidate.response as Record<string, unknown>)
				: null;
		const videos =
			response && "videos" in response && Array.isArray(response.videos)
				? response.videos
				: null;
		const firstVideo =
			videos && videos[0] && typeof videos[0] === "object"
				? (videos[0] as Record<string, unknown>)
				: null;

		if (
			firstVideo &&
			typeof firstVideo.bytesBase64Encoded === "string" &&
			firstVideo.bytesBase64Encoded.length > 0
		) {
			return {
				bytesBase64Encoded: firstVideo.bytesBase64Encoded,
				mimeType:
					typeof firstVideo.mimeType === "string" &&
					firstVideo.mimeType.length > 0
						? firstVideo.mimeType
						: "video/mp4",
			};
		}
	}

	return null;
}

async function getVideoLogIdByRequestId(
	requestId: string,
): Promise<string | null> {
	const existingLog = await db
		.select({
			id: tables.log.id,
		})
		.from(tables.log)
		.where(eq(tables.log.requestId, requestId))
		.limit(1)
		.then((rows) => rows[0]);

	return existingLog?.id ?? null;
}

async function getPublicVideoContentUrl(
	job: VideoJobRecord,
	logId?: string | null,
): Promise<string | null> {
	if (job.status !== "completed") {
		return null;
	}

	const resolvedLogId =
		logId ?? (await getVideoLogIdByRequestId(job.requestId));
	if (
		resolvedLogId &&
		(job.contentUrl ||
			job.storageUri ||
			getInlineGoogleVertexVideoFromBodies([
				job.upstreamStatusResponse,
				job.upstreamCreateResponse,
			]))
	) {
		try {
			return buildSignedGatewayVideoLogContentUrl(resolvedLogId);
		} catch (error) {
			logger.warn("Falling back to direct video content URL", {
				videoJobId: job.id,
				logId: resolvedLogId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return await getExternalVideoContentUrl(job);
}

async function serializeVideoJob(job: VideoJobRecord, logId?: string | null) {
	const contentUrl = await getPublicVideoContentUrl(job, logId);

	return {
		id: job.id,
		object: "video" as const,
		model: job.model,
		status: job.status,
		progress: TERMINAL_VIDEO_STATUSES.has(job.status)
			? job.status === "completed"
				? 100
				: job.progress
			: job.progress,
		created_at: Math.floor(job.createdAt.getTime() / 1000),
		completed_at: toUnixTimestamp(job.completedAt),
		expires_at: toUnixTimestamp(job.expiresAt),
		error: job.error ?? null,
		content: contentUrl
			? [
					{
						type: "video" as const,
						url: contentUrl,
						mime_type: job.contentType ?? null,
					},
				]
			: undefined,
	};
}

function getGoogleVertexInlineVideo(
	job: VideoJobRecord,
): { bytesBase64Encoded: string; mimeType: string } | null {
	return getInlineGoogleVertexVideoFromBodies([
		job.upstreamStatusResponse,
		job.upstreamCreateResponse,
	]);
}

async function requireVideoJobForProject(
	projectId: string,
	videoId: string,
): Promise<VideoJobRecord> {
	const job = await db
		.select()
		.from(tables.videoJob)
		.where(
			and(
				eq(tables.videoJob.id, videoId),
				eq(tables.videoJob.projectId, projectId),
			),
		)
		.limit(1)
		.then((rows) => rows[0]);

	if (!job) {
		throw new HTTPException(404, {
			message: "Video not found",
		});
	}

	return job;
}

async function requireVideoLogById(logId: string): Promise<LogRecord> {
	const log = await db
		.select()
		.from(tables.log)
		.where(eq(tables.log.id, logId))
		.limit(1)
		.then((rows) => rows[0]);

	if (!log) {
		throw new HTTPException(404, {
			message: "Video log not found",
		});
	}

	return log;
}

function getDirectVideoContentUrlFromLog(log: LogRecord): string | null {
	const upstreamResponse =
		log.upstreamResponse && typeof log.upstreamResponse === "object"
			? (log.upstreamResponse as Record<string, unknown>)
			: null;
	if (upstreamResponse) {
		const upstreamUrl = extractContentUrl(upstreamResponse);
		if (upstreamUrl) {
			return upstreamUrl;
		}
	}

	if (
		typeof log.content === "string" &&
		log.content.startsWith("http") &&
		!/\/v1\/videos\/logs\/[^/]+\/content(?:\?.*)?$/.test(log.content)
	) {
		return log.content;
	}

	return null;
}

async function getVideoSourceUrlFromCacheOrLog(
	log: LogRecord,
): Promise<string | null> {
	try {
		const cachedUrl = await redisClient.get(getVideoProxyRedisKey(log.id));
		if (cachedUrl) {
			return cachedUrl;
		}
	} catch (error) {
		logger.warn("Failed to read video proxy source URL from cache", {
			logId: log.id,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	const sourceUrl = getDirectVideoContentUrlFromLog(log);
	if (sourceUrl) {
		await cacheVideoProxySourceUrl(log.id, sourceUrl);
	}

	return sourceUrl;
}

async function streamVideoFromUrl(
	contentUrl: string,
	contentType?: string | null,
): Promise<Response> {
	const upstreamResponse = await fetch(contentUrl);
	if (!upstreamResponse.ok || !upstreamResponse.body) {
		throw new HTTPException(502, {
			message: "Failed to fetch video content from upstream provider",
		});
	}

	const headers = new Headers();
	headers.set(
		"Content-Type",
		upstreamResponse.headers.get("Content-Type") ?? contentType ?? "video/mp4",
	);

	const contentLength = upstreamResponse.headers.get("Content-Length");
	if (contentLength) {
		headers.set("Content-Length", contentLength);
	}

	return new Response(upstreamResponse.body, {
		status: 200,
		headers,
	});
}

function shouldProxyDirectUpstreamVideoContent(job: VideoJobRecord): boolean {
	return job.usedProvider === "openai";
}

async function resolveVideoJobProviderContext(job: VideoJobRecord): Promise<{
	providerId: Provider;
	baseUrl: string;
	token: string;
}> {
	const providerId = job.usedProvider as Provider;
	const defaultBaseUrl = getDefaultVideoProviderBaseUrl(providerId);

	if (job.usedMode === "api-keys") {
		const providerKey = await findProviderKey(job.organizationId, providerId);
		if (!providerKey) {
			throw new HTTPException(400, {
				message: `No API key set for provider: ${providerId}`,
			});
		}

		const baseUrl =
			providerKey.baseUrl ??
			getProviderEnvValue(providerId, "baseUrl") ??
			defaultBaseUrl;
		if (!baseUrl) {
			throw new HTTPException(400, {
				message: `No base URL set for provider: ${providerId}`,
			});
		}

		return applyObsidianSoraAsyncProviderContextOverride(
			{
				providerId,
				baseUrl,
				token: providerKey.token,
			},
			job.usedModel,
			null,
		);
	}

	const env = getProviderEnv(providerId);
	const baseUrl =
		getProviderEnvValue(providerId, "baseUrl", env.configIndex) ??
		defaultBaseUrl;
	if (!baseUrl) {
		throw new HTTPException(500, {
			message: `Base URL environment variable is required for ${providerId} provider`,
		});
	}

	return applyObsidianSoraAsyncProviderContextOverride(
		{
			providerId,
			baseUrl,
			token: env.token,
		},
		job.usedModel,
		env.configIndex,
	);
}

async function streamDirectUpstreamVideoContent(
	job: VideoJobRecord,
): Promise<Response> {
	const providerContext = await resolveVideoJobProviderContext(job);
	const contentUrl = joinUrl(
		providerContext.baseUrl,
		`/v1/videos/${job.upstreamId}/content`,
	);
	const upstreamResponse = await fetch(contentUrl, {
		headers: getProviderHeaders(
			providerContext.providerId,
			providerContext.token,
		),
	});
	if (!upstreamResponse.ok || !upstreamResponse.body) {
		throw new HTTPException(502, {
			message: "Failed to fetch video content from upstream provider",
		});
	}

	const headers = new Headers();
	headers.set(
		"Content-Type",
		upstreamResponse.headers.get("Content-Type") ??
			job.contentType ??
			"video/mp4",
	);
	const contentLength = upstreamResponse.headers.get("Content-Length");
	if (contentLength) {
		headers.set("Content-Length", contentLength);
	}

	return new Response(upstreamResponse.body, {
		status: 200,
		headers,
	});
}

async function markVideoDownloaded(logId: string): Promise<void> {
	await db
		.update(tables.log)
		.set({
			videoDownloadCount: sql`${tables.log.videoDownloadCount} + 1`,
			lastVideoDownloadedAt: new Date(),
		})
		.where(eq(tables.log.id, logId));
}

async function parseJsonBody(c: Context): Promise<ParsedVideoRequest> {
	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch {
		throw new HTTPException(400, {
			message: "Invalid JSON in request body",
		});
	}

	const validationResult = createVideoRequestSchema.safeParse(rawBody);
	if (!validationResult.success) {
		throw new HTTPException(400, {
			message: `Invalid request parameters: ${validationResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")}`,
		});
	}

	return {
		rawBody,
		request: validationResult.data,
	};
}

function isDebugMode(c: Context): boolean {
	return (
		c.req.header("x-debug") === "true" ||
		process.env.FORCE_DEBUG_MODE === "true" ||
		process.env.NODE_ENV !== "production"
	);
}

function getVideoUpstreamLogUrl(url: string): string {
	try {
		const parsedUrl = new URL(url);
		return `${parsedUrl.origin}${parsedUrl.pathname}`;
	} catch {
		return url;
	}
}

async function fetchUpstreamJson(
	url: string,
	init: RequestInit,
): Promise<Record<string, unknown>> {
	const startedAt = Date.now();
	const method = init.method ?? "GET";
	const response = await fetch(url, init);
	const text = await response.text();
	const durationMs = Date.now() - startedAt;
	const logPayload = {
		url: getVideoUpstreamLogUrl(url),
		method,
		status: response.status,
		durationMs,
	};
	if (durationMs >= 5_000) {
		logger.warn("Slow upstream video request", logPayload);
	} else {
		logger.info("Completed upstream video request", logPayload);
	}
	let body: Record<string, unknown> = {};

	if (text.length > 0) {
		try {
			body = JSON.parse(text) as Record<string, unknown>;
		} catch {
			body = {
				error: {
					message: text,
				},
			};
		}
	}

	const upstreamApplicationError =
		typeof body.msg === "string" &&
		body.msg.length > 0 &&
		typeof body.code === "number" &&
		body.code !== 200
			? {
					status:
						body.code >= 400 && body.code <= 599
							? (body.code as
									| 400
									| 401
									| 402
									| 403
									| 404
									| 409
									| 422
									| 429
									| 500
									| 502
									| 503
									| 504)
							: 502,
					message: body.msg,
				}
			: null;

	if (!response.ok) {
		logger.warn("Upstream video request failed", {
			url,
			status: response.status,
			body,
		});
		throw new HTTPException(
			response.status as
				| 400
				| 401
				| 403
				| 404
				| 409
				| 422
				| 429
				| 500
				| 502
				| 503
				| 504,
			{
				message:
					typeof body.error === "object" &&
					body.error &&
					"message" in body.error &&
					typeof body.error.message === "string"
						? body.error.message
						: `Upstream provider error (${response.status})`,
			},
		);
	}

	if (upstreamApplicationError) {
		logger.warn("Upstream video request returned an application error", {
			url,
			status: upstreamApplicationError.status,
			body,
		});
		throw new HTTPException(upstreamApplicationError.status, {
			message: upstreamApplicationError.message,
		});
	}

	return body;
}

function extractUpstreamVideoId(body: Record<string, unknown>): string | null {
	const data =
		body.data && typeof body.data === "object"
			? (body.data as Record<string, unknown>)
			: null;

	for (const value of [
		body.name,
		body.id,
		body.video_id,
		body.task_id,
		body.job_id,
		body.taskId,
		data?.taskId,
		data?.task_id,
		data?.id,
	]) {
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	return null;
}

function buildVideoInputReferenceFormData(
	model: string,
	prompt: string,
	size: string,
	seconds: number | undefined,
	inputReferenceImages: ProcessedVideoImageInput[],
): FormData {
	const formData = new FormData();
	formData.set("model", model);
	formData.set("prompt", prompt);
	formData.set("size", size);
	if (seconds !== undefined) {
		formData.set("seconds", String(seconds));
	}

	for (const [index, image] of inputReferenceImages.entries()) {
		const fileExtension = getVideoImageFileExtension(image.mimeType);
		const fileName = `input_reference_${index + 1}.${fileExtension}`;
		formData.append(
			"input_reference",
			new Blob([Buffer.from(image.bytesBase64Encoded, "base64")], {
				type: image.mimeType,
			}),
			fileName,
		);
	}

	return formData;
}

function getObsidianSora2ProConfigurationError(
	message: string,
): HTTPException | null {
	if (
		!message.includes("sora-2-pro") ||
		!message.includes("无可用渠道") ||
		!message.includes("default")
	) {
		return null;
	}

	return new HTTPException(503, {
		message:
			"Obsidian sora-2-pro is not available for the current token. Configure LLM_OBSIDIAN_SORA_ASYNC_API_KEY with an obsidian async-api token that has access to sora-2-pro, or update the Obsidian provider key used for video generation.",
	});
}

async function createObsidianVideoJob(
	providerContext: ProviderContext,
	providerMapping: ProviderModelMapping,
	videoSize: VideoSizeConfig,
	prompt: string,
	durationSeconds: number,
	inputMode: VideoInputMode,
	processedFirstFrame: ProcessedVideoImageInput | null,
	processedLastFrame: ProcessedVideoImageInput | null,
	processedReferenceImages: ProcessedVideoImageInput[],
): Promise<{
	upstreamId: string;
	upstreamRequest: Record<string, unknown>;
	upstreamResponse: Record<string, unknown>;
}> {
	const upstreamUrl = joinUrl(providerContext.baseUrl, "/v1/videos");
	const upstreamModelName = getVideoUpstreamModelName(
		"obsidian",
		providerMapping.modelName,
		videoSize,
		inputMode,
	);
	const includesDuration = isSoraVideoModelName(providerMapping.modelName);
	const inputReferenceImages = getObsidianInputReferenceImages(
		inputMode,
		processedFirstFrame,
		processedLastFrame,
		processedReferenceImages,
	);
	const upstreamRequest =
		inputReferenceImages.length > 0
			? {
					model: upstreamModelName,
					prompt,
					size: videoSize.size,
					...(includesDuration
						? {
								seconds: String(durationSeconds),
							}
						: {}),
					input_reference: inputReferenceImages.map((image, index) => ({
						filename: `input_reference_${index + 1}.${getVideoImageFileExtension(image.mimeType)}`,
						mimeType: image.mimeType,
					})),
				}
			: {
					model: upstreamModelName,
					prompt,
					size: videoSize.size,
					...(includesDuration
						? {
								seconds: String(durationSeconds),
							}
						: {}),
				};
	const upstreamBody =
		inputReferenceImages.length > 0
			? buildVideoInputReferenceFormData(
					upstreamModelName,
					prompt,
					videoSize.size,
					includesDuration ? durationSeconds : undefined,
					inputReferenceImages,
				)
			: JSON.stringify(upstreamRequest);
	let rawUpstreamResponse: Record<string, unknown>;
	try {
		rawUpstreamResponse = await fetchUpstreamJson(upstreamUrl, {
			method: "POST",
			headers: {
				...getProviderHeaders("obsidian", providerContext.token),
				...(inputReferenceImages.length === 0
					? { "Content-Type": "application/json" }
					: {}),
			},
			body: upstreamBody,
		});
	} catch (error) {
		const rewrittenError = getObsidianSora2ProConfigurationError(
			error instanceof Error ? error.message : "",
		);
		if (providerMapping.modelName === "sora-2-pro" && rewrittenError) {
			throw rewrittenError;
		}
		throw error;
	}

	const upstreamResponse = addRequestedVideoMetadata(
		rawUpstreamResponse,
		videoSize,
	);
	const upstreamId = extractUpstreamVideoId(upstreamResponse);
	if (!upstreamId) {
		throw new HTTPException(502, {
			message: "Upstream video response did not include an id",
		});
	}

	return { upstreamId, upstreamRequest, upstreamResponse };
}

async function createOpenAIVideoJob(
	providerContext: ProviderContext,
	providerMapping: ProviderModelMapping,
	videoSize: VideoSizeConfig,
	prompt: string,
	durationSeconds: number,
	referenceImages: ProcessedVideoImageInput[],
): Promise<{
	upstreamId: string;
	upstreamRequest: Record<string, unknown>;
	upstreamResponse: Record<string, unknown>;
}> {
	const upstreamUrl = joinUrl(providerContext.baseUrl, "/v1/videos");
	const upstreamModelName = getVideoUpstreamModelName(
		"openai",
		providerMapping.modelName,
		videoSize,
		referenceImages.length > 0 ? "reference" : "none",
	);
	const upstreamRequest =
		referenceImages.length > 0
			? {
					model: upstreamModelName,
					prompt,
					size: videoSize.size,
					seconds: String(durationSeconds),
					input_reference: referenceImages.map((image, index) => ({
						filename: `input_reference_${index + 1}.${getVideoImageFileExtension(image.mimeType)}`,
						mimeType: image.mimeType,
					})),
				}
			: {
					model: upstreamModelName,
					prompt,
					size: videoSize.size,
					seconds: String(durationSeconds),
				};
	const upstreamBody =
		referenceImages.length > 0
			? buildVideoInputReferenceFormData(
					upstreamModelName,
					prompt,
					videoSize.size,
					durationSeconds,
					referenceImages,
				)
			: JSON.stringify(upstreamRequest);
	const rawResponse = await fetchUpstreamJson(upstreamUrl, {
		method: "POST",
		headers: {
			...getProviderHeaders("openai", providerContext.token),
			...(referenceImages.length === 0
				? { "Content-Type": "application/json" }
				: {}),
		},
		body: upstreamBody,
	});
	const upstreamResponse = addRequestedVideoMetadata(
		{
			...rawResponse,
			model: upstreamModelName,
			seconds:
				typeof rawResponse.seconds === "string"
					? rawResponse.seconds
					: String(durationSeconds),
		},
		videoSize,
	);
	const upstreamId = extractUpstreamVideoId(upstreamResponse);
	if (!upstreamId) {
		throw new HTTPException(502, {
			message: "OpenAI video response did not include an id",
		});
	}

	return { upstreamId, upstreamRequest, upstreamResponse };
}

async function createAvalancheVeoVideoJob(
	providerContext: ProviderContext,
	providerMapping: ProviderModelMapping,
	videoSize: VideoSizeConfig,
	prompt: string,
	firstFrameInput: VideoImageInput | undefined,
	lastFrameInput: VideoImageInput | undefined,
	referenceImageInputs: VideoImageInput[],
): Promise<{
	upstreamId: string;
	upstreamRequest: Record<string, unknown>;
	upstreamResponse: Record<string, unknown>;
}> {
	const upstreamUrl = joinUrl(
		getAvalancheApiBaseUrl(providerContext.baseUrl),
		"/generate",
	);
	const upstreamModelName = getVideoUpstreamModelName(
		"avalanche",
		providerMapping.modelName,
		videoSize,
		referenceImageInputs.length > 0
			? "reference"
			: firstFrameInput || lastFrameInput
				? "frames"
				: "none",
	);
	const generationType =
		referenceImageInputs.length > 0
			? "REFERENCE_2_VIDEO"
			: firstFrameInput || lastFrameInput
				? "FIRST_AND_LAST_FRAMES_2_VIDEO"
				: "TEXT_2_VIDEO";
	const imageUrls =
		generationType === "REFERENCE_2_VIDEO"
			? await Promise.all(
					referenceImageInputs.map((imageInput) =>
						getAvalancheImageUrl(providerContext, imageInput),
					),
				)
			: generationType === "FIRST_AND_LAST_FRAMES_2_VIDEO"
				? (
						await Promise.all([
							firstFrameInput
								? getAvalancheImageUrl(providerContext, firstFrameInput)
								: Promise.resolve(null),
							lastFrameInput
								? getAvalancheImageUrl(providerContext, lastFrameInput)
								: Promise.resolve(null),
						])
					).filter((imageUrl): imageUrl is string => imageUrl !== null)
				: [];
	const upstreamRequest = {
		prompt,
		model: upstreamModelName,
		aspect_ratio: getAvalancheAspectRatio(videoSize),
		generationType,
		enableFallback: false,
		...(imageUrls.length > 0 ? { imageUrls } : {}),
	};
	const rawResponse = await fetchUpstreamJson(upstreamUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...getProviderHeaders("avalanche", providerContext.token),
		},
		body: JSON.stringify(upstreamRequest),
	});
	const upstreamResponse = addRequestedVideoMetadata(
		{
			...rawResponse,
			status: "queued",
			duration: 8,
			aspect_ratio: upstreamRequest.aspect_ratio,
			generationType,
		},
		videoSize,
	);
	const upstreamId = extractUpstreamVideoId(upstreamResponse);
	if (!upstreamId) {
		throw new HTTPException(502, {
			message: "Avalanche video response did not include a task id",
		});
	}

	return { upstreamId, upstreamRequest, upstreamResponse };
}

async function createAvalancheSoraVideoJob(
	providerContext: ProviderContext,
	providerMapping: ProviderModelMapping,
	videoSize: VideoSizeConfig,
	prompt: string,
	durationSeconds: number,
	inputMode: VideoInputMode,
	referenceImages: ProcessedVideoImageInput[],
): Promise<{
	upstreamId: string;
	upstreamRequest: Record<string, unknown>;
	upstreamResponse: Record<string, unknown>;
}> {
	const upstreamUrl = joinUrl(
		getAvalancheJobsApiBaseUrl(providerContext.baseUrl),
		"/createTask",
	);
	const upstreamModelName = getAvalancheSoraTaskModelName(
		providerMapping.modelName,
		inputMode,
	);
	const imageUrls =
		inputMode === "reference"
			? await Promise.all(
					referenceImages.map((image) =>
						uploadAvalancheBase64Image(providerContext, image),
					),
				)
			: [];
	const sizeTier = getAvalancheSoraSizeTier(
		providerMapping.modelName,
		videoSize,
	);
	const input = {
		prompt,
		aspect_ratio: getAvalancheSoraAspectRatio(videoSize),
		n_frames: String(durationSeconds),
		remove_watermark: true,
		upload_method: "s3",
		...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
		...(sizeTier ? { size: sizeTier } : {}),
	};
	const upstreamRequest = {
		model: upstreamModelName,
		input,
	};
	const rawResponse = await fetchUpstreamJson(upstreamUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...getProviderHeaders("avalanche", providerContext.token),
		},
		body: JSON.stringify(upstreamRequest),
	});
	const upstreamResponse = addRequestedVideoMetadata(
		{
			...rawResponse,
			model: providerMapping.modelName,
			status: "queued",
			aspect_ratio: input.aspect_ratio,
			seconds:
				typeof rawResponse.seconds === "string"
					? rawResponse.seconds
					: String(durationSeconds),
			avalanche_task_model: upstreamModelName,
			avalanche_task_input: input,
		},
		videoSize,
	);
	const upstreamId = extractUpstreamVideoId(upstreamResponse);
	if (!upstreamId) {
		throw new HTTPException(502, {
			message: "Avalanche Sora response did not include an id",
		});
	}

	return { upstreamId, upstreamRequest, upstreamResponse };
}

async function createGoogleVertexVideoJob(
	providerContext: ProviderContext,
	providerMapping: ProviderModelMapping,
	videoSize: VideoSizeConfig,
	prompt: string,
	durationSeconds: number,
	includeAudio: boolean,
	firstFrame: ProcessedVideoImageInput | null,
	lastFrameInput: ProcessedVideoImageInput | null,
	referenceImages: ProcessedVideoImageInput[],
	videoJobId: string,
	organizationId: string,
	projectId: string,
): Promise<{
	upstreamId: string;
	upstreamRequest: Record<string, unknown>;
	upstreamResponse: Record<string, unknown>;
}> {
	if (!providerContext.vertexProjectId || !providerContext.vertexRegion) {
		throw new HTTPException(500, {
			message:
				"Google Vertex video generation requires project and region metadata",
		});
	}

	const upstreamModelName = getVideoUpstreamModelName(
		"google-vertex",
		providerMapping.modelName,
		videoSize,
		referenceImages.length > 0
			? "reference"
			: firstFrame || lastFrameInput
				? "frames"
				: "none",
	);
	const outputBucket = getGoogleVertexVideoOutputBucket();
	const outputStorageUri = outputBucket
		? buildVertexVideoOutputStorageUri({
				bucket: outputBucket,
				prefix: getGoogleVertexVideoOutputPrefix(),
				organizationId,
				projectId,
				videoJobId,
			})
		: null;
	const upstreamUrl = joinUrl(
		providerContext.baseUrl,
		`/v1/projects/${providerContext.vertexProjectId}/locations/${providerContext.vertexRegion}/publishers/google/models/${upstreamModelName}:predictLongRunning`,
	);
	const authenticatedUpstreamUrl = appendQueryParam(
		upstreamUrl,
		"key",
		providerContext.token,
	);
	const upstreamRequest = {
		instances: [
			{
				prompt,
				...(firstFrame ? { image: firstFrame } : {}),
				...(lastFrameInput ? { lastFrame: lastFrameInput } : {}),
				...(referenceImages.length > 0
					? {
							referenceImages: referenceImages.map((image) => ({
								image,
								referenceType: "asset",
							})),
						}
					: {}),
			},
		],
		parameters: {
			aspectRatio: getVertexAspectRatio(videoSize),
			durationSeconds,
			generateAudio: includeAudio,
			resolution: getVertexResolution(videoSize),
			sampleCount: 1,
			...(outputStorageUri ? { storageUri: outputStorageUri } : {}),
		},
	};
	const rawResponse = await fetchUpstreamJson(authenticatedUpstreamUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(upstreamRequest),
	});
	const upstreamId =
		typeof rawResponse.name === "string" && rawResponse.name.length > 0
			? rawResponse.name
			: extractUpstreamVideoId(rawResponse);
	if (!upstreamId) {
		throw new HTTPException(502, {
			message: "Google Vertex video response did not include an operation name",
		});
	}

	return {
		upstreamId,
		upstreamRequest,
		upstreamResponse: addRequestedVideoMetadata(
			{
				...rawResponse,
				name: upstreamId,
				status: rawResponse.done === true ? "completed" : "queued",
				duration: durationSeconds,
				google_vertex_project_id: providerContext.vertexProjectId,
				google_vertex_region: providerContext.vertexRegion,
				google_vertex_model_name: upstreamModelName,
				google_vertex_generate_audio: includeAudio,
				...(outputStorageUri
					? {
							google_vertex_output_storage_uri: outputStorageUri,
						}
					: {}),
			},
			videoSize,
		),
	};
}

async function createUpstreamVideoJob(
	providerContext: ProviderContext,
	providerMapping: ProviderModelMapping,
	videoSize: VideoSizeConfig,
	prompt: string,
	durationSeconds: number,
	includeAudio: boolean,
	inputMode: VideoInputMode,
	firstFrameInput: VideoImageInput | undefined,
	lastFrameInput: VideoImageInput | undefined,
	referenceImageInputs: VideoImageInput[],
	processedFirstFrame: ProcessedVideoImageInput | null,
	processedLastFrame: ProcessedVideoImageInput | null,
	processedReferenceImages: ProcessedVideoImageInput[],
	videoJobId: string,
	organizationId: string,
	projectId: string,
): Promise<{
	upstreamId: string;
	upstreamRequest: Record<string, unknown>;
	upstreamResponse: Record<string, unknown>;
}> {
	switch (providerContext.providerId) {
		case "openai":
			return await createOpenAIVideoJob(
				providerContext,
				providerMapping,
				videoSize,
				prompt,
				durationSeconds,
				processedReferenceImages,
			);
		case "obsidian":
			return await createObsidianVideoJob(
				providerContext,
				providerMapping,
				videoSize,
				prompt,
				durationSeconds,
				inputMode,
				processedFirstFrame,
				processedLastFrame,
				processedReferenceImages,
			);
		case "avalanche":
			return isSoraVideoModelName(providerMapping.modelName)
				? await createAvalancheSoraVideoJob(
						providerContext,
						providerMapping,
						videoSize,
						prompt,
						durationSeconds,
						inputMode,
						processedReferenceImages,
					)
				: await createAvalancheVeoVideoJob(
						providerContext,
						providerMapping,
						videoSize,
						prompt,
						firstFrameInput,
						lastFrameInput,
						referenceImageInputs,
					);
		case "google-vertex":
			return await createGoogleVertexVideoJob(
				providerContext,
				providerMapping,
				videoSize,
				prompt,
				durationSeconds,
				includeAudio,
				processedFirstFrame,
				processedLastFrame,
				processedReferenceImages,
				videoJobId,
				organizationId,
				projectId,
			);
		default:
			throw new HTTPException(500, {
				message: `Unsupported video provider: ${providerContext.providerId}`,
			});
	}
}

export const videos = new OpenAPIHono<ServerTypes>();

function getVideoFirstFrameInput(
	request: z.infer<typeof createVideoRequestSchema>,
): VideoImageInput | undefined {
	return request.image;
}

function getVideoLastFrameInput(
	request: z.infer<typeof createVideoRequestSchema>,
): VideoImageInput | undefined {
	return request.last_frame;
}

function getVideoReferenceImageInputs(
	request: z.infer<typeof createVideoRequestSchema>,
): VideoImageInput[] {
	if (request.reference_images) {
		return request.reference_images;
	}

	if (!request.input_reference) {
		return [];
	}

	return Array.isArray(request.input_reference)
		? request.input_reference
		: [request.input_reference];
}

function getVideoInputMode(
	request: z.infer<typeof createVideoRequestSchema>,
): VideoInputMode {
	if (request.image !== undefined || request.last_frame !== undefined) {
		return "frames";
	}

	if (
		request.reference_images !== undefined ||
		request.input_reference !== undefined
	) {
		return "reference";
	}

	return "none";
}

function getVideoInputImageCount(
	inputMode: VideoInputMode,
	firstFrameInput: VideoImageInput | undefined,
	lastFrameInput: VideoImageInput | undefined,
	referenceImageInputs: VideoImageInput[],
): number {
	if (inputMode === "reference") {
		return referenceImageInputs.length;
	}

	if (inputMode === "frames") {
		return [firstFrameInput, lastFrameInput].filter(Boolean).length;
	}

	return 0;
}

function getVideoImageUrl(videoImage: VideoImageInput): string {
	return typeof videoImage === "string" ? videoImage : videoImage.image_url;
}

async function processVideoImageInput(
	videoImage: VideoImageInput | undefined,
): Promise<ProcessedVideoImageInput | null> {
	if (!videoImage) {
		return null;
	}

	const imageUrl = getVideoImageUrl(videoImage);
	if (!imageUrl) {
		throw new HTTPException(400, {
			message: "image must include a non-empty image URL",
		});
	}

	try {
		const { data, mimeType } = await processImageUrl(
			imageUrl,
			process.env.NODE_ENV === "production",
			20,
			null,
		);
		return {
			bytesBase64Encoded: data,
			mimeType,
		};
	} catch (error) {
		throw new HTTPException(400, {
			message:
				error instanceof Error
					? `Invalid image input: ${error.message}`
					: "Invalid image input",
		});
	}
}

async function processVideoImageInputs(
	videoImages: VideoImageInput[],
): Promise<ProcessedVideoImageInput[]> {
	return (
		await Promise.all(
			videoImages.map((videoImage) => processVideoImageInput(videoImage)),
		)
	).filter((image): image is ProcessedVideoImageInput => image !== null);
}

async function uploadAvalancheBase64Image(
	providerContext: ProviderContext,
	image: ProcessedVideoImageInput,
): Promise<string> {
	const uploadUrl = joinUrl(
		getAvalancheFileUploadBaseUrl(
			providerContext.baseUrl,
			providerContext.uploadBaseUrl,
		),
		"/api/file-base64-upload",
	);
	const response = await fetchUpstreamJson(uploadUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...getProviderHeaders("avalanche", providerContext.token),
		},
		body: JSON.stringify({
			base64Data: `data:${image.mimeType};base64,${image.bytesBase64Encoded}`,
			uploadPath: "videos/input-images",
		}),
	});
	const data =
		response.data && typeof response.data === "object"
			? (response.data as Record<string, unknown>)
			: null;
	const fileUrl =
		typeof data?.fileUrl === "string" && data.fileUrl.length > 0
			? data.fileUrl
			: null;
	const downloadUrl =
		typeof data?.downloadUrl === "string" && data.downloadUrl.length > 0
			? data.downloadUrl
			: null;
	const uploadedUrl = fileUrl ?? downloadUrl;

	if (!uploadedUrl) {
		throw new HTTPException(502, {
			message: "Avalanche file upload did not return a usable file URL",
		});
	}

	return uploadedUrl;
}

async function getAvalancheImageUrl(
	providerContext: ProviderContext,
	videoImage: VideoImageInput,
): Promise<string> {
	const processedImage = await processVideoImageInput(videoImage);
	if (!processedImage) {
		throw new HTTPException(400, {
			message: "image must include a non-empty image URL",
		});
	}

	return await uploadAvalancheBase64Image(providerContext, processedImage);
}

videos.openapi(createVideo, async (c) => {
	const requestStartedAt = Date.now();
	const { rawBody, request } = await parseJsonBody(c);
	const parsedBodyAt = Date.now();
	const { apiKey, project, organization, requestId } =
		await requireRequestContext(c);
	const requestContextResolvedAt = Date.now();
	const { normalizedModel, requestedProvider } = getVideoModel(request.model);
	const firstFrameInput = getVideoFirstFrameInput(request);
	const lastFrameInput = getVideoLastFrameInput(request);
	const referenceImageInputs = getVideoReferenceImageInputs(request);
	const inputMode = getVideoInputMode(request);
	const inputImageCount = getVideoInputImageCount(
		inputMode,
		firstFrameInput,
		lastFrameInput,
		referenceImageInputs,
	);
	const debugMode = isDebugMode(c);
	const noFallback = isNoFallbackEnabled(c);

	const modelInfo = models.find((model) => model.id === normalizedModel);
	if (!modelInfo) {
		throw new HTTPException(400, {
			message: `Model ${normalizedModel} not found`,
		});
	}
	const videoSize = getVideoSizeConfig(request.size);
	const videoDurationSeconds = getVideoDurationSeconds(
		modelInfo,
		request.seconds,
	);

	const iamValidation = await validateModelAccess(
		apiKey.id,
		normalizedModel,
		requestedProvider,
		modelInfo,
	);
	const iamValidatedAt = Date.now();

	if (!iamValidation.allowed) {
		throw new HTTPException(403, {
			message: iamValidation.reason ?? "Access to this model is not allowed",
		});
	}

	const {
		providerMapping,
		providerContext,
		upstreamModelName,
		routingMetadata,
		orderedMappings,
	} = await resolveVideoExecution(
		modelInfo,
		requestedProvider,
		videoSize,
		videoDurationSeconds,
		inputMode,
		inputImageCount,
		request.audio,
		project,
		organization.id,
		noFallback,
	);
	const videoExecutionResolvedAt = Date.now();

	const videoId = shortid();
	let selectedProviderMapping = providerMapping;
	let selectedProviderContext = providerContext;
	let selectedUpstreamModelName = upstreamModelName;
	let enrichedRoutingMetadata = routingMetadata;
	const processedFirstFrame = await processVideoImageInput(firstFrameInput);
	const processedLastFrameInput = await processVideoImageInput(lastFrameInput);
	const processedReferenceImages =
		await processVideoImageInputs(referenceImageInputs);
	const inputsProcessedAt = Date.now();
	const routingAttempts: RoutingAttempt[] = [];
	const failedProviders = new Set<string>();
	let retryCount = 0;

	let upstreamId: string | undefined;
	let upstreamRequest: Record<string, unknown> | undefined;
	let upstreamResponse: Record<string, unknown> | undefined;
	const hasVideoGenerationBalance =
		hasSufficientVideoGenerationBalance(organization);

	for (;;) {
		if (
			selectedProviderContext.usedMode === "credits" &&
			!hasVideoGenerationBalance
		) {
			routingAttempts.push({
				provider: selectedProviderContext.providerId,
				model: selectedUpstreamModelName,
				status_code: 402,
				error_type: "insufficient_credits",
				succeeded: false,
			});
			failedProviders.add(selectedProviderContext.providerId);

			const nextProvider =
				!requestedProvider && !noFallback
					? selectNextProvider(
							enrichedRoutingMetadata?.providerScores ?? [],
							failedProviders,
							orderedMappings,
						)
					: null;
			if (!nextProvider) {
				throw getInsufficientVideoGenerationBalanceError();
			}

			const nextMapping = orderedMappings.find(
				(mapping) =>
					mapping.providerId === nextProvider.providerId &&
					mapping.modelName === nextProvider.modelName,
			);
			if (!nextMapping) {
				throw getInsufficientVideoGenerationBalanceError();
			}

			selectedProviderMapping = nextMapping;
			selectedProviderContext = await resolveProviderContext(
				nextMapping.providerId as Provider,
				project,
				organization.id,
				nextMapping.modelName,
			);
			selectedUpstreamModelName = getVideoUpstreamModelName(
				nextMapping.providerId as Provider,
				nextMapping.modelName,
				videoSize,
				inputMode,
			);
			continue;
		}

		if (
			selectedProviderContext.providerId === "google-vertex" &&
			!getGoogleVertexVideoOutputBucket() &&
			organization.retentionLevel === "none"
		) {
			const statusCode = 400;
			routingAttempts.push({
				provider: selectedProviderContext.providerId,
				model: selectedUpstreamModelName,
				status_code: statusCode,
				error_type: "client_error",
				succeeded: false,
			});
			failedProviders.add(selectedProviderContext.providerId);

			const nextProvider = selectNextProvider(
				enrichedRoutingMetadata?.providerScores ?? [],
				failedProviders,
				orderedMappings,
			);
			if (!nextProvider || requestedProvider) {
				throw new HTTPException(400, {
					message:
						"Google Vertex video generation requires either GCS output storage or data retention to be enabled.",
				});
			}

			const nextMapping = orderedMappings.find(
				(mapping) =>
					mapping.providerId === nextProvider.providerId &&
					mapping.modelName === nextProvider.modelName,
			);
			if (!nextMapping) {
				throw new HTTPException(400, {
					message:
						"Google Vertex video generation requires either GCS output storage or data retention to be enabled.",
				});
			}

			selectedProviderMapping = nextMapping;
			selectedProviderContext = await resolveProviderContext(
				nextMapping.providerId as Provider,
				project,
				organization.id,
				nextMapping.modelName,
			);
			selectedUpstreamModelName = getVideoUpstreamModelName(
				nextMapping.providerId as Provider,
				nextMapping.modelName,
				videoSize,
				inputMode,
			);
			continue;
		}

		try {
			const upstreamAttemptStartedAt = Date.now();
			const upstreamJob = await createUpstreamVideoJob(
				selectedProviderContext,
				selectedProviderMapping,
				videoSize,
				request.prompt,
				videoDurationSeconds,
				request.audio,
				inputMode,
				firstFrameInput,
				lastFrameInput,
				referenceImageInputs,
				processedFirstFrame,
				processedLastFrameInput,
				processedReferenceImages,
				videoId,
				organization.id,
				project.id,
			);
			const upstreamAttemptDurationMs = Date.now() - upstreamAttemptStartedAt;
			upstreamId = upstreamJob.upstreamId;
			upstreamRequest = upstreamJob.upstreamRequest;
			upstreamResponse = upstreamJob.upstreamResponse;
			logger.info("Video upstream job created", {
				requestId,
				videoId,
				provider: selectedProviderContext.providerId,
				model: selectedUpstreamModelName,
				durationMs: upstreamAttemptDurationMs,
				retryCount,
			});
			if (upstreamAttemptDurationMs >= 5_000) {
				logger.warn("Slow video upstream job creation", {
					requestId,
					videoId,
					provider: selectedProviderContext.providerId,
					model: selectedUpstreamModelName,
					durationMs: upstreamAttemptDurationMs,
					retryCount,
				});
			}
			routingAttempts.push({
				provider: selectedProviderContext.providerId,
				model: selectedUpstreamModelName,
				status_code: 200,
				error_type: "none",
				succeeded: true,
			});
			break;
		} catch (error) {
			const statusCode = error instanceof HTTPException ? error.status : 0;
			routingAttempts.push({
				provider: selectedProviderContext.providerId,
				model: selectedUpstreamModelName,
				status_code: statusCode,
				error_type: getErrorType(statusCode),
				succeeded: false,
			});
			failedProviders.add(selectedProviderContext.providerId);

			const remainingProviders = (enrichedRoutingMetadata?.providerScores ?? [])
				.map((score) => score.providerId)
				.filter((providerId) => !failedProviders.has(providerId)).length;
			if (
				!shouldRetryRequest({
					requestedProvider,
					noFallback,
					statusCode,
					retryCount,
					remainingProviders,
					usedProvider: selectedProviderContext.providerId,
				})
			) {
				throw error;
			}

			const nextProvider = selectNextProvider(
				enrichedRoutingMetadata?.providerScores ?? [],
				failedProviders,
				orderedMappings,
			);

			if (!nextProvider) {
				throw error;
			}

			const nextMapping = orderedMappings.find(
				(mapping) =>
					mapping.providerId === nextProvider.providerId &&
					mapping.modelName === nextProvider.modelName,
			);
			if (!nextMapping) {
				throw error;
			}

			selectedProviderMapping = nextMapping;
			selectedProviderContext = await resolveProviderContext(
				nextMapping.providerId as Provider,
				project,
				organization.id,
				nextMapping.modelName,
			);
			selectedUpstreamModelName = getVideoUpstreamModelName(
				nextMapping.providerId as Provider,
				nextMapping.modelName,
				videoSize,
				inputMode,
			);
			retryCount++;
		}
	}

	if (!upstreamId || !upstreamRequest || !upstreamResponse) {
		throw new HTTPException(500, {
			message: "Video provider selection failed before job creation",
		});
	}

	if (enrichedRoutingMetadata) {
		enrichedRoutingMetadata = {
			...enrichedRoutingMetadata,
			selectedProvider: selectedProviderContext.providerId,
			routing: routingAttempts,
			providerScores: enrichedRoutingMetadata.providerScores.map((score) => {
				const failedAttempt = routingAttempts.find(
					(attempt) =>
						attempt.provider === score.providerId &&
						attempt.succeeded === false,
				);
				return failedAttempt
					? {
							...score,
							failed: true,
							status_code: failedAttempt.status_code,
							error_type: failedAttempt.error_type,
						}
					: score;
			}),
		};
	}
	const storageUri = extractStorageUri(upstreamResponse);
	const parsedStorageUri = parseGcsUri(storageUri);

	const initialStatus = normalizeVideoStatus(upstreamResponse.status);
	const databaseInsertStartedAt = Date.now();
	const created = await db
		.insert(tables.videoJob)
		.values({
			id: videoId,
			requestId,
			organizationId: organization.id,
			projectId: project.id,
			apiKeyId: apiKey.id,
			mode: project.mode,
			usedMode: selectedProviderContext.usedMode,
			model: normalizedModel,
			requestedProvider: requestedProvider ?? null,
			usedProvider: selectedProviderContext.providerId,
			usedModel: selectedUpstreamModelName,
			providerConfigIndex: selectedProviderContext.configIndex,
			upstreamId,
			prompt: request.prompt,
			status: initialStatus,
			progress: extractProgress(upstreamResponse),
			error: extractError(upstreamResponse),
			contentUrl: extractContentUrl(upstreamResponse),
			storageProvider: parsedStorageUri ? "gcs" : null,
			storageBucket: parsedStorageUri?.bucket ?? null,
			storageObjectPath: parsedStorageUri?.objectPath ?? null,
			storageUri,
			storageExpiresAt: null,
			contentType:
				typeof upstreamResponse.mime_type === "string"
					? upstreamResponse.mime_type
					: "video/mp4",
			completedAt: parseTimestamp(upstreamResponse.completed_at),
			expiresAt: parseTimestamp(upstreamResponse.expires_at),
			lastPolledAt: null,
			nextPollAt: new Date(),
			pollAttemptCount: 0,
			callbackUrl: request.callback_url ?? null,
			callbackSecret: request.callback_secret ?? null,
			callbackStatus: request.callback_url ? "pending" : "none",
			routingMetadata: enrichedRoutingMetadata ?? null,
			upstreamCreateResponse: {
				...upstreamResponse,
				...(debugMode
					? {
							llmgateway_raw_request: rawBody,
							llmgateway_upstream_request: upstreamRequest,
						}
					: {}),
			},
			upstreamStatusResponse: upstreamResponse,
		})
		.returning()
		.then((rows) => rows[0]);
	const databaseInsertCompletedAt = Date.now();

	logger.info("Created video job", {
		videoId: created.id,
		upstreamId,
		projectId: project.id,
		organizationId: organization.id,
		model: normalizedModel,
		usedProvider: selectedProviderContext.providerId,
		timings: {
			parseBodyMs: parsedBodyAt - requestStartedAt,
			requestContextMs: requestContextResolvedAt - parsedBodyAt,
			iamValidationMs: iamValidatedAt - requestContextResolvedAt,
			resolveExecutionMs: videoExecutionResolvedAt - iamValidatedAt,
			processInputsMs: inputsProcessedAt - videoExecutionResolvedAt,
			upstreamCreateMs: databaseInsertStartedAt - inputsProcessedAt,
			databaseInsertMs: databaseInsertCompletedAt - databaseInsertStartedAt,
			totalMs: databaseInsertCompletedAt - requestStartedAt,
		},
	});
	if (databaseInsertCompletedAt - requestStartedAt >= 5_000) {
		logger.warn("Slow video create request", {
			requestId,
			videoId: created.id,
			model: normalizedModel,
			usedProvider: selectedProviderContext.providerId,
			totalMs: databaseInsertCompletedAt - requestStartedAt,
		});
	}

	return c.json(await serializeVideoJob(created));
});

videos.openapi(getVideo, async (c) => {
	const { project } = await requireRequestContext(c);
	const { video_id: videoId } = c.req.valid("param");
	const job = await requireVideoJobForProject(project.id, videoId);
	return c.json(await serializeVideoJob(job));
});

videos.openapi(getVideoLogContent, async (c) => {
	const { log_id: logId } = c.req.valid("param");
	const { token } = c.req.valid("query");
	if (!token || !verifyVideoContentAccessToken(token, logId)) {
		throw new HTTPException(401, {
			message: "Unauthorized: Invalid or expired video access token.",
		});
	}

	const log = await requireVideoLogById(logId);

	const directSourceUrl = await getVideoSourceUrlFromCacheOrLog(log);
	if (directSourceUrl) {
		const response = await streamVideoFromUrl(directSourceUrl);
		await markVideoDownloaded(log.id);
		return response;
	}

	const videoJob = await db
		.select()
		.from(tables.videoJob)
		.where(
			and(
				eq(tables.videoJob.projectId, log.projectId),
				eq(tables.videoJob.requestId, log.requestId),
			),
		)
		.limit(1)
		.then((rows) => rows[0]);
	if (!videoJob) {
		throw new HTTPException(404, {
			message: "Video content is not available",
		});
	}

	if (videoJob.storageUri) {
		const signedUrl = await getExternalVideoContentUrl(videoJob);
		if (!signedUrl) {
			throw new HTTPException(404, {
				message: "Video content is not available",
			});
		}

		const response = await streamVideoFromUrl(signedUrl, videoJob.contentType);
		await markVideoDownloaded(log.id);
		return response;
	}

	if (shouldProxyDirectUpstreamVideoContent(videoJob)) {
		const response = await streamDirectUpstreamVideoContent(videoJob);
		await markVideoDownloaded(log.id);
		return response;
	}

	const inlineVideo = getInlineGoogleVertexVideoFromBodies([
		log.upstreamResponse,
		videoJob.upstreamStatusResponse,
		videoJob.upstreamCreateResponse,
	]);
	if (!inlineVideo) {
		throw new HTTPException(404, {
			message: "Video content is not available",
		});
	}

	await markVideoDownloaded(log.id);
	return new Response(
		Uint8Array.from(Buffer.from(inlineVideo.bytesBase64Encoded, "base64")),
		{
			status: 200,
			headers: {
				"Content-Type": inlineVideo.mimeType,
			},
		},
	);
});

videos.openapi(getVideoContent, async (c) => {
	const { project } = await requireRequestContext(c);
	const { video_id: videoId } = c.req.valid("param");
	const job = await requireVideoJobForProject(project.id, videoId);

	if (job.status !== "completed") {
		throw new HTTPException(409, {
			message: `Video is not ready yet. Current status: ${job.status}`,
		});
	}

	if (!job.contentUrl && !job.storageUri) {
		if (shouldProxyDirectUpstreamVideoContent(job)) {
			const logId = await getVideoLogIdByRequestId(job.requestId);
			const response = await streamDirectUpstreamVideoContent(job);
			if (logId) {
				await markVideoDownloaded(logId);
			}
			return response;
		}

		const inlineVideo = getGoogleVertexInlineVideo(job);
		if (!inlineVideo) {
			throw new HTTPException(404, {
				message: "Video content is not available",
			});
		}

		const bytes = Uint8Array.from(
			Buffer.from(inlineVideo.bytesBase64Encoded, "base64"),
		);
		return new Response(bytes, {
			status: 200,
			headers: {
				"Content-Type": inlineVideo.mimeType,
			},
		});
	}

	const contentUrl = job.contentUrl ?? (await getExternalVideoContentUrl(job));
	if (!contentUrl) {
		const inlineVideo = getGoogleVertexInlineVideo(job);
		if (inlineVideo) {
			const bytes = Uint8Array.from(
				Buffer.from(inlineVideo.bytesBase64Encoded, "base64"),
			);
			return new Response(bytes, {
				status: 200,
				headers: {
					"Content-Type": inlineVideo.mimeType,
				},
			});
		}

		throw new HTTPException(404, {
			message: "Video content is not available",
		});
	}

	const logId = await getVideoLogIdByRequestId(job.requestId);
	const response = await streamVideoFromUrl(contentUrl, job.contentType);
	if (logId) {
		await markVideoDownloaded(logId);
	}
	return response;
});
