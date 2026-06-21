import { createHmac } from "node:crypto";

import { getStopSignal, isStopRequested } from "@/shutdown.js";

import { redisClient } from "@llmgateway/cache";
import {
	and,
	asc,
	db,
	eq,
	type InferSelectModel,
	inArray,
	isNull,
	lte,
	or,
	shortid,
	tables,
	UnifiedFinishReason,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getProviderEnvConfig,
	getProviderEnvValue,
	getProviderEnvVar,
	models,
	type Provider,
	type ProviderModelMapping,
} from "@llmgateway/models";
import {
	buildGatewayVideoLogContentUrl,
	getAvalancheApiBaseUrl,
	getAvalancheJobsApiBaseUrl,
	getVideoProxyRedisKey,
	isContentFilterErrorText,
	VIDEO_PROXY_REDIS_TTL_SECONDS,
} from "@llmgateway/shared";
import {
	createSignedGcsReadUrl,
	getVideoStorageExpiryDate,
	parseGcsUri,
} from "@llmgateway/shared/gcs";
import { buildSignedGatewayVideoLogContentUrl } from "@llmgateway/shared/video-access";

const UPSTREAM_FETCH_TIMEOUT_MS = 30_000;
const WEBHOOK_DELIVERY_TIMEOUT_MS = 30_000;

function fetchWithSignals(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const stopSignal = getStopSignal();
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	return fetch(url, {
		...init,
		signal: AbortSignal.any([stopSignal, timeoutSignal]),
	});
}

function isShutdownAbort(error: unknown): boolean {
	if (!isStopRequested()) {
		return false;
	}
	if (error instanceof Error && error.name === "AbortError") {
		return true;
	}
	if (
		error instanceof Error &&
		error.cause instanceof Error &&
		error.cause.name === "AbortError"
	) {
		return true;
	}
	return false;
}

const MAX_WEBHOOK_ATTEMPTS = 8;
const WEBHOOK_BASE_DELAY_MS = 30_000;
const WEBHOOK_MAX_DELAY_MS = 60 * 60 * 1000;
const VIDEO_JOB_TIMEOUT_SECONDS =
	Number(process.env.VIDEO_JOB_TIMEOUT_SECONDS) || 60 * 60;
const VIDEO_JOB_TIMEOUT_MS = VIDEO_JOB_TIMEOUT_SECONDS * 1000;
const VIDEO_JOB_POLL_CLAIM_TTL_MS = 30_000;
const VIDEO_JOB_ERROR_BASE_DELAY_MS = 10_000;
const VIDEO_JOB_ERROR_MAX_DELAY_MS = 5 * 60 * 1000;
const VIDEO_JOB_MAX_POLL_ERROR_COUNT = 5;
const VIDEO_RESOLUTION_4K = "4k";
const VIDEO_RESOLUTION_HD = "hd";
const VIDEO_RESOLUTION_1080P = "1080p";
const VIDEO_RESOLUTION_720P = "720p";
const VIDEO_RESOLUTION_480P = "480p";
const VIDEO_DEFAULT_RESOLUTION = "default";
const ACTIVE_VIDEO_STATUSES = ["queued", "in_progress"] as const;
const TERMINAL_VIDEO_STATUS_VALUES: Array<VideoJobRecord["status"]> = [
	"completed",
	"failed",
	"canceled",
	"expired",
];
const TERMINAL_VIDEO_STATUSES = new Set<string>(TERMINAL_VIDEO_STATUS_VALUES);

type VideoJobRecord = InferSelectModel<typeof tables.videoJob>;
type WebhookDeliveryRecord = InferSelectModel<typeof tables.webhookDeliveryLog>;
interface ResolvedVideoProviderContext {
	baseUrl: string;
	token: string;
}

function isGoogleVertexVideoProvider(providerId: string): boolean {
	return providerId === "google-vertex";
}

function getDeterministicHash(seed: string): number {
	let hash = 5381;

	for (const char of seed) {
		hash = (hash * 33) ^ char.charCodeAt(0);
	}

	return Math.abs(hash >>> 0);
}

function selectLoadBalancedItem<T>(
	items: T[],
	selectionKey?: string,
): T | undefined {
	if (items.length === 0) {
		return undefined;
	}

	if (items.length === 1 || !selectionKey) {
		return items[0];
	}

	return items[getDeterministicHash(selectionKey) % items.length];
}

function getDefaultVideoProviderBaseUrl(providerId: Provider): string | null {
	switch (providerId) {
		case "openai":
			return "https://api.openai.com";
		case "xai":
			return "https://api.x.ai";
		case "atlascloud":
			return "https://api.atlascloud.ai";
		case "bytedance":
			return "https://ark.ap-southeast.bytepluses.com/api/v3";
		case "google-vertex":
			return "https://aiplatform.googleapis.com";
		case "minimax":
			return "https://api.minimax.io";
		case "alibaba":
			return "https://dashscope-intl.aliyuncs.com";
		default:
			return null;
	}
}

function isSoraVideoModelName(modelName: string): boolean {
	return modelName === "sora-2" || modelName === "sora-2-pro";
}

function isAvalancheSoraJob(job: VideoJobRecord): boolean {
	return (
		job.usedProvider === "avalanche" && isSoraVideoModelName(job.usedModel)
	);
}

async function findActiveProviderKey(
	organizationId: string,
	providerId: string,
	selectionKey?: string,
	filter?: (key: InferSelectModel<typeof tables.providerKey>) => boolean,
): Promise<InferSelectModel<typeof tables.providerKey> | undefined> {
	const providerKeys = await db
		.select()
		.from(tables.providerKey)
		.where(
			and(
				eq(tables.providerKey.status, "active"),
				eq(tables.providerKey.organizationId, organizationId),
				eq(tables.providerKey.provider, providerId),
			),
		)
		.orderBy(asc(tables.providerKey.createdAt), asc(tables.providerKey.id));

	const filtered = filter ? providerKeys.filter(filter) : providerKeys;
	return selectLoadBalancedItem(filtered, selectionKey);
}

function getVideoProviderKeyFilter(
	providerId: Provider,
): ((key: InferSelectModel<typeof tables.providerKey>) => boolean) | undefined {
	if (!isGoogleVertexVideoProvider(providerId)) {
		return undefined;
	}
	const allowedBaseUrls = new Set<string>();
	const defaultBaseUrl = getDefaultVideoProviderBaseUrl(providerId);
	if (defaultBaseUrl) {
		allowedBaseUrls.add(defaultBaseUrl);
	}
	const envBaseUrl = getProviderEnvValue(providerId, "baseUrl");
	if (envBaseUrl) {
		allowedBaseUrls.add(envBaseUrl);
	}
	return (key) => !key.baseUrl || allowedBaseUrls.has(key.baseUrl);
}

function resolveProviderEnvToken(
	providerId: Provider,
	configIndex: number | null,
): string {
	const envVarName = getProviderEnvVar(providerId);
	if (!envVarName) {
		throw new Error(`No environment variable set for provider: ${providerId}`);
	}

	const envValue = process.env[envVarName];
	if (!envValue) {
		throw new Error(
			`No API key set in environment for provider: ${providerId}`,
		);
	}

	const envConfig = getProviderEnvConfig(providerId);
	if (envConfig?.required) {
		for (const [key, requiredEnvVarName] of Object.entries(
			envConfig.required,
		)) {
			if (key === "apiKey" || !requiredEnvVarName) {
				continue;
			}

			if (!process.env[requiredEnvVarName]) {
				throw new Error(
					`${requiredEnvVarName} environment variable is required for ${providerId} provider`,
				);
			}
		}
	}

	const values = envValue
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);

	if (values.length === 0) {
		throw new Error(`Environment variable ${envVarName} is empty`);
	}

	const resolvedIndex = configIndex ?? 0;
	return resolvedIndex >= values.length
		? values[values.length - 1]
		: values[resolvedIndex];
}

async function resolveVideoProviderContext(
	job: VideoJobRecord,
): Promise<ResolvedVideoProviderContext> {
	const providerId = job.usedProvider as Provider;
	const defaultBaseUrl = getDefaultVideoProviderBaseUrl(providerId);

	if (job.usedMode === "api-keys") {
		const providerKey = await findActiveProviderKey(
			job.organizationId,
			job.usedProvider,
			job.requestId,
			getVideoProviderKeyFilter(providerId),
		);
		if (!providerKey) {
			throw new Error(`No API key set for provider: ${job.usedProvider}`);
		}

		const baseUrl =
			providerKey.baseUrl ??
			getProviderEnvValue(providerId, "baseUrl") ??
			defaultBaseUrl;
		if (!baseUrl) {
			throw new Error(`No base URL set for provider: ${job.usedProvider}`);
		}

		return {
			baseUrl,
			token: providerKey.token,
		};
	}

	const token = resolveProviderEnvToken(providerId, job.providerConfigIndex);
	const baseUrl =
		getProviderEnvValue(
			providerId,
			"baseUrl",
			job.providerConfigIndex ?? undefined,
		) ?? defaultBaseUrl;
	if (!baseUrl) {
		throw new Error(`No base URL set for provider: ${job.usedProvider}`);
	}

	return {
		baseUrl,
		token,
	};
}

