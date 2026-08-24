import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { promisify } from "node:util";
import { zstdCompress, zstdDecompress } from "node:zlib";

import {
	CreateBucketCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

const zstdCompressAsync = promisify(zstdCompress);
const zstdDecompressAsync = promisify(zstdDecompress);

/**
 * Log columns whose values are offloaded to object storage when payload
 * storage is enabled. The PG columns keep truncated previews (or null) so
 * list views work without touching the blob; the detail view hydrates the
 * full payload from storage via `payloadRef`.
 *
 * `responsesApiData` is deliberately NOT offloaded: the gateway no longer
 * writes it (Responses API state lives in its own storage since #3279) and
 * the legacy fallbacks in response-state.ts still read it from PG.
 * `userAgent`/`customHeaders`/`gatewayContentFilterResponse` stay in PG
 * (small, and served in list responses).
 */
export const PAYLOAD_FIELDS = [
	"messages",
	"content",
	"reasoningContent",
	"tools",
	"toolChoice",
	"toolResults",
	"rawRequest",
	"rawResponse",
	"upstreamRequest",
	"upstreamResponse",
] as const;

export type PayloadField = (typeof PAYLOAD_FIELDS)[number];

const CONTENT_PREVIEW_MAX_CHARS = 2000;
const MESSAGE_CONTENT_PREVIEW_MAX_CHARS = 1000;
const MESSAGES_PREVIEW_MAX_BYTES = 100 * 1024;
const MESSAGES_PREVIEW_HEAD_COUNT = 2;
const MESSAGES_PREVIEW_TAIL_COUNT = 10;
const GENERATED_IMAGE_PLACEHOLDER = "[image_generated]";
const OMITTED_PART_PLACEHOLDER = "[omitted]";

// The SDK leaves every timeout at 0 (disabled) by default, so a hung object
// store would stall a log detail request or a whole worker log batch forever
// instead of failing into their existing fallback paths.
const CONNECTION_TIMEOUT_MS = 3_000;
// Idle timeout: catches a connection that stops delivering bytes.
const SOCKET_TIMEOUT_MS = 10_000;
// Absolute ceiling per attempt. Generous enough that a large multi-MB blob
// still transfers, since this bounds total time rather than idle time.
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

// One keep-alive pool shared by every payload storage client, so rebuilding
// the client below (tests toggle the env) reuses sockets instead of churning
// them. The SDK builds its node:http handler around these.
const httpAgent = new HttpAgent({ keepAlive: true });
const httpsAgent = new HttpsAgent({ keepAlive: true });

let payloadStorageClient: S3Client | null = null;
let payloadStorageClientKey = "";

export function isPayloadStorageEnabled(): boolean {
	return !!process.env.PAYLOAD_STORAGE_S3_BUCKET?.trim();
}

function getPayloadStorageBucket(): string {
	const bucket = process.env.PAYLOAD_STORAGE_S3_BUCKET?.trim();
	if (!bucket) {
		throw new Error("PAYLOAD_STORAGE_S3_BUCKET is not configured");
	}
	return bucket;
}

export function getPayloadStorageClient(): S3Client {
	const endpoint = process.env.PAYLOAD_STORAGE_S3_ENDPOINT?.trim();
	const region = process.env.PAYLOAD_STORAGE_S3_REGION?.trim() || "us-east-1";
	const accessKeyId = process.env.PAYLOAD_STORAGE_S3_ACCESS_KEY_ID?.trim();
	const secretAccessKey =
		process.env.PAYLOAD_STORAGE_S3_SECRET_ACCESS_KEY?.trim();
	// MinIO requires path-style addressing; GCS's S3 interop supports it too.
	const forcePathStyle =
		process.env.PAYLOAD_STORAGE_S3_FORCE_PATH_STYLE?.trim() !== "false";

	// Tests toggle the env between modes, so rebuild the singleton whenever the
	// effective connection settings change.
	const clientKey = [
		endpoint,
		region,
		accessKeyId,
		secretAccessKey,
		forcePathStyle,
	].join("\n");
	if (!payloadStorageClient || payloadStorageClientKey !== clientKey) {
		payloadStorageClient = new S3Client({
			...(endpoint ? { endpoint } : {}),
			region,
			forcePathStyle,
			requestHandler: {
				httpAgent,
				httpsAgent,
				connectionTimeout: CONNECTION_TIMEOUT_MS,
				socketTimeout: SOCKET_TIMEOUT_MS,
				requestTimeout: REQUEST_TIMEOUT_MS,
				// Without this, a breached requestTimeout only logs a warning and
				// the request keeps running — it does not abort.
				throwOnRequestTimeout: true,
			},
			maxAttempts: MAX_ATTEMPTS,
			...(accessKeyId && secretAccessKey
				? { credentials: { accessKeyId, secretAccessKey } }
				: {}),
		});
		payloadStorageClientKey = clientKey;
	}

	return payloadStorageClient;
}

export function buildPayloadKey(
	organizationId: string,
	projectId: string,
	logId: string,
): string {
	const prefix = process.env.PAYLOAD_STORAGE_S3_PREFIX?.trim() ?? "";
	return `${prefix}logs/${organizationId}/${projectId}/${logId}.json.zst`;
}

/**
 * Create the configured bucket when it doesn't exist yet. Test/bootstrap
 * helper — production buckets are provisioned out-of-band (compose
 * minio-init, gcloud) together with their lifecycle rules.
 */
export async function ensurePayloadStorageBucket(): Promise<void> {
	if (!isPayloadStorageEnabled()) {
		return;
	}
	try {
		await getPayloadStorageClient().send(
			new CreateBucketCommand({ Bucket: getPayloadStorageBucket() }),
		);
	} catch (error) {
		if (
			error instanceof Error &&
			(error.name === "BucketAlreadyOwnedByYou" ||
				error.name === "BucketAlreadyExists")
		) {
			return;
		}
		throw error;
	}
}

/**
 * Upload a payload blob. Throws on failure so callers can route the whole
 * batch through their retry/requeue path — a log row must never be inserted
 * with a dangling payloadRef. Returns the object key.
 */
export async function putLogPayload(
	key: string,
	payload: Record<string, unknown>,
): Promise<string> {
	const compressed = await zstdCompressAsync(
		Buffer.from(JSON.stringify(payload)),
	);
	await getPayloadStorageClient().send(
		new PutObjectCommand({
			Bucket: getPayloadStorageBucket(),
			Key: key,
			Body: compressed,
			ContentType: "application/zstd",
		}),
	);
	return key;
}

/**
 * Fetch and decompress a payload blob. Returns null when payload storage is
 * disabled or the object no longer exists (e.g. deleted by the bucket
 * lifecycle rule before the PG row aged out) — callers degrade to the stored
 * previews rather than failing.
 */
export async function getLogPayload(
	payloadRef: string,
): Promise<Record<string, unknown> | null> {
	if (!isPayloadStorageEnabled()) {
		return null;
	}

	let body;
	try {
		const result = await getPayloadStorageClient().send(
			new GetObjectCommand({
				Bucket: getPayloadStorageBucket(),
				Key: payloadRef,
			}),
		);
		body = result.Body;
	} catch (error) {
		if (
			error instanceof Error &&
			(error.name === "NoSuchKey" || error.name === "NotFound")
		) {
			return null;
		}
		throw error;
	}

	if (!body) {
		return null;
	}

	const compressed = Buffer.from(await body.transformToByteArray());
	const decompressed = await zstdDecompressAsync(compressed);
	return JSON.parse(decompressed.toString()) as Record<string, unknown>;
}

function truncateString(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, maxChars)}… [truncated]`;
}

function previewContentString(value: unknown): unknown {
	if (typeof value !== "string") {
		return value ?? null;
	}
	if (value.includes(";base64,")) {
		return GENERATED_IMAGE_PLACEHOLDER;
	}
	return truncateString(value, CONTENT_PREVIEW_MAX_CHARS);
}

function isBase64ImagePart(part: Record<string, unknown>): boolean {
	const serialized = JSON.stringify(part);
	return serialized.includes(";base64,") || serialized.length > 10_000;
}

function previewMessagePart(part: unknown): unknown {
	if (typeof part === "string") {
		return truncateString(part, MESSAGE_CONTENT_PREVIEW_MAX_CHARS);
	}
	if (!part || typeof part !== "object") {
		return part;
	}
	const record = part as Record<string, unknown>;
	if (isBase64ImagePart(record)) {
		return { type: record.type ?? "image", content: OMITTED_PART_PLACEHOLDER };
	}
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		out[key] =
			typeof value === "string"
				? truncateString(value, MESSAGE_CONTENT_PREVIEW_MAX_CHARS)
				: value;
	}
	return out;
}

function previewMessage(message: unknown): unknown {
	if (!message || typeof message !== "object") {
		return message;
	}
	const record = message as Record<string, unknown>;
	const out: Record<string, unknown> = { ...record };
	if (typeof record.content === "string") {
		out.content = truncateString(
			record.content,
			MESSAGE_CONTENT_PREVIEW_MAX_CHARS,
		);
	} else if (Array.isArray(record.content)) {
		out.content = record.content.map((part) => previewMessagePart(part));
	}
	if (Array.isArray(record.tool_calls)) {
		out.tool_calls = record.tool_calls.map((call) => previewMessagePart(call));
	}
	return out;
}

function previewMessages(messages: unknown): unknown {
	if (messages === null || messages === undefined) {
		return null;
	}
	if (!Array.isArray(messages)) {
		return previewMessagePart(messages);
	}

	let preview = messages.map((message) => previewMessage(message));

	// Long agent conversations can exceed the preview budget even with
	// per-message truncation; keep the head (system prompt + first user turn)
	// and the most recent tail, which is what the log-card UI actually renders.
	if (
		preview.length >
			MESSAGES_PREVIEW_HEAD_COUNT + MESSAGES_PREVIEW_TAIL_COUNT &&
		Buffer.byteLength(JSON.stringify(preview)) > MESSAGES_PREVIEW_MAX_BYTES
	) {
		const omittedCount =
			preview.length -
			MESSAGES_PREVIEW_HEAD_COUNT -
			MESSAGES_PREVIEW_TAIL_COUNT;
		preview = [
			...preview.slice(0, MESSAGES_PREVIEW_HEAD_COUNT),
			{
				role: "system",
				content: `[${omittedCount} messages truncated]`,
			},
			...preview.slice(-MESSAGES_PREVIEW_TAIL_COUNT),
		];
	}

	return preview;
}

function previewTools(toolDefinitions: unknown): unknown {
	if (!Array.isArray(toolDefinitions)) {
		return toolDefinitions === undefined ? null : toolDefinitions;
	}
	// Keep tool identity for the list UI but drop the parameter schemas, which
	// dominate the byte size of tool-heavy agent requests.
	return toolDefinitions.map((tool) => {
		if (!tool || typeof tool !== "object") {
			return tool;
		}
		const record = tool as Record<string, unknown>;
		const fn =
			record.function && typeof record.function === "object"
				? (record.function as Record<string, unknown>)
				: null;
		return {
			...(record.type !== undefined ? { type: record.type } : {}),
			...(fn
				? {
						function: {
							...(fn.name !== undefined ? { name: fn.name } : {}),
							...(fn.description !== undefined
								? { description: fn.description }
								: {}),
						},
					}
				: {}),
		};
	});
}

export interface SplitLogPayloadResult {
	/** Full original values of every set payload field; stored as the blob. */
	payload: Record<string, unknown>;
	/** Truncated stand-ins for the PG columns; null for detail-only fields. */
	previewColumns: Record<string, unknown>;
}

/**
 * Whether any payload field carries data worth offloading. Rows stripped by
 * the gateway for non-retaining orgs (all payload fields null) skip the blob
 * entirely.
 */
export function hasLogPayload(logData: Record<string, unknown>): boolean {
	return PAYLOAD_FIELDS.some(
		(field) => logData[field] !== null && logData[field] !== undefined,
	);
}

/**
 * Split a log row into the blob payload (full original values) and the
 * preview columns that replace them in Postgres.
 */
export function splitLogPayload(
	logData: Record<string, unknown>,
): SplitLogPayloadResult {
	const payload: Record<string, unknown> = {};
	for (const field of PAYLOAD_FIELDS) {
		if (logData[field] !== null && logData[field] !== undefined) {
			payload[field] = logData[field];
		}
	}

	const previewColumns: Record<string, unknown> = {
		messages: previewMessages(logData.messages),
		content: previewContentString(logData.content),
		reasoningContent: previewContentString(logData.reasoningContent),
		tools: previewTools(logData.tools),
		// Small and rendered in the detail header even before hydration.
		toolChoice: logData.toolChoice ?? null,
		// Detail-only fields: hydrated from the blob, nothing rendered in lists.
		toolResults: null,
		rawRequest: null,
		rawResponse: null,
		upstreamRequest: null,
		upstreamResponse: null,
	};

	return { payload, previewColumns };
}

/**
 * Map with a fixed concurrency limit. Rejects with the first error after all
 * in-flight items settle, so a failed batch never leaves dangling uploads
 * running against a torn-down client.
 */
export async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	let firstError: unknown = null;

	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		async () => {
			for (;;) {
				const index = nextIndex++;
				if (index >= items.length || firstError !== null) {
					return;
				}
				try {
					results[index] = await fn(items[index], index);
				} catch (error) {
					firstError ??= error;
					return;
				}
			}
		},
	);

	await Promise.all(workers);

	if (firstError !== null) {
		throw firstError instanceof Error
			? firstError
			: new Error(String(firstError));
	}

	return results;
}
