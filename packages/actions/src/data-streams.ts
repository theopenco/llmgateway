import { createHmac } from "node:crypto";

import { isProviderUrlGuardEnabled } from "@llmgateway/shared";
import {
	decryptProviderKey,
	encryptProviderKey,
} from "@llmgateway/shared/provider-key-crypto";
import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

import { fetchNoRedirect } from "./fetch-no-redirect.js";

import type {
	DataStreamConfig,
	DataStreamDestination,
	DataStreamSource,
} from "@llmgateway/db";

const DELIVERY_TIMEOUT_MS = 15_000;

/** Credentials kept encrypted at rest; never returned by the API. */
export interface DataStreamSecret {
	/** HMAC key for the webhook signature header. */
	signingSecret?: string;
	/** Optional bearer token sent in the Authorization header. */
	token?: string;
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

/**
 * The request-log columns a stream may read. Prompts, completions, and tool
 * payloads are deliberately absent: exports only ever carry metadata.
 */
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
}

function toNumber(value: string | number | null): number | null {
	return value === null ? null : Number(value);
}

export function formatRequestLogEvent(row: RequestLogRow): DataStreamEvent {
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
	};
}

export class DataStreamConfigError extends Error {}

/** Validates destination settings before a stream is saved. */
export function validateDataStreamConfig(
	destination: DataStreamDestination,
	config: DataStreamConfig,
	secret: DataStreamSecret,
): void {
	if (destination !== "webhook") {
		throw new DataStreamConfigError("Unsupported destination");
	}
	if (!config.url) {
		throw new DataStreamConfigError("Webhook URL is required");
	}
	if (isProviderUrlGuardEnabled() && !config.url.startsWith("https://")) {
		throw new DataStreamConfigError("Webhook URL must use https");
	}
	if (!secret.signingSecret || secret.signingSecret.length < 16) {
		throw new DataStreamConfigError(
			"Signing secret must be at least 16 characters",
		);
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

/** Response statuses a destination uses to reject a batch for good. */
export function isPermanentDeliveryStatus(status: number): boolean {
	return (
		status === 400 ||
		status === 401 ||
		status === 403 ||
		status === 404 ||
		status === 405 ||
		status === 410 ||
		status === 413 ||
		status === 422
	);
}

export class DataStreamDeliveryError extends Error {
	public constructor(
		message: string,
		public readonly status: number | null,
	) {
		super(message);
	}

	public get permanent(): boolean {
		return this.status !== null && isPermanentDeliveryStatus(this.status);
	}
}

/**
 * Delivers one batch as a single signed POST. Throws on any failure so the
 * caller keeps its cursor.
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
	const body = JSON.stringify({
		stream: stream.id,
		source: stream.source,
		events,
	});
	const init: RequestInit = {
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
		signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
	};
	const url = stream.config.url!;
	const res = isProviderUrlGuardEnabled()
		? await fetchSafeUserUrl(url, init)
		: await fetchNoRedirect(url, init);
	if (!res.ok) {
		const text = (await res.text()).slice(0, 300);
		throw new DataStreamDeliveryError(
			`Destination responded ${res.status}: ${text}`,
			res.status,
		);
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