function getVideoProviderHeaders(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
): Record<string, string> {
	if (isGoogleVertexVideoProvider(job.usedProvider)) {
		return {};
	}

	return {
		Authorization: `Bearer ${providerContext.token}`,
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
		case "done":
		case "success":
		case "succeeded":
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

function normalizeAvalancheSuccessFlag(
	value: unknown,
): VideoJobRecord["status"] {
	if (typeof value === "number") {
		switch (value) {
			case 1:
				return "completed";
			case 2:
			case 3:
			case -1:
				return "failed";
			default:
				return "in_progress";
		}
	}

	if (typeof value === "string" && value.length > 0) {
		const parsed = Number(value);
		if (!Number.isNaN(parsed)) {
			return normalizeAvalancheSuccessFlag(parsed);
		}
	}

	return "in_progress";
}

function parseTimestamp(value: unknown): Date | null {
	if (value instanceof Date) {
		return value;
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		return new Date(value > 1_000_000_000_000 ? value : value * 1000);
	}

	if (typeof value === "string" && value.length > 0) {
		const numeric = Number(value);
		if (!Number.isNaN(numeric)) {
			return new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000);
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
		body.video,
		body.content,
		body.output,
	];

	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.startsWith("http")) {
			return candidate;
		}

		if (Array.isArray(candidate)) {
			for (const item of candidate) {
				if (typeof item === "string" && item.startsWith("http")) {
					return item;
				}
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

function hasVideoJobTimedOut(job: VideoJobRecord, now: Date): boolean {
	return now.getTime() - job.createdAt.getTime() >= VIDEO_JOB_TIMEOUT_MS;
}

function getVideoJobPollErrorCount(job: VideoJobRecord): number {
	const upstreamStatus =
		job.upstreamStatusResponse &&
		typeof job.upstreamStatusResponse === "object" &&
		!Array.isArray(job.upstreamStatusResponse)
			? (job.upstreamStatusResponse as Record<string, unknown>)
			: null;
	const value = upstreamStatus?.llmgateway_poll_error_count;

	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return Math.floor(value);
	}

	if (typeof value === "string" && value.length > 0) {
		const parsed = Number(value);
		if (!Number.isNaN(parsed) && parsed >= 0) {
			return Math.floor(parsed);
		}
	}

	return 0;
}

function calculateNextVideoPollErrorDelayMs(errorCount: number): number {
	const multiplier = Math.pow(2, Math.max(0, errorCount - 1));
	return Math.min(
		VIDEO_JOB_ERROR_MAX_DELAY_MS,
		VIDEO_JOB_ERROR_BASE_DELAY_MS * multiplier,
	);
}

function buildVideoJobTimeoutResponse(
	job: VideoJobRecord,
	now: Date,
	upstreamStatus?: Record<string, unknown>,
): Record<string, unknown> {
	return addRequestedVideoMetadata(job, {
		...(upstreamStatus ?? {}),
		status: "failed",
		progress: 100,
		completed_at: now.toISOString(),
		error: {
			code: "timeout",
			message: `Video generation timed out after ${VIDEO_JOB_TIMEOUT_SECONDS} seconds without reaching a terminal state`,
			details: {
				reason: "video_job_timeout",
				timeout_seconds: VIDEO_JOB_TIMEOUT_SECONDS,
				last_upstream_status:
					upstreamStatus && typeof upstreamStatus.status === "string"
						? upstreamStatus.status
						: null,
			},
		},
		llmgateway_timed_out: true,
	});
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

function getInlineGoogleVertexVideo(
	job: VideoJobRecord,
): { bytesBase64Encoded: string; mimeType: string } | null {
	for (const candidate of getVideoMetadataCandidates(job)) {
		const response =
			typeof candidate.response === "object" && candidate.response
				? (candidate.response as Record<string, unknown>)
				: null;
		const videos =
			response && Array.isArray(response.videos) ? response.videos : null;
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
		(job.contentUrl || job.storageUri || getInlineGoogleVertexVideo(job))
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
		progress:
			job.status === "completed"
				? 100
				: Math.max(0, Math.min(100, job.progress)),
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

function getVideoMetadataCandidates(
	job: VideoJobRecord,
): Array<Record<string, unknown>> {
	return [job.upstreamStatusResponse, job.upstreamCreateResponse].filter(
		(candidate): candidate is Record<string, unknown> =>
			Boolean(candidate) && typeof candidate === "object",
	);
}

function readNestedValue(
	body: Record<string, unknown>,
	key: string,
): unknown | undefined {
	if (key in body) {
		return body[key];
	}

	if (body.data && typeof body.data === "object") {
		const data = body.data as Record<string, unknown>;
		if (key in data) {
			return data[key];
		}
	}

	return undefined;
}

function getStoredVideoDebugPayload(
	job: VideoJobRecord,
	key: "llmgateway_raw_request" | "llmgateway_upstream_request",
): unknown | null {
	for (const candidate of getVideoMetadataCandidates(job)) {
		if (!(key in candidate)) {
			continue;
		}

		return candidate[key] ?? null;
	}

	return null;
}

function getFormattedRequestedVideoModel(job: VideoJobRecord): string {
	return job.requestedProvider
		? `${job.requestedProvider}/${job.model}`
		: job.model;
}

function getFormattedUsedVideoModel(job: VideoJobRecord): string {
	return `${job.usedProvider}/${job.model}`;
}

function getRequestedVideoSize(job: VideoJobRecord): string | null {
	for (const candidate of getVideoMetadataCandidates(job)) {
		const requestedSize = readNestedValue(
			candidate,
			"llmgateway_requested_size",
		);
		if (typeof requestedSize === "string" && requestedSize.length > 0) {
			return requestedSize;
		}
	}

	for (const candidate of getVideoMetadataCandidates(job)) {
		const value = readNestedValue(candidate, "size");
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	return null;
}

function getAvalancheUpgradeTaskId(job: VideoJobRecord): string | null {
	for (const candidate of getVideoMetadataCandidates(job)) {
		const value = readNestedValue(candidate, "avalanche_upgrade_task_id");
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	return null;
}

function parseAvalancheResultUrls(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}

	if (typeof value === "string" && value.length > 0) {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.filter(
					(item): item is string => typeof item === "string",
				);
			}
		} catch {
			return [value];
		}
	}

	return [];
}

function getRequestedVideoMetadata(job: VideoJobRecord): {
	size: string;
	width: number;
	height: number;
	resolution: "480p" | "720p" | "1080p" | "hd" | "4k";
} | null {
	const size = getRequestedVideoSize(job);
	if (!size) {
		return null;
	}

	const match = size.match(/^(\d+)x(\d+)$/);
	if (!match) {
		return null;
	}

	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height)) {
		return null;
	}

	let requestedResolution: "480p" | "720p" | "1080p" | "hd" | "4k" | null =
		null;
	for (const candidate of getVideoMetadataCandidates(job)) {
		const value = readNestedValue(candidate, "llmgateway_requested_resolution");
		if (
			value === "480p" ||
			value === "720p" ||
			value === "1080p" ||
			value === "hd" ||
			value === "4k"
		) {
			requestedResolution = value;
			break;
		}
	}
	if (!requestedResolution) {
		for (const candidate of getVideoMetadataCandidates(job)) {
			const value = readNestedValue(candidate, "resolution");
			if (
				value === "480p" ||
				value === "720p" ||
				value === "1080p" ||
				value === "hd" ||
				value === "4k"
			) {
				requestedResolution = value;
				break;
			}
		}
	}

	const largestDimension = Math.max(width, height);
	const resolution =
		requestedResolution ??
		(largestDimension >= 3840
			? "4k"
			: largestDimension >= 1920
				? "1080p"
				: largestDimension >= 1792
					? "hd"
					: largestDimension >= 720
						? "720p"
						: "480p");

	return {
		size,
		width,
		height,
		resolution,
	};
}

function getRequestedVideoDurationSeconds(job: VideoJobRecord): number | null {
	for (const candidate of getVideoMetadataCandidates(job)) {
		for (const key of [
			"llmgateway_requested_duration_seconds",
			"duration",
			"duration_seconds",
			"durationSeconds",
			"seconds",
		]) {
			const value = readNestedValue(candidate, key);
			if (typeof value === "number" && Number.isFinite(value) && value > 0) {
				return value;
			}

			if (typeof value === "string" && value.length > 0) {
				const parsed = Number(value);
				if (!Number.isNaN(parsed) && parsed > 0) {
					return parsed;
				}
			}
		}
	}

	return null;
}

function addRequestedVideoMetadata(
	job: VideoJobRecord,
	body: Record<string, unknown>,
): Record<string, unknown> {
	const requestedMetadata = getRequestedVideoMetadata(job);
	if (!requestedMetadata) {
		return body;
	}

	return {
		...body,
		size:
			typeof body.size === "string" && body.size.length > 0
				? body.size
				: requestedMetadata.size,
		width:
			typeof body.width === "number" && Number.isFinite(body.width)
				? body.width
				: requestedMetadata.width,
		height:
			typeof body.height === "number" && Number.isFinite(body.height)
				? body.height
				: requestedMetadata.height,
		resolution:
			typeof body.resolution === "string" && body.resolution.length > 0
				? body.resolution
				: requestedMetadata.resolution,
		duration:
			typeof body.duration === "number" && Number.isFinite(body.duration)
				? body.duration
				: (getRequestedVideoDurationSeconds(job) ?? 8),
	};
}

function getRequestedAvalancheResolution(
	job: VideoJobRecord,
): "1080p" | "4k" | null {
	const requestedMetadata = getRequestedVideoMetadata(job);
	if (
		requestedMetadata?.resolution === "1080p" ||
		requestedMetadata?.resolution === "4k"
	) {
		return requestedMetadata.resolution;
	}

	return null;
}

function readAvalancheResponseData(
	body: Record<string, unknown>,
): Record<string, unknown> {
	return body.data && typeof body.data === "object"
		? (body.data as Record<string, unknown>)
		: {};
}

function getAvalancheMessage(body: Record<string, unknown>): string | null {
	const data = readAvalancheResponseData(body);

	for (const candidate of [
		body.msg,
		body.message,
		data.msg,
		data.message,
		data.errorMessage,
	]) {
		if (typeof candidate === "string" && candidate.length > 0) {
			return candidate;
		}
	}

	return null;
}

function parseAvalancheTaskJsonRecord(
	value: unknown,
): Record<string, unknown> | null {
	if (!value || typeof value !== "string" || value.length === 0) {
		return null;
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function parseAvalancheTaskResultUrls(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}

	if (typeof value === "string" && value.length > 0) {
		return [value];
	}

	return [];
}

function normalizeAvalancheSoraRecordInfo(
	job: VideoJobRecord,
	body: Record<string, unknown>,
): Record<string, unknown> {
	const data = readAvalancheResponseData(body);
	const result = parseAvalancheTaskJsonRecord(data.resultJson);
	const resultUrls = parseAvalancheTaskResultUrls(result?.resultUrls);
	const originUrls = parseAvalancheTaskResultUrls(result?.originUrls);
	const url = resultUrls[0] ?? originUrls[0] ?? null;
	const status = normalizeVideoStatus(data.state);
	const progress =
		typeof data.progress === "number" && Number.isFinite(data.progress)
			? Math.max(0, Math.min(100, Math.round(data.progress)))
			: status === "completed" || status === "failed"
				? 100
				: status === "in_progress"
					? 50
					: 0;
	const failCode =
		typeof data.failCode === "string" && data.failCode.length > 0
			? data.failCode
			: undefined;
	const failMsg =
		typeof data.failMsg === "string" && data.failMsg.length > 0
			? data.failMsg
			: null;

	return addRequestedVideoMetadata(job, {
		status,
		progress,
		url,
		output_url: url,
		mime_type: url ? "video/mp4" : undefined,
		completed_at: data.completeTime,
		created_at: data.createTime,
		error:
			status === "failed"
				? {
						message: failMsg ?? "Avalanche Sora video generation failed",
						code: failCode,
						details: body,
					}
				: null,
		avalanche_result_json: result ?? data.resultJson,
		avalanche_record_info: body,
	});
}

function createAvalanchePendingUpgradeResponse(
	job: VideoJobRecord,
	baseResponse: Record<string, unknown>,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return addRequestedVideoMetadata(job, {
		...baseResponse,
		...extra,
		status: "in_progress",
		progress:
			typeof extra.progress === "number" && Number.isFinite(extra.progress)
				? extra.progress
				: 95,
		error: null,
	});
}

function normalizeAvalancheRecordInfo(
	job: VideoJobRecord,
	body: Record<string, unknown>,
): Record<string, unknown> {
	const data = readAvalancheResponseData(body);
	const response =
		data.response && typeof data.response === "object"
			? (data.response as Record<string, unknown>)
			: {};
	const resultUrls = parseAvalancheResultUrls(
		response.resultUrls ?? data.resultUrls,
	);
	const originUrls = parseAvalancheResultUrls(
		response.originUrls ?? data.originUrls,
	);
	const url = resultUrls[0] ?? originUrls[0] ?? null;
	const status = normalizeAvalancheSuccessFlag(data.successFlag);
	const message = getAvalancheMessage(body);

	return addRequestedVideoMetadata(job, {
		status,
		progress: status === "completed" ? 100 : status === "failed" ? 100 : 50,
		url,
		output_url: url,
		mime_type: url ? "video/mp4" : undefined,
		completed_at: data.completeTime,
		created_at: data.createTime,
		resolution:
			typeof response.resolution === "string"
				? response.resolution
				: typeof data.resolution === "string"
					? data.resolution
					: undefined,
		fallbackFlag: data.fallbackFlag,
		error:
			status === "failed"
				? {
						message: message ?? "Avalanche video generation failed",
						code:
							typeof data.errorCode === "string" ? data.errorCode : undefined,
						details: body,
					}
				: null,
		avalanche_record_info: body,
	});
}

async function fetchJsonResponse(
	url: string,
	init: RequestInit,
): Promise<{
	body: Record<string, unknown>;
	response: Response;
}> {
	const response = await fetchWithSignals(url, init, UPSTREAM_FETCH_TIMEOUT_MS);
	const text = await response.text();

	let body: Record<string, unknown> = {};
	if (text.length > 0) {
		try {
			body = JSON.parse(text) as Record<string, unknown>;
		} catch {
			body = {
				message: text,
			};
		}
	}

	return { body, response };
}

async function fetchAvalancheRecordInfo(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
	taskId: string,
): Promise<Record<string, unknown>> {
	const url = new URL(
		joinUrl(getAvalancheApiBaseUrl(providerContext.baseUrl), "/record-info"),
	);
	url.searchParams.set("taskId", taskId);

	const { body, response } = await fetchJsonResponse(url.toString(), {
		method: "GET",
		headers: getVideoProviderHeaders(job, providerContext),
	});

	if (!response.ok) {
		throw new Error(
			getAvalancheMessage(body) ??
				`Avalanche status request failed with status ${response.status}`,
		);
	}

	return body;
}

async function fetchAvalancheSoraStatus(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
): Promise<Record<string, unknown>> {
	const url = new URL(
		joinUrl(getAvalancheJobsApiBaseUrl(providerContext.baseUrl), "/recordInfo"),
	);
	url.searchParams.set("taskId", job.upstreamId);

	const { body, response } = await fetchJsonResponse(url.toString(), {
		method: "GET",
		headers: getVideoProviderHeaders(job, providerContext),
	});

	if (!response.ok) {
		throw new Error(
			getAvalancheMessage(body) ??
				`Avalanche Sora status request failed with status ${response.status}`,
		);
	}

	return normalizeAvalancheSoraRecordInfo(job, body);
}

async function fetchAvalanche1080pUpgrade(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
	baseResponse: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const url = new URL(
		joinUrl(
			getAvalancheApiBaseUrl(providerContext.baseUrl),
			"/get-1080p-video",
		),
	);
	url.searchParams.set("taskId", job.upstreamId);
	url.searchParams.set("index", "0");

	const { body, response } = await fetchJsonResponse(url.toString(), {
		method: "GET",
		headers: getVideoProviderHeaders(job, providerContext),
	});
	const data = readAvalancheResponseData(body);
	const resultUrl =
		typeof data.resultUrl === "string"
			? data.resultUrl
			: parseAvalancheResultUrls(data.resultUrls)[0];

	if (response.ok && resultUrl) {
		return addRequestedVideoMetadata(job, {
			...baseResponse,
			status: "completed",
			progress: 100,
			url: resultUrl,
			output_url: resultUrl,
			mime_type: "video/mp4",
			error: null,
			resolution: "1080p",
			avalanche_1080p_response: body,
		});
	}

	return createAvalanchePendingUpgradeResponse(job, baseResponse, {
		avalanche_1080p_response: body,
	});
}

async function fetchAvalanche4kUpgrade(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
	baseResponse: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const url = joinUrl(
		getAvalancheApiBaseUrl(providerContext.baseUrl),
		"/get-4k-video",
	);
	const { body, response } = await fetchJsonResponse(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...getVideoProviderHeaders(job, providerContext),
		},
		body: JSON.stringify({
			taskId: job.upstreamId,
			index: 0,
		}),
	});
	const data = readAvalancheResponseData(body);
	const resultUrls = parseAvalancheResultUrls(
		data.resultUrls ?? data.resultUrl ?? body.resultUrls ?? body.resultUrl,
	);
	const resultUrl = resultUrls[0];
	const upgradeTaskId =
		typeof data.taskId === "string" && data.taskId.length > 0
			? data.taskId
			: getAvalancheUpgradeTaskId(job);

	if (response.ok && resultUrl) {
		return addRequestedVideoMetadata(job, {
			...baseResponse,
			status: "completed",
			progress: 100,
			url: resultUrl,
			output_url: resultUrl,
			mime_type: "video/mp4",
			error: null,
			resolution: "4k",
			avalanche_upgrade_task_id: upgradeTaskId ?? null,
			avalanche_4k_response: body,
		});
	}

	if (
		response.ok ||
		response.status === 422 ||
		response.status === 409 ||
		response.status === 425
	) {
		return createAvalanchePendingUpgradeResponse(job, baseResponse, {
			avalanche_upgrade_task_id: upgradeTaskId ?? null,
			avalanche_4k_response: body,
		});
	}

	throw new Error(
		getAvalancheMessage(body) ??
			`Avalanche 4k request failed with status ${response.status}`,
	);
}

async function fetchAvalancheStatus(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
): Promise<Record<string, unknown>> {
	const recordInfo = await fetchAvalancheRecordInfo(
		job,
		providerContext,
		job.upstreamId,
	);
	const normalizedRecordInfo = normalizeAvalancheRecordInfo(job, recordInfo);
	const requestedResolution = getRequestedAvalancheResolution(job);
	const resolvedResolution =
		typeof normalizedRecordInfo.resolution === "string"
			? normalizedRecordInfo.resolution.toLowerCase()
			: null;

	if (normalizedRecordInfo.status !== "completed" || !requestedResolution) {
		return normalizedRecordInfo;
	}

	if (
		requestedResolution === "1080p" &&
		resolvedResolution === "1080p" &&
		extractContentUrl(normalizedRecordInfo)
	) {
		return normalizedRecordInfo;
	}

	if (
		requestedResolution === "4k" &&
		resolvedResolution === "4k" &&
		extractContentUrl(normalizedRecordInfo)
	) {
		return normalizedRecordInfo;
	}

	if (requestedResolution === "1080p") {
		return await fetchAvalanche1080pUpgrade(
			job,
			providerContext,
			normalizedRecordInfo,
		);
	}

	if (requestedResolution === "4k") {
		return await fetchAvalanche4kUpgrade(
			job,
			providerContext,
			normalizedRecordInfo,
		);
	}

	return normalizedRecordInfo;
}

function getGoogleVertexOperationMetadata(job: VideoJobRecord): {
	projectId: string;
	region: string;
	modelName: string;
} | null {
	for (const candidate of getVideoMetadataCandidates(job)) {
		const projectId = readNestedValue(candidate, "google_vertex_project_id");
		const region = readNestedValue(candidate, "google_vertex_region");
		const modelName = readNestedValue(candidate, "google_vertex_model_name");

		if (
			typeof projectId === "string" &&
			projectId.length > 0 &&
			typeof region === "string" &&
			region.length > 0 &&
			typeof modelName === "string" &&
			modelName.length > 0
		) {
			return {
				projectId,
				region,
				modelName,
			};
		}
	}

	return null;
}

function normalizeGoogleVertexOperation(
	job: VideoJobRecord,
	body: Record<string, unknown>,
): Record<string, unknown> {
	const response =
		body.response && typeof body.response === "object"
			? (body.response as Record<string, unknown>)
			: {};
	const videos = Array.isArray(response.videos) ? response.videos : [];
	const firstVideo =
		videos[0] && typeof videos[0] === "object"
			? (videos[0] as Record<string, unknown>)
			: null;
	const gcsUri =
		firstVideo && typeof firstVideo.gcsUri === "string"
			? firstVideo.gcsUri
			: null;
	const mimeType =
		firstVideo && typeof firstVideo.mimeType === "string"
			? firstVideo.mimeType
			: "video/mp4";
	const status =
		body.done === true
			? body.error && typeof body.error === "object"
				? "failed"
				: "completed"
			: "in_progress";
	const error =
		status === "failed"
			? {
					message:
						body.error &&
						typeof body.error === "object" &&
						"message" in body.error &&
						typeof body.error.message === "string"
							? body.error.message
							: "Google Vertex video generation failed",
					code:
						body.error &&
						typeof body.error === "object" &&
						"code" in body.error &&
						typeof body.error.code === "number"
							? String(body.error.code)
							: undefined,
					details: body.error ?? body,
				}
			: null;

	return addRequestedVideoMetadata(job, {
		...body,
		status,
		progress: status === "completed" || status === "failed" ? 100 : 50,
		url: gcsUri,
		output_url: gcsUri,
		storage_uri: gcsUri,
		mime_type: mimeType,
		error,
	});
}

async function fetchGoogleVertexStatus(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
): Promise<Record<string, unknown>> {
	const operationMetadata = getGoogleVertexOperationMetadata(job);
	if (!operationMetadata) {
		throw new Error("Missing Google Vertex operation metadata");
	}

	const url = joinUrl(
		providerContext.baseUrl,
		`/v1/projects/${operationMetadata.projectId}/locations/${operationMetadata.region}/publishers/google/models/${operationMetadata.modelName}:fetchPredictOperation`,
	);
	const authenticatedUrl = appendQueryParam(url, "key", providerContext.token);
	const { body, response } = await fetchJsonResponse(authenticatedUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...getVideoProviderHeaders(job, providerContext),
		},
		body: JSON.stringify({
			operationName: job.upstreamId,
		}),
	});

	if (!response.ok) {
		throw new Error(
			body.error &&
			typeof body.error === "object" &&
			"message" in body.error &&
			typeof body.error.message === "string"
				? body.error.message
				: `Google Vertex status request failed with status ${response.status}`,
		);
	}

	return normalizeGoogleVertexOperation(job, body);
}

