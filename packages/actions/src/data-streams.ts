import { createHash, createHmac } from "node:crypto";

import { isProviderUrlGuardEnabled } from "@llmgateway/shared";
import {
	decryptProviderKey,
	encryptProviderKey,
} from "@llmgateway/shared/provider-key-crypto";
import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

import { fetchNoRedirect } from "./fetch-no-redirect.js";
import { trimSlashes } from "./trim-slashes.js";

import type {
	DataStreamConfig,
	DataStreamDestination,
	DataStreamSource,
} from "@llmgateway/db";

const DELIVERY_TIMEOUT_MS = 15_000;

/** Datadog intake sites; the fixed host list is the SSRF guard. */
export const DATADOG_SITES = [
	"datadoghq.com",
	"us3.datadoghq.com",
	"us5.datadoghq.com",
	"datadoghq.eu",
	"ap1.datadoghq.com",
	"ddog-gov.com",
] as const;

/** Credentials kept encrypted at rest; never returned by the API. */
export interface DataStreamSecret {
	/** Splunk HEC token, or an optional bearer token for webhooks. */
	token?: string;
	/** Datadog API key. */
	apiKey?: string;
	/** S3 secret access key. */
	secretAccessKey?: string;
	/** HMAC key for the webhook signature header. */
	signingSecret?: string;
}

export interface DataStreamTarget {
	id: string;
	organizationId: string;
	source: DataStreamSource;
	destination: DataStreamDestination;
	config: DataStreamConfig;
}

export type DataStreamEvent = Record<string, unknown> & {
	id: string;
	type: "audit_log" | "request_log";
	timestamp: string;
};

export function encryptDataStreamSecret(
	secret: DataStreamSecret,
	streamId: string,
	organizationId: string,
): string {
	return encryptProviderKey(JSON.stringify(secret), streamId, organizationId);
}

export function decryptDataStreamSecret(
	ciphertext: string | null,
	streamId: string,
	organizationId: string,
): DataStreamSecret {
	return ciphertext
		? (JSON.parse(
				decryptProviderKey(ciphertext, streamId, organizationId),
			) as DataStreamSecret)
		: {};
}

export interface AuditLogRow {
	id: string;
	createdAt: Date;
	organizationId: string;
	userId: string;
	action: string;
	resourceType: string;
	resourceId: string | null;
	metadata: unknown;
}

export function formatAuditEvent(row: AuditLogRow): DataStreamEvent {
	return {
		id: row.id,
		type: "audit_log",
		timestamp: row.createdAt.toISOString(),
		organizationId: row.organizationId,
		userId: row.userId,
		action: row.action,
		resourceType: row.resourceType,
		resourceId: row.resourceId,
		metadata: row.metadata ?? null,
	};
}

export interface RequestLogRow {
	id: string;
	requestId: string;
	createdAt: Date;
	organizationId: string;
	projectId: string;
	apiKeyId: string;
	requestedModel: string;
	requestedProvider: string | null;
	usedModel: string;
	usedProvider: string;
	duration: number;
	timeToFirstToken: number | null;
	promptTokens: string | null;
	completionTokens: string | null;
	totalTokens: string | null;
	reasoningTokens: string | null;
	cachedTokens: string | null;
	cost: number | null;
	finishReason: string | null;
	unifiedFinishReason: string | null;
	hasError: boolean | null;
	errorCategory: string | null;
	cached: boolean | null;
	streamed: boolean | null;
	source: string | null;
	apiOrigin: string | null;
	sessionId: string | null;
	messages: unknown;
	content: string | null;
}

function toNumber(value: string | number | null): number | null {
	return value === null ? null : Number(value);
}

/**
 * One request as an export event. Prompt and completion text are included
 * only when the stream opts in, and are null once retention cleared them.
 */