function extractVideoDurationSeconds(job: VideoJobRecord): number | null {
	return getRequestedVideoDurationSeconds(job);
}

function is4kVideo(job: VideoJobRecord): boolean {
	for (const candidate of getVideoMetadataCandidates(job)) {
		for (const key of ["resolution", "size", "quality"]) {
			const value = readNestedValue(candidate, key);
			if (
				typeof value === "string" &&
				(value.toLowerCase().includes("4k") ||
					value.toLowerCase().includes("2160"))
			) {
				return true;
			}
		}

		for (const key of ["height", "width"]) {
			const value = readNestedValue(candidate, key);
			if (typeof value === "number" && value >= 2160) {
				return true;
			}
			if (typeof value === "string") {
				const parsed = Number(value);
				if (!Number.isNaN(parsed) && parsed >= 2160) {
					return true;
				}
			}
		}
	}

	return false;
}

function videoIncludesAudio(job: VideoJobRecord): boolean | null {
	for (const candidate of getVideoMetadataCandidates(job)) {
		for (const key of [
			"google_vertex_generate_audio",
			"generate_audio",
			"generateAudio",
			"audio",
			"audio_enabled",
		]) {
			const value = readNestedValue(candidate, key);
			if (typeof value === "boolean") {
				return value;
			}
			if (typeof value === "string") {
				const normalized = value.toLowerCase();
				if (normalized === "true") {
					return true;
				}
				if (normalized === "false") {
					return false;
				}
			}
		}
	}

	return null;
}

function inferVideoIncludesAudioFromPricing(
	pricing: Record<string, string>,
): boolean | null {
	const pricingKeys = Object.keys(pricing);
	const hasAudioPricing = pricingKeys.some((key) => key.endsWith("_audio"));
	const hasVideoPricing = pricingKeys.some((key) => key.endsWith("_video"));
	const hasGenericPricing = pricingKeys.some(
		(key) => !key.endsWith("_audio") && !key.endsWith("_video"),
	);

	if (hasAudioPricing && hasVideoPricing && !hasGenericPricing) {
		return true;
	}

	return null;
}

function getVideoPricing(job: VideoJobRecord): Record<string, string> | null {
	const model = models.find((item) => item.id === job.model);
	const mapping = model?.providers.find(
		(provider) => provider.providerId === job.usedProvider,
	) as ProviderModelMapping | undefined;
	return mapping?.perSecondPrice ?? null;
}

function getVideoRequestPrice(job: VideoJobRecord): number | null {
	const model = models.find((item) => item.id === job.model);
	const mapping = model?.providers.find(
		(provider) => provider.providerId === job.usedProvider,
	) as ProviderModelMapping | undefined;
	if (mapping?.requestPrice === undefined) {
		return null;
	}
	const n = Number(mapping.requestPrice);
	return Number.isFinite(n) ? n : null;
}