export function formatRequestLogEvent(
	row: RequestLogRow,
	includePayloads: boolean,
): DataStreamEvent {
	return {
		id: row.id,
		type: "request_log",
		timestamp: row.createdAt.toISOString(),
		requestId: row.requestId,
		organizationId: row.organizationId,
		projectId: row.projectId,
		apiKeyId: row.apiKeyId,
		requestedModel: row.requestedModel,
		requestedProvider: row.requestedProvider,
		usedModel: row.usedModel,
		usedProvider: row.usedProvider,
		durationMs: row.duration,
		timeToFirstTokenMs: row.timeToFirstToken,
		promptTokens: toNumber(row.promptTokens),
		completionTokens: toNumber(row.completionTokens),
		totalTokens: toNumber(row.totalTokens),
		reasoningTokens: toNumber(row.reasoningTokens),
		cachedTokens: toNumber(row.cachedTokens),
		cost: row.cost,
		finishReason: row.finishReason,
		unifiedFinishReason: row.unifiedFinishReason,
		hasError: row.hasError ?? false,
		errorCategory: row.errorCategory,
		cached: row.cached ?? false,
		streamed: row.streamed ?? false,
		source: row.source,
		apiOrigin: row.apiOrigin,
		sessionId: row.sessionId,
		...(includePayloads
			? { messages: row.messages ?? null, content: row.content }
			: {}),
	};
}

export class DataStreamConfigError extends Error {}

/** Validates destination settings at create/update time. */
export function validateDataStreamConfig(
	destination: DataStreamDestination,
	config: DataStreamConfig,
	secret: DataStreamSecret,
): void {
	const require = (value: unknown, message: string) => {
		if (!value) {
			throw new DataStreamConfigError(message);
		}
	};
	switch (destination) {
		case "webhook":
			require(config.url, "Webhook URL is required");
			require(secret.signingSecret, "Signing secret is required");
			break;
		case "splunk":
			require(config.url, "Splunk HEC URL is required");
			require(secret.token, "Splunk HEC token is required");
			break;
		case "datadog":
			if (
				!config.site ||
				!DATADOG_SITES.includes(config.site as (typeof DATADOG_SITES)[number])
			) {
				throw new DataStreamConfigError("Unsupported Datadog site");
			}
			require(secret.apiKey, "Datadog API key is required");
			break;
		case "s3":
			require(config.bucket, "Bucket is required");
			require(config.region, "Region is required");
			require(config.accessKeyId, "Access key ID is required");
			require(secret.secretAccessKey, "Secret access key is required");
			if (
				config.bucket &&
				!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)
			) {
				throw new DataStreamConfigError("Invalid bucket name");
			}
			if (config.region && !/^[a-z0-9-]{2,32}$/.test(config.region)) {
				throw new DataStreamConfigError("Invalid region");
			}
			break;
	}
	if (isProviderUrlGuardEnabled()) {
		if (config.url && !config.url.startsWith("https://")) {
			throw new DataStreamConfigError("Destination URL must use https");
		}
		if (config.endpoint && !config.endpoint.startsWith("https://")) {
			throw new DataStreamConfigError("Endpoint must use https");
		}
	}
}

async function send(url: string, init: RequestInit): Promise<void> {
	const requestInit = {
		...init,
		signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
	};
	const res = isProviderUrlGuardEnabled()
		? await fetchSafeUserUrl(url, requestInit)
		: await fetchNoRedirect(url, requestInit);
	if (!res.ok) {
		const text = (await res.text()).slice(0, 300);
		throw new Error(`Destination responded ${res.status}: ${text}`);
	}
}

/** `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`, same as platform webhooks. */
export function signDataStreamPayload(
	body: string,
	signingSecret: string,
	timestamp: number,
): string {
	const v1 = createHmac("sha256", signingSecret)
		.update(`${timestamp}.${body}`)
		.digest("hex");
	return `t=${timestamp},v1=${v1}`;
}

function sha256Hex(data: string | Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
	return createHmac("sha256", key).update(data).digest();
}