function getVideoImageInputPrice(job: VideoJobRecord): number | null {
	const model = models.find((item) => item.id === job.model);
	const mapping = model?.providers.find(
		(provider) => provider.providerId === job.usedProvider,
	) as ProviderModelMapping | undefined;
	if (mapping?.imageInputPrice === undefined) {
		return null;
	}
	const n = Number(mapping.imageInputPrice);
	return Number.isFinite(n) ? n : null;
}

function getVideoInputImageCount(job: VideoJobRecord): number {
	for (const candidate of getVideoMetadataCandidates(job)) {
		const value = readNestedValue(candidate, "llmgateway_input_image_count");
		if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
			return value;
		}

		if (typeof value === "string" && value.length > 0) {
			const parsed = Number(value);
			if (Number.isInteger(parsed) && parsed >= 0) {
				return parsed;
			}
		}
	}

	return 0;
}

function getVideoImageInputCost(job: VideoJobRecord): number {
	const pricePerImage = getVideoImageInputPrice(job);
	if (pricePerImage === null) {
		return 0;
	}

	return Number((getVideoInputImageCount(job) * pricePerImage).toFixed(6));
}

function getVideoOutputCost(job: VideoJobRecord): number {
	const pricing = getVideoPricing(job);
	if (!pricing) {
		return getVideoRequestPrice(job) ?? 0;
	}

	const durationSeconds = extractVideoDurationSeconds(job);
	if (durationSeconds === null) {
		logger.warn("Could not determine video duration for billing", {
			videoId: job.id,
			model: job.model,
			upstreamId: job.upstreamId,
		});
		return 0;
	}

	const requestedResolution =
		getRequestedVideoMetadata(job)?.resolution ?? null;
	const resolutionKey = is4kVideo(job)
		? VIDEO_RESOLUTION_4K
		: requestedResolution === VIDEO_RESOLUTION_HD
			? VIDEO_RESOLUTION_HD
			: requestedResolution === VIDEO_RESOLUTION_1080P
				? VIDEO_RESOLUTION_1080P
				: requestedResolution === VIDEO_RESOLUTION_720P
					? VIDEO_RESOLUTION_720P
					: requestedResolution === VIDEO_RESOLUTION_480P
						? VIDEO_RESOLUTION_480P
						: VIDEO_DEFAULT_RESOLUTION;
	const resolutionCandidates = [
		requestedResolution,
		resolutionKey,
		VIDEO_DEFAULT_RESOLUTION,
	].filter(
		(candidate, index, array): candidate is string =>
			typeof candidate === "string" && array.indexOf(candidate) === index,
	);
	const includesAudio =
		videoIncludesAudio(job) ?? inferVideoIncludesAudioFromPricing(pricing);
	const priceCandidates =
		includesAudio === null
			? resolutionCandidates
			: [
					...resolutionCandidates.map(
						(resolution) =>
							`${resolution}_${includesAudio ? "audio" : "video"}`,
					),
					...resolutionCandidates,
				];
	const pricePerSecondStr = priceCandidates
		.map((key) => pricing[key])
		.find((value): value is string => value !== undefined);
	const pricePerSecond =
		pricePerSecondStr !== undefined ? Number(pricePerSecondStr) : undefined;
	if (pricePerSecond === undefined || !Number.isFinite(pricePerSecond)) {
		logger.warn("Could not determine per-second video price", {
			videoId: job.id,
			model: job.model,
			upstreamId: job.upstreamId,
			resolutionKey,
			includesAudio,
		});
		return 0;
	}

	return Number((durationSeconds * pricePerSecond).toFixed(6));
}

function calculateNextWebhookRetryAt(attempt: number): Date {
	const multiplier = Math.pow(2, Math.max(0, attempt - 1));
	const delay = Math.min(
		WEBHOOK_MAX_DELAY_MS,
		WEBHOOK_BASE_DELAY_MS * multiplier,
	);
	return new Date(Date.now() + delay);
}

function createWebhookSignature(
	eventId: string,
	timestamp: string,
	payload: string,
	secret: string,
): string {
	const signedContent = `${eventId}.${timestamp}.${payload}`;
	const signature = createHmac("sha256", secret)
		.update(signedContent)
		.digest("base64");
	return `v1,${signature}`;
}

async function finalizeVideoJob(job: VideoJobRecord): Promise<void> {
	let currentJob = job;

	if (!currentJob.resultLoggedAt) {
		const now = new Date();
		const logId = shortid();
		const claimedJob = await db.transaction(async (tx) => {
			const jobToLog = await tx
				.update(tables.videoJob)
				.set({
					resultLoggedAt: now,
				})
				.where(
					and(
						eq(tables.videoJob.id, currentJob.id),
						isNull(tables.videoJob.resultLoggedAt),
					),
				)
				.returning()
				.then((rows) => rows[0] ?? null);

			if (!jobToLog) {
				return null;
			}

			const organization = await tx
				.select()
				.from(tables.organization)
				.where(eq(tables.organization.id, jobToLog.organizationId))
				.limit(1)
				.then((rows) => rows[0]);
			const videoOutputCost =
				jobToLog.status === "completed" ? getVideoOutputCost(jobToLog) : 0;
			const imageInputCost =
				jobToLog.status === "completed" ? getVideoImageInputCost(jobToLog) : 0;
			const totalCost = Number((videoOutputCost + imageInputCost).toFixed(6));
			const responsePayload = await serializeVideoJob(jobToLog, logId);
			const responseSize = JSON.stringify(responsePayload).length;
			const messages =
				organization?.retentionLevel === "retain"
					? [
							{
								role: "user",
								content: jobToLog.prompt,
							},
						]
					: null;

			const isContentFilterFailure =
				jobToLog.status === "failed" &&
				isContentFilterErrorText(
					[jobToLog.error?.code, jobToLog.error?.message]
						.filter(Boolean)
						.join(" "),
				);
			const failureFinishReason = isContentFilterFailure
				? "content_filter"
				: "upstream_error";
			const failureUnifiedFinishReason = isContentFilterFailure
				? UnifiedFinishReason.CONTENT_FILTER
				: UnifiedFinishReason.UPSTREAM_ERROR;

			await tx.insert(tables.log).values({
				id: logId,
				requestId: jobToLog.requestId,
				organizationId: jobToLog.organizationId,
				projectId: jobToLog.projectId,
				apiKeyId: jobToLog.apiKeyId,
				endUserSessionId: jobToLog.endUserSessionId,
				endCustomerWalletId: jobToLog.endCustomerWalletId,
				duration: Math.max(0, Date.now() - jobToLog.createdAt.getTime()),
				requestedModel: getFormattedRequestedVideoModel(jobToLog),
				requestedProvider: jobToLog.requestedProvider,
				usedModel: getFormattedUsedVideoModel(jobToLog),
				usedModelMapping: jobToLog.usedModel,
				usedProvider: jobToLog.usedProvider,
				responseSize,
				content:
					jobToLog.status === "completed" && responsePayload.content?.[0]?.url
						? buildGatewayVideoLogContentUrl(logId)
						: null,
				finishReason:
					jobToLog.status === "completed" ? "completed" : failureFinishReason,
				unifiedFinishReason:
					jobToLog.status === "completed"
						? UnifiedFinishReason.COMPLETED
						: failureUnifiedFinishReason,
				hasError: jobToLog.status !== "completed",
				errorDetails: jobToLog.error
					? {
							statusCode: 502,
							statusText: jobToLog.status,
							responseText: jobToLog.error.message,
						}
					: null,
				cost: totalCost,
				requestCost: 0,
				imageInputCost,
				videoOutputCost,
				estimatedCost: false,
				messages,
				mode: jobToLog.mode,
				usedMode: jobToLog.usedMode,
				routingMetadata: jobToLog.routingMetadata ?? null,
				rawRequest: getStoredVideoDebugPayload(
					jobToLog,
					"llmgateway_raw_request",
				),
				rawResponse: responsePayload,
				upstreamRequest: getStoredVideoDebugPayload(
					jobToLog,
					"llmgateway_upstream_request",
				),
				upstreamResponse: jobToLog.upstreamStatusResponse,
				processedAt: null,
				dataStorageCost: "0",
			});

			return jobToLog;
		});

		if (claimedJob?.contentUrl) {
			await cacheVideoProxySourceUrl(logId, claimedJob.contentUrl);
		}
		if (claimedJob) {
			currentJob = claimedJob;
		}
	}

	if (
		currentJob.callbackUrl &&
		currentJob.callbackSecret &&
		currentJob.callbackStatus === "pending" &&
		!currentJob.callbackEventId
	) {
		const eventId = `evt_${currentJob.id}`;
		const eventType =
			currentJob.status === "completed" ? "video.completed" : "video.failed";

		await db.transaction(async (tx) => {
			const callbackClaim = await tx
				.update(tables.videoJob)
				.set({
					callbackEventId: eventId,
					callbackEventType: eventType,
				})
				.where(
					and(
						eq(tables.videoJob.id, currentJob.id),
						eq(tables.videoJob.callbackStatus, "pending"),
						isNull(tables.videoJob.callbackEventId),
					),
				)
				.returning({ id: tables.videoJob.id })
				.then((rows) => rows[0] ?? null);

			if (!callbackClaim) {
				return;
			}

			await tx.insert(tables.webhookDeliveryLog).values({
				videoJobId: currentJob.id,
				eventId,
				eventType,
				targetUrl: currentJob.callbackUrl!,
				attempt: 1,
				status: "pending",
				nextRetryAt: new Date(),
			});
		});
	}
}

function isBytedanceVideoProvider(providerId: string): boolean {
	return providerId === "bytedance";
}

function isMinimaxVideoProvider(providerId: string): boolean {
	return providerId === "minimax";
}

function isAlibabaVideoProvider(providerId: string): boolean {
	return providerId === "alibaba";
}

function isAtlasCloudVideoProvider(providerId: string): boolean {
	return providerId === "atlascloud";
}

async function fetchAtlasCloudStatus(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
): Promise<Record<string, unknown>> {
	const url = joinUrl(
		providerContext.baseUrl,
		`/api/v1/model/prediction/${job.upstreamId}`,
	);
	const { body, response } = await fetchJsonResponse(url, {
		method: "GET",
		headers: getVideoProviderHeaders(job, providerContext),
	});

	if (!response.ok) {
		throw new Error(
			typeof body.error === "object" &&
			body.error &&
			"message" in body.error &&
			typeof body.error.message === "string"
				? body.error.message
				: `AtlasCloud status request failed with status ${response.status}`,
		);
	}

	const data =
		body.data && typeof body.data === "object"
			? (body.data as Record<string, unknown>)
			: body;
	const status = normalizeVideoStatus(data.status);
	const outputs = Array.isArray(data.outputs) ? data.outputs : [];
	const outputUrl =
		outputs
			.map((output) =>
				typeof output === "string"
					? output
					: output &&
						  typeof output === "object" &&
						  "url" in output &&
						  typeof output.url === "string"
						? output.url
						: null,
			)
			.find((url) => url !== null) ?? null;

	return addRequestedVideoMetadata(job, {
		...body,
		status,
		progress:
			status === "completed"
				? 100
				: status === "failed"
					? 100
					: status === "in_progress"
						? 50
						: 0,
		url: outputUrl,
		output_url: outputUrl,
		outputs,
		mime_type: outputUrl ? "video/mp4" : undefined,
		error:
			status === "failed"
				? {
						message:
							typeof data.error === "string"
								? data.error
								: data.error &&
									  typeof data.error === "object" &&
									  "message" in data.error &&
									  typeof data.error.message === "string"
									? data.error.message
									: "AtlasCloud video generation failed",
						details: body,
					}
				: null,
		atlascloud_raw_response: body,
	});
}

async function fetchAlibabaStatus(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
): Promise<Record<string, unknown>> {
	const url = joinUrl(
		providerContext.baseUrl,
		`/api/v1/tasks/${job.upstreamId}`,
	);
	const { body, response } = await fetchJsonResponse(url, {
		method: "GET",
		headers: getVideoProviderHeaders(job, providerContext),
	});

	if (!response.ok) {
		throw new Error(
			typeof body.message === "string"
				? body.message
				: `Alibaba status request failed with status ${response.status}`,
		);
	}

	const output =
		body.output && typeof body.output === "object"
			? (body.output as Record<string, unknown>)
			: {};
	const rawStatus =
		typeof output.task_status === "string" ? output.task_status : "PENDING";
	const status = normalizeVideoStatus(rawStatus);
	const videoUrl =
		typeof output.video_url === "string" ? output.video_url : null;

	return addRequestedVideoMetadata(job, {
		...body,
		status,
		progress:
			status === "completed"
				? 100
				: status === "failed"
					? 100
					: status === "in_progress"
						? 50
						: 0,
		url: videoUrl,
		video_url: videoUrl,
		output_url: videoUrl,
		mime_type: videoUrl ? "video/mp4" : undefined,
		error:
			status === "failed"
				? {
						message:
							typeof output.message === "string"
								? output.message
								: typeof body.message === "string"
									? body.message
									: "Alibaba video generation failed",
						code:
							typeof output.code === "string"
								? output.code
								: typeof body.code === "string"
									? body.code
									: undefined,
						details: body,
					}
				: null,
		alibaba_raw_response: body,
	});
}

async function fetchMinimaxStatus(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
): Promise<Record<string, unknown>> {
	const url = joinUrl(
		providerContext.baseUrl,
		`/v1/query/video_generation?task_id=${job.upstreamId}`,
	);
	const { body, response } = await fetchJsonResponse(url, {
		method: "GET",
		headers: getVideoProviderHeaders(job, providerContext),
	});

	if (!response.ok) {
		throw new Error(
			typeof body.error === "object" &&
			body.error &&
			"message" in body.error &&
			typeof body.error.message === "string"
				? body.error.message
				: `MiniMax status request failed with status ${response.status}`,
		);
	}

	const rawStatus =
		typeof body.status === "string" ? body.status : "Processing";
	const normalizedStatus =
		rawStatus === "Success"
			? "completed"
			: rawStatus === "Fail" || rawStatus === "Failed"
				? "failed"
				: "in_progress";
	const fileId =
		typeof body.file_id === "string"
			? body.file_id
			: typeof body.file_id === "number"
				? String(body.file_id)
				: null;

	return addRequestedVideoMetadata(job, {
		...body,
		status: normalizedStatus,
		progress:
			normalizedStatus === "completed"
				? 100
				: normalizedStatus === "failed"
					? 100
					: rawStatus === "Processing"
						? 50
						: 0,
		file_id: fileId,
		error:
			normalizedStatus === "failed"
				? {
						message:
							typeof body.base_resp === "object" &&
							body.base_resp &&
							"status_msg" in (body.base_resp as Record<string, unknown>)
								? String((body.base_resp as Record<string, unknown>).status_msg)
								: "MiniMax video generation failed",
					}
				: null,
	});
}

async function fetchBytedanceStatus(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
): Promise<Record<string, unknown>> {
	const url = joinUrl(
		providerContext.baseUrl,
		`/contents/generations/tasks/${job.upstreamId}`,
	);
	const { body, response } = await fetchJsonResponse(url, {
		method: "GET",
		headers: getVideoProviderHeaders(job, providerContext),
	});

	if (!response.ok) {
		throw new Error(
			typeof body.error === "object" &&
			body.error &&
			"message" in body.error &&
			typeof body.error.message === "string"
				? body.error.message
				: `ByteDance status request failed with status ${response.status}`,
		);
	}

	const data =
		body.data && typeof body.data === "object"
			? (body.data as Record<string, unknown>)
			: body;

	const rawStatus = typeof data.status === "string" ? data.status : "queued";
	const content =
		data.content && typeof data.content === "object"
			? (data.content as Record<string, unknown>)
			: null;
	const videoUrl =
		content && typeof content.video_url === "string" ? content.video_url : null;

	return addRequestedVideoMetadata(job, {
		...body,
		status: rawStatus,
		progress:
			rawStatus === "succeeded" || rawStatus === "completed"
				? 100
				: rawStatus === "failed"
					? 100
					: rawStatus === "running"
						? 50
						: 0,
		url: videoUrl,
		video_url: videoUrl,
		output_url: videoUrl,
		mime_type: videoUrl ? "video/mp4" : undefined,
		error:
			rawStatus === "failed"
				? (extractError(data) ?? {
						message: "ByteDance video generation failed",
					})
				: null,
		bytedance_raw_response: body,
	});
}