/** Builds an AWS Signature V4 PUT for one S3 object. */
export function buildS3PutRequest(
	config: DataStreamConfig,
	secretAccessKey: string,
	key: string,
	body: string,
	now: Date,
): { url: string; headers: Record<string, string> } {
	const region = config.region!;
	const bucket = config.bucket!;
	const endpoint = config.endpoint
		? new URL(config.endpoint)
		: new URL(`https://${bucket}.s3.${region}.amazonaws.com`);
	const encodedKey = key
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const path = config.endpoint
		? `${trimSlashes(endpoint.pathname, { end: true })}/${bucket}/${encodedKey}`
		: `/${encodedKey}`;
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
	const date = amzDate.slice(0, 8);
	const payloadHash = sha256Hex(body);
	const headers: Record<string, string> = {
		host: endpoint.host,
		"content-type": "application/x-ndjson",
		"x-amz-content-sha256": payloadHash,
		"x-amz-date": amzDate,
	};
	const signedHeaders = Object.keys(headers).sort().join(";");
	const canonicalHeaders = Object.keys(headers)
		.sort()
		.map((name) => `${name}:${headers[name]}\n`)
		.join("");
	const canonicalRequest = [
		"PUT",
		path,
		"",
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");
	const scope = `${date}/${region}/s3/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex(canonicalRequest),
	].join("\n");
	const signingKey = hmac(
		hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), "s3"),
		"aws4_request",
	);
	const signature = createHmac("sha256", signingKey)
		.update(stringToSign)
		.digest("hex");
	const { host: _host, ...sendHeaders } = headers;
	return {
		url: `${endpoint.protocol}//${endpoint.host}${path}`,
		headers: {
			...sendHeaders,
			Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
		},
	};
}

function s3ObjectKey(
	stream: DataStreamTarget,
	events: DataStreamEvent[],
	now: Date,
): string {
	const prefix = trimSlashes(stream.config.prefix ?? "llmgateway");
	const day = now.toISOString().slice(0, 10);
	const first = events[0]?.id ?? "empty";
	return `${prefix}/${stream.source}/${day}/${now.getTime()}-${first}.ndjson`;
}

/** Delivers one batch. Throws on any failure so the caller keeps its cursor. */
/** Datadog caps a request at 5 MB and one log at 1 MB; Splunk HEC defaults are similar. */
export const DATA_STREAM_MAX_REQUEST_BYTES = 4_000_000;
export const DATA_STREAM_MAX_EVENT_BYTES = 900_000;

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

/**
 * Replaces an oversized event's prompt and completion with a marker so a
 * single huge request log can never block the stream.
 */
export function capDataStreamEvent(
	event: DataStreamEvent,
	maxBytes: number = DATA_STREAM_MAX_EVENT_BYTES,
): DataStreamEvent {
	if (byteLength(JSON.stringify(event)) <= maxBytes) {
		return event;
	}
	const { messages: _messages, content: _content, metadata, ...rest } = event;
	const capped: DataStreamEvent = { ...rest, truncated: true };
	if (
		metadata !== undefined &&
		byteLength(JSON.stringify(metadata)) < maxBytes / 2
	) {
		capped.metadata = metadata;
	}
	return capped;
}

/** Splits events into chunks whose serialized size stays under `maxBytes`. */
export function chunkDataStreamEvents(
	events: DataStreamEvent[],
	maxBytes: number = DATA_STREAM_MAX_REQUEST_BYTES,
): DataStreamEvent[][] {
	const chunks: DataStreamEvent[][] = [];
	let current: DataStreamEvent[] = [];
	let size = 0;
	for (const event of events) {
		const eventBytes = byteLength(JSON.stringify(event)) + 256;
		if (current.length > 0 && size + eventBytes > maxBytes) {
			chunks.push(current);
			current = [];
			size = 0;
		}
		current.push(event);
		size += eventBytes;
	}
	if (current.length > 0) {
		chunks.push(current);
	}
	return chunks;
}