async function fetchUpstreamStatus(
	job: VideoJobRecord,
): Promise<Record<string, unknown>> {
	const providerContext = await resolveVideoProviderContext(job);

	if (job.usedProvider === "avalanche") {
		return isAvalancheSoraJob(job)
			? await fetchAvalancheSoraStatus(job, providerContext)
			: await fetchAvalancheStatus(job, providerContext);
	}

	if (isGoogleVertexVideoProvider(job.usedProvider)) {
		return await fetchGoogleVertexStatus(job, providerContext);
	}

	if (isBytedanceVideoProvider(job.usedProvider)) {
		return await fetchBytedanceStatus(job, providerContext);
	}

	if (isMinimaxVideoProvider(job.usedProvider)) {
		return await fetchMinimaxStatus(job, providerContext);
	}

	if (isAlibabaVideoProvider(job.usedProvider)) {
		return await fetchAlibabaStatus(job, providerContext);
	}

	if (isAtlasCloudVideoProvider(job.usedProvider)) {
		return await fetchAtlasCloudStatus(job, providerContext);
	}

	return await fetchGenericVideoStatus(job, providerContext);
}

async function fetchGenericVideoStatus(
	job: VideoJobRecord,
	providerContext: ResolvedVideoProviderContext,
): Promise<Record<string, unknown>> {
	const url = joinUrl(providerContext.baseUrl, `/v1/videos/${job.upstreamId}`);
	const { body, response } = await fetchJsonResponse(url, {
		method: "GET",
		headers: getVideoProviderHeaders(job, providerContext),
	});

	if (!response.ok) {
		throw new Error(
			typeof body.error === "object" &&
			body.error &&
			"message" in body.error &&
			typeof body.error.message === "string"
				? body.error.message
				: `Upstream status request failed with status ${response.status}`,
		);
	}

	return body;
}