/**
 * Delivers one batch. Request-based destinations get it in size-bounded
 * chunks; S3 takes the whole batch as one object. Throws on the first failed
 * chunk so the caller keeps its cursor (earlier chunks may be re-sent).
 */
export async function deliverDataStreamBatch(
	stream: DataStreamTarget,
	secret: DataStreamSecret,
	events: DataStreamEvent[],
	now: Date = new Date(),
): Promise<void> {
	if (events.length === 0) {
		return;
	}
	if (stream.destination === "s3") {
		await deliverChunk(stream, secret, events, now);
		return;
	}
	const capped = events.map((event) => capDataStreamEvent(event));
	for (const chunk of chunkDataStreamEvents(capped)) {
		await deliverChunk(stream, secret, chunk, now);
	}
}

async function deliverChunk(
	stream: DataStreamTarget,
	secret: DataStreamSecret,
	events: DataStreamEvent[],
	now: Date,
): Promise<void> {
	switch (stream.destination) {
		case "webhook": {
			const body = JSON.stringify({
				stream: stream.id,
				source: stream.source,
				events,
			});
			await send(stream.config.url!, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-LLMGateway-Signature": signDataStreamPayload(
						body,
						secret.signingSecret ?? "",
						Math.floor(now.getTime() / 1000),
					),
					...(secret.token ? { Authorization: `Bearer ${secret.token}` } : {}),
				},
				body,
			});
			return;
		}
		case "splunk": {
			const base = trimSlashes(stream.config.url!, { end: true });
			const url = base.endsWith("/services/collector/event")
				? base
				: `${base}/services/collector/event`;
			const body = events
				.map((event) =>
					JSON.stringify({
						time: Date.parse(event.timestamp) / 1000,
						source: "llmgateway",
						sourcetype: stream.config.sourcetype ?? `llmgateway:${event.type}`,
						...(stream.config.index ? { index: stream.config.index } : {}),
						event,
					}),
				)
				.join("\n");
			await send(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Splunk ${secret.token}`,
				},
				body,
			});
			return;
		}
		case "datadog": {
			const res = await fetchNoRedirect(
				`https://http-intake.logs.${stream.config.site}/api/v2/logs`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"DD-API-KEY": secret.apiKey ?? "",
					},
					body: JSON.stringify(
						events.map((event) => ({
							ddsource: "llmgateway",
							service: stream.config.service ?? "llmgateway",
							ddtags: `source:${stream.source}`,
							message: JSON.stringify(event),
						})),
					),
					signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
				},
			);
			if (!res.ok) {
				throw new Error(
					`Datadog responded ${res.status}: ${(await res.text()).slice(0, 300)}`,
				);
			}
			return;
		}
		case "s3": {
			const body = events.map((event) => JSON.stringify(event)).join("\n");
			const request = buildS3PutRequest(
				stream.config,
				secret.secretAccessKey ?? "",
				s3ObjectKey(stream, events, now),
				body,
				now,
			);
			if (stream.config.endpoint) {
				await send(request.url, {
					method: "PUT",
					headers: request.headers,
					body,
				});
				return;
			}
			const res = await fetchNoRedirect(request.url, {
				method: "PUT",
				headers: request.headers,
				body,
				signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
			});
			if (!res.ok) {
				throw new Error(
					`S3 responded ${res.status}: ${(await res.text()).slice(0, 300)}`,
				);
			}
		}
	}
}

/** A synthetic event used by the dashboard's "Send test event" action. */
export function buildDataStreamTestEvent(
	stream: DataStreamTarget,
): DataStreamEvent {
	return {
		id: `test-${Date.now()}`,
		type: stream.source === "audit_logs" ? "audit_log" : "request_log",
		timestamp: new Date().toISOString(),
		organizationId: stream.organizationId,
		test: true,
		message: "LLM Gateway data stream test event",
	};
}