async function fetchUpstreamContentMetadata(
	job: VideoJobRecord,
): Promise<Record<string, unknown> | null> {
	if (
		job.usedProvider === "avalanche" ||
		job.usedProvider === "xai" ||
		isGoogleVertexVideoProvider(job.usedProvider) ||
		isMinimaxVideoProvider(job.usedProvider) ||
		isAlibabaVideoProvider(job.usedProvider) ||
		isAtlasCloudVideoProvider(job.usedProvider)
	) {
		return null;
	}

	const providerContext = await resolveVideoProviderContext(job);
	const url = joinUrl(
		providerContext.baseUrl,
		`/v1/videos/${job.upstreamId}/content`,
	);
	const response = await fetchWithSignals(
		url,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${providerContext.token}`,
				Accept: "application/json",
			},
			redirect: "manual",
		},
		UPSTREAM_FETCH_TIMEOUT_MS,
	);
	const contentType = response.headers.get("Content-Type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return null;
	}
	const text = await response.text();

	if (!response.ok || text.length === 0) {
		return null;
	}

	try {
		const body = JSON.parse(text) as unknown;
		return body && typeof body === "object"
			? (body as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

async function claimDueVideoJobsForPolling(
	now: Date,
): Promise<VideoJobRecord[]> {
	return await db.transaction(async (tx) => {
		const jobsToPoll = await tx
			.select()
			.from(tables.videoJob)
			.where(
				and(
					inArray(tables.videoJob.status, [...ACTIVE_VIDEO_STATUSES]),
					lte(tables.videoJob.nextPollAt, now),
				),
			)
			.limit(25)
			.for("update", { skipLocked: true });

		if (jobsToPoll.length === 0) {
			return [];
		}

		const claimedUntil = new Date(now.getTime() + VIDEO_JOB_POLL_CLAIM_TTL_MS);
		await tx
			.update(tables.videoJob)
			.set({
				nextPollAt: claimedUntil,
			})
			.where(
				inArray(
					tables.videoJob.id,
					jobsToPoll.map((job) => job.id),
				),
			);

		return jobsToPoll.map((job) => ({
			...job,
			nextPollAt: claimedUntil,
		}));
	});
}

export async function processPendingVideoJobs(): Promise<void> {
	const now = new Date();
	const jobsToPoll = await claimDueVideoJobsForPolling(now);

	for (const job of jobsToPoll) {
		if (isStopRequested()) {
			break;
		}
		try {
			const upstreamStatus = await fetchUpstreamStatus(job);
			let enrichedUpstreamStatus = upstreamStatus;
			let status = normalizeVideoStatus(enrichedUpstreamStatus.status);
			let progress = extractProgress(enrichedUpstreamStatus);
			let contentMetadata: Record<string, unknown> | null = null;
			if (status === "completed") {
				try {
					contentMetadata = await fetchUpstreamContentMetadata(job);
				} catch (error) {
					logger.warn("Could not fetch upstream video content metadata", {
						videoJobId: job.id,
						upstreamId: job.upstreamId,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
			enrichedUpstreamStatus = contentMetadata
				? { ...enrichedUpstreamStatus, ...contentMetadata }
				: enrichedUpstreamStatus;
			status = normalizeVideoStatus(enrichedUpstreamStatus.status);
			progress = extractProgress(enrichedUpstreamStatus);
			const isTimedOut =
				!TERMINAL_VIDEO_STATUSES.has(status) && hasVideoJobTimedOut(job, now);
			if (isTimedOut) {
				enrichedUpstreamStatus = buildVideoJobTimeoutResponse(
					job,
					now,
					enrichedUpstreamStatus,
				);
				status = "failed";
				progress = 100;
			}
			const isTerminal = TERMINAL_VIDEO_STATUSES.has(status);
			const completedAt =
				parseTimestamp(enrichedUpstreamStatus.completed_at) ??
				(isTerminal ? new Date() : job.completedAt);
			const storageUri =
				extractStorageUri(enrichedUpstreamStatus) ?? job.storageUri;
			const parsedStorageUri = parseGcsUri(storageUri);

			const updatedJob = await db
				.update(tables.videoJob)
				.set({
					status,
					progress,
					error: extractError(enrichedUpstreamStatus),
					contentUrl:
						extractContentUrl(enrichedUpstreamStatus) ?? job.contentUrl,
					storageProvider:
						parsedStorageUri || job.storageProvider === "gcs"
							? "gcs"
							: job.storageProvider,
					storageBucket: parsedStorageUri?.bucket ?? job.storageBucket,
					storageObjectPath:
						parsedStorageUri?.objectPath ?? job.storageObjectPath,
					storageUri,
					storageExpiresAt:
						parsedStorageUri && !job.storageExpiresAt
							? getVideoStorageExpiryDate()
							: job.storageExpiresAt,
					contentType:
						typeof enrichedUpstreamStatus.mime_type === "string"
							? enrichedUpstreamStatus.mime_type
							: job.contentType,
					completedAt,
					expiresAt:
						parseTimestamp(enrichedUpstreamStatus.expires_at) ?? job.expiresAt,
					lastPolledAt: now,
					nextPollAt: isTerminal ? now : new Date(Date.now() + 5_000),
					pollAttemptCount: job.pollAttemptCount + 1,
					upstreamStatusResponse: {
						...enrichedUpstreamStatus,
						llmgateway_poll_error_count: 0,
						llmgateway_last_poll_error: null,
					},
				})
				.where(eq(tables.videoJob.id, job.id))
				.returning()
				.then((rows) => rows[0]);

			if (TERMINAL_VIDEO_STATUSES.has(updatedJob.status)) {
				try {
					await finalizeVideoJob(updatedJob);
				} catch (error) {
					logger.error(
						"Error finalizing video job",
						error instanceof Error ? error : new Error(String(error)),
						{
							videoJobId: updatedJob.id,
							upstreamId: updatedJob.upstreamId,
						},
					);
				}
			}
		} catch (error) {
			if (isShutdownAbort(error)) {
				logger.info("Skipping video job poll bookkeeping due to shutdown", {
					videoJobId: job.id,
					upstreamId: job.upstreamId,
				});
				break;
			}

			const message = error instanceof Error ? error.message : String(error);
			logger.error(
				"Error polling video job",
				error instanceof Error ? error : new Error(message),
				{
					videoJobId: job.id,
					upstreamId: job.upstreamId,
				},
			);

			const nextErrorCount = getVideoJobPollErrorCount(job) + 1;
			const currentStatusResponse =
				job.upstreamStatusResponse &&
				typeof job.upstreamStatusResponse === "object" &&
				!Array.isArray(job.upstreamStatusResponse)
					? (job.upstreamStatusResponse as Record<string, unknown>)
					: {};

			if (
				hasVideoJobTimedOut(job, now) ||
				nextErrorCount >= VIDEO_JOB_MAX_POLL_ERROR_COUNT
			) {
				const failedResponse = hasVideoJobTimedOut(job, now)
					? buildVideoJobTimeoutResponse(job, now, currentStatusResponse)
					: addRequestedVideoMetadata(job, {
							...currentStatusResponse,
							status: "failed",
							progress: 100,
							completed_at: now.toISOString(),
							error: {
								code: "poll_error",
								message: `Video generation failed after ${nextErrorCount} consecutive polling errors: ${message}`,
								details: {
									reason: "poll_error_limit",
									error_count: nextErrorCount,
									last_error: message,
								},
							},
							llmgateway_poll_error_count: nextErrorCount,
							llmgateway_last_poll_error: message,
						});
				const updatedJob = await db
					.update(tables.videoJob)
					.set({
						status: "failed",
						progress: 100,
						error: extractError(failedResponse),
						completedAt: now,
						lastPolledAt: now,
						nextPollAt: now,
						pollAttemptCount: job.pollAttemptCount + 1,
						upstreamStatusResponse: failedResponse,
					})
					.where(eq(tables.videoJob.id, job.id))
					.returning()
					.then((rows) => rows[0]);

				await finalizeVideoJob(updatedJob);
				continue;
			}

			await db
				.update(tables.videoJob)
				.set({
					lastPolledAt: now,
					nextPollAt: new Date(
						Date.now() + calculateNextVideoPollErrorDelayMs(nextErrorCount),
					),
					pollAttemptCount: job.pollAttemptCount + 1,
					upstreamStatusResponse: {
						...currentStatusResponse,
						llmgateway_poll_error_count: nextErrorCount,
						llmgateway_last_poll_error: message,
					},
				})
				.where(eq(tables.videoJob.id, job.id));
		}
	}

	const terminalJobsToFinalize = await db
		.select()
		.from(tables.videoJob)
		.where(
			and(
				inArray(tables.videoJob.status, TERMINAL_VIDEO_STATUS_VALUES),
				or(
					isNull(tables.videoJob.resultLoggedAt),
					and(
						eq(tables.videoJob.callbackStatus, "pending"),
						isNull(tables.videoJob.callbackEventId),
					),
				),
			),
		)
		.limit(25);

	for (const job of terminalJobsToFinalize) {
		if (isStopRequested()) {
			break;
		}
		try {
			await finalizeVideoJob(job);
		} catch (error) {
			logger.error(
				"Error finalizing terminal video job",
				error instanceof Error ? error : new Error(String(error)),
				{
					videoJobId: job.id,
					upstreamId: job.upstreamId,
				},
			);
		}
	}
}

async function markVideoCallbackFailed(videoJobId: string): Promise<void> {
	const pendingOrRetrying = await db
		.select({ id: tables.webhookDeliveryLog.id })
		.from(tables.webhookDeliveryLog)
		.where(
			and(
				eq(tables.webhookDeliveryLog.videoJobId, videoJobId),
				inArray(tables.webhookDeliveryLog.status, ["pending", "retrying"]),
			),
		)
		.limit(1);

	if (pendingOrRetrying.length === 0) {
		await db
			.update(tables.videoJob)
			.set({
				callbackStatus: "failed",
			})
			.where(eq(tables.videoJob.id, videoJobId));
	}
}

async function deliverWebhook(
	delivery: WebhookDeliveryRecord,
	job: VideoJobRecord,
): Promise<void> {
	const timestamp = Math.floor(Date.now() / 1000).toString();
	const payload = JSON.stringify({
		object: "event",
		id: delivery.eventId,
		type: delivery.eventType,
		created_at: Math.floor(Date.now() / 1000),
		data: await serializeVideoJob(job),
	});

	const headers = {
		"Content-Type": "application/json",
		"webhook-id": delivery.eventId,
		"webhook-timestamp": timestamp,
		"webhook-signature": createWebhookSignature(
			delivery.eventId,
			timestamp,
			payload,
			job.callbackSecret!,
		),
	};

	const startedAt = new Date();

	try {
		const response = await fetchWithSignals(
			delivery.targetUrl,
			{
				method: "POST",
				headers,
				body: payload,
				redirect: "manual",
			},
			WEBHOOK_DELIVERY_TIMEOUT_MS,
		);
		const responseText = (await response.text()).slice(0, 4000);

		if (response.ok) {
			await db.transaction(async (tx) => {
				await tx
					.update(tables.webhookDeliveryLog)
					.set({
						status: "delivered",
						lastTriedAt: startedAt,
						deliveredAt: new Date(),
						requestHeaders: headers,
						requestBody: JSON.parse(payload) as Record<string, unknown>,
						responseStatus: response.status,
						responseBody: responseText,
						error: null,
					})
					.where(eq(tables.webhookDeliveryLog.id, delivery.id));

				await tx
					.update(tables.videoJob)
					.set({
						callbackStatus: "delivered",
						callbackDeliveredAt: new Date(),
					})
					.where(eq(tables.videoJob.id, job.id));
			});

			return;
		}

		if (delivery.attempt >= MAX_WEBHOOK_ATTEMPTS) {
			await db
				.update(tables.webhookDeliveryLog)
				.set({
					status: "failed",
					lastTriedAt: startedAt,
					requestHeaders: headers,
					requestBody: JSON.parse(payload) as Record<string, unknown>,
					responseStatus: response.status,
					responseBody: responseText,
					error: `Unexpected webhook response status ${response.status}`,
				})
				.where(eq(tables.webhookDeliveryLog.id, delivery.id));

			await markVideoCallbackFailed(job.id);
			return;
		}

		await db.transaction(async (tx) => {
			await tx
				.update(tables.webhookDeliveryLog)
				.set({
					status: "retrying",
					lastTriedAt: startedAt,
					requestHeaders: headers,
					requestBody: JSON.parse(payload) as Record<string, unknown>,
					responseStatus: response.status,
					responseBody: responseText,
					error: `Unexpected webhook response status ${response.status}`,
				})
				.where(eq(tables.webhookDeliveryLog.id, delivery.id));

			await tx.insert(tables.webhookDeliveryLog).values({
				videoJobId: job.id,
				eventId: delivery.eventId,
				eventType: delivery.eventType,
				targetUrl: delivery.targetUrl,
				attempt: delivery.attempt + 1,
				status: "pending",
				nextRetryAt: calculateNextWebhookRetryAt(delivery.attempt),
			});
		});
	} catch (error) {
		if (isShutdownAbort(error)) {
			logger.info(
				"Skipping webhook delivery bookkeeping due to shutdown; will retry on next worker run",
				{
					videoJobId: job.id,
					deliveryId: delivery.id,
				},
			);
			return;
		}

		const message =
			error instanceof Error ? error.message : "Unknown webhook delivery error";

		if (delivery.attempt >= MAX_WEBHOOK_ATTEMPTS) {
			await db
				.update(tables.webhookDeliveryLog)
				.set({
					status: "failed",
					lastTriedAt: startedAt,
					requestHeaders: headers,
					requestBody: JSON.parse(payload) as Record<string, unknown>,
					error: message,
				})
				.where(eq(tables.webhookDeliveryLog.id, delivery.id));

			await markVideoCallbackFailed(job.id);
			return;
		}

		await db.transaction(async (tx) => {
			await tx
				.update(tables.webhookDeliveryLog)
				.set({
					status: "retrying",
					lastTriedAt: startedAt,
					requestHeaders: headers,
					requestBody: JSON.parse(payload) as Record<string, unknown>,
					error: message,
				})
				.where(eq(tables.webhookDeliveryLog.id, delivery.id));

			await tx.insert(tables.webhookDeliveryLog).values({
				videoJobId: job.id,
				eventId: delivery.eventId,
				eventType: delivery.eventType,
				targetUrl: delivery.targetUrl,
				attempt: delivery.attempt + 1,
				status: "pending",
				nextRetryAt: calculateNextWebhookRetryAt(delivery.attempt),
			});
		});
	}
}

export async function processPendingWebhookDeliveries(): Promise<void> {
	const dueDeliveries = await db
		.select()
		.from(tables.webhookDeliveryLog)
		.where(
			and(
				eq(tables.webhookDeliveryLog.status, "pending"),
				lte(tables.webhookDeliveryLog.nextRetryAt, new Date()),
			),
		)
		.limit(25);

	for (const delivery of dueDeliveries) {
		if (isStopRequested()) {
			break;
		}
		const job = await db
			.select()
			.from(tables.videoJob)
			.where(eq(tables.videoJob.id, delivery.videoJobId))
			.limit(1)
			.then((rows) => rows[0]);

		if (!job || !job.callbackUrl || !job.callbackSecret) {
			await db
				.update(tables.webhookDeliveryLog)
				.set({
					status: "failed",
					lastTriedAt: new Date(),
					error: "Video job or callback configuration no longer exists",
				})
				.where(eq(tables.webhookDeliveryLog.id, delivery.id));
			if (job) {
				await markVideoCallbackFailed(job.id);
			}
			continue;
		}

		await deliverWebhook(delivery, job);
	}
}
