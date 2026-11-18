import { createHash } from "node:crypto";

import { trackPendingWork } from "@/lib/pending-work.js";

import { db, shortid, tables } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";
import {
	FLAGGED_PAYLOAD_GROUPS,
	FLAGGED_PAYLOAD_ZDR_GROUPS,
	getFlaggedPayloadExpiry,
	MAX_FLAGGED_PAYLOAD_BYTES,
	type FlaggedPayload,
	type FlaggedPayloadMessage,
	type FlaggedPayloadPart,
} from "@llmgateway/shared/flagged-payload";
import { encryptFlaggedPayload } from "@llmgateway/shared/flagged-payload-crypto";

import type { GatewayContentFilterContext } from "./openai-content-filter.js";
import type { TieredContentFilterPlan } from "./tiered-content-filter.js";
import type { GatewayContentFilterEvaluation } from "@llmgateway/db";
import type { BaseMessage, MessageContent } from "@llmgateway/models";
import type { ContentFilterBlockGroup } from "@llmgateway/shared";

export type FlaggedPayloadEndpoint = "chat" | "speech" | "videos";

/** Where the filtered request came from; recorded with a preserved payload. */
export interface FlaggedPayloadOrigin {
	endpoint: FlaggedPayloadEndpoint;
	model: string | null;
	/** An org or key zero-data-retention policy is active for the request. */
	zeroDataRetention: boolean;
}

const MAX_URL_LENGTH = 2048;

/**
 * Groups of a deciding verdict whose payload is preserved: `csam` and `sexual`
 * matches, or only `csam` under zero data retention, where adult content is no
 * legal-preservation case. Blocked or not, every organization kind.
 */
export function getPreservedFlaggedGroups(
	plan: Pick<TieredContentFilterPlan, "preserveFlaggedPayloads">,
	evaluation: Pick<
		GatewayContentFilterEvaluation,
		"violation" | "matchedGroups"
	>,
	zeroDataRetention: boolean,
): ContentFilterBlockGroup[] {
	if (!plan.preserveFlaggedPayloads || !evaluation.violation) {
		return [];
	}
	const preserved: readonly ContentFilterBlockGroup[] = zeroDataRetention
		? FLAGGED_PAYLOAD_ZDR_GROUPS
		: FLAGGED_PAYLOAD_GROUPS;
	return (evaluation.matchedGroups ?? []).filter((group) =>
		preserved.includes(group),
	);
}

function sha256(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Hash and size of a base64 payload; the bytes themselves are discarded. */
function describeBase64(data: string): { sha256: string; bytes: number } {
	const bytes = Buffer.from(data, "base64");
	return { sha256: sha256(bytes), bytes: bytes.length };
}

const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*),/;

function describeImageUrl(url: string): FlaggedPayloadPart {
	const match = DATA_URL.exec(url);
	if (!match) {
		return { type: "image", url: url.slice(0, MAX_URL_LENGTH) };
	}
	const body = url.slice(match[0].length);
	// A percent-encoded (non-base64) data URL is hashed as sent.
	const bytes = match[2].includes(";base64")
		? Buffer.from(body, "base64")
		: Buffer.from(body, "utf8");
	return {
		type: "image",
		sha256: sha256(bytes),
		bytes: bytes.length,
		...(match[1] ? { mimeType: match[1] } : {}),
	};
}

function describePart(part: MessageContent): FlaggedPayloadPart {
	switch (part.type) {
		case "text":
			return { type: "text", text: part.text };
		case "image_url":
			return describeImageUrl(part.image_url.url);
		case "image":
			return {
				type: "image",
				mimeType: part.source.media_type,
				...describeBase64(part.source.data),
			};
		case "input_audio":
			return {
				type: "audio",
				mimeType: `audio/${part.input_audio.format}`,
				...describeBase64(part.input_audio.data),
			};
		case "file":
			return {
				type: "file",
				...(part.file.filename ? { filename: part.file.filename } : {}),
				...(part.file.file_id ? { fileId: part.file.file_id } : {}),
				...(part.file.file_data
					? describeImageUrlBytes(part.file.file_data)
					: {}),
			};
		case "tool_use":
			return { type: "tool_use", name: part.name, input: part.input };
		case "tool_result":
			return { type: "tool_result", content: part.content };
		default:
			return {
				type: "other",
				originalType: String((part as { type: unknown }).type),
			};
	}
}

/** File data arrives as a data URL or bare base64. */
function describeImageUrlBytes(data: string) {
	const described = describeImageUrl(
		DATA_URL.test(data) ? data : `data:;base64,${data}`,
	);
	return described.type === "image"
		? {
				sha256: described.sha256,
				bytes: described.bytes,
				...(described.mimeType ? { mimeType: described.mimeType } : {}),
			}
		: {};
}

function describeMessage(message: BaseMessage): FlaggedPayloadMessage {
	return {
		role: message.role,
		...(message.name ? { name: message.name } : {}),
		content:
			typeof message.content === "string"
				? message.content
				: (message.content ?? []).map(describePart),
		...(message.tool_calls?.length
			? {
					toolCalls: message.tool_calls.map((call) => ({
						name: call.function.name,
						arguments: call.function.arguments,
					})),
				}
			: {}),
	};
}

function countImages(messages: FlaggedPayloadMessage[]): number {
	let count = 0;
	for (const message of messages) {
		if (typeof message.content !== "string") {
			count += message.content.filter((part) => part.type === "image").length;
		}
	}
	return count;
}

/**
 * The stored form of a moderated request: text, tool calls and tool results
 * verbatim; images, audio and files as SHA-256, MIME type and size only. Over
 * {@link MAX_FLAGGED_PAYLOAD_BYTES}, the oldest messages are dropped so the
 * latest turn survives; a single oversized message is cut at the byte cap.
 */
export function buildFlaggedPayload(
	messages: BaseMessage[],
	maxBytes = MAX_FLAGGED_PAYLOAD_BYTES,
): { json: string; bytes: number; truncated: boolean; imageCount: number } {
	const described = messages.map(describeMessage);
	const sizes = described.map(
		(message) => Buffer.byteLength(JSON.stringify(message)) + 1,
	);
	let kept = 0;
	let total = 0;
	for (let i = described.length - 1; i >= 0; i--) {
		if (kept > 0 && total + sizes[i] > maxBytes) {
			break;
		}
		total += sizes[i];
		kept++;
	}
	const payload: FlaggedPayload = {
		version: 1,
		messages: described.slice(described.length - kept),
		droppedMessages: described.length - kept,
	};
	let json = JSON.stringify(payload);
	let truncated = payload.droppedMessages > 0;
	if (Buffer.byteLength(json) > maxBytes) {
		// One message alone exceeds the cap: keep its leading bytes as text.
		json = JSON.stringify({
			...payload,
			messages: [
				{
					role: payload.messages[0]?.role ?? "user",
					content: Buffer.from(JSON.stringify(payload.messages[0]))
						.subarray(0, maxBytes)
						.toString("utf8"),
				},
			],
		} satisfies FlaggedPayload);
		truncated = true;
	}
	return {
		json,
		bytes: Buffer.byteLength(json),
		truncated,
		imageCount: countImages(payload.messages),
	};
}

export interface StoreFlaggedPayloadOptions {
	plan: TieredContentFilterPlan;
	evaluation: GatewayContentFilterEvaluation;
	messages: BaseMessage[];
	context: GatewayContentFilterContext;
	origin: FlaggedPayloadOrigin;
	groups: ContentFilterBlockGroup[];
	now?: Date;
}

export async function storeFlaggedPayload(
	options: StoreFlaggedPayloadOptions,
): Promise<string> {
	const { plan, evaluation, context, origin } = options;
	const now = options.now ?? new Date();
	const id = shortid();
	const payload = buildFlaggedPayload(options.messages);
	await db.insert(tables.contentFilterFlaggedPayload).values({
		id,
		createdAt: now,
		requestId: context.requestId,
		organizationId: context.organizationId,
		projectId: context.projectId,
		apiKeyId: context.apiKeyId,
		endpoint: origin.endpoint,
		provider: plan.provider,
		model: origin.model,
		classifier: plan.classifier,
		tier: plan.tier,
		level: plan.level,
		action: evaluation.action === "blocked" ? "blocked" : "logged",
		matchedGroups: options.groups,
		matchedCategories: evaluation.matchedCategories ?? [],
		categoryScores: evaluation.categoryScores ?? {},
		payloadCiphertext: encryptFlaggedPayload(
			payload.json,
			id,
			context.organizationId,
		),
		payloadBytes: payload.bytes,
		payloadTruncated: payload.truncated,
		imageCount: payload.imageCount,
		expiresAt: getFlaggedPayloadExpiry(now),
	});
	return id;
}

/**
 * Preserve the request when the deciding verdict matched a preserved group.
 * Runs detached from the request (tracked for graceful shutdown); a failure is
 * logged and never affects the response.
 */
export function preserveFlaggedContentFilterPayload(
	options: Omit<StoreFlaggedPayloadOptions, "groups">,
): void {
	const groups = getPreservedFlaggedGroups(
		options.plan,
		options.evaluation,
		options.origin.zeroDataRetention,
	);
	if (groups.length === 0) {
		return;
	}
	void trackPendingWork(
		Promise.resolve()
			.then(async () => await storeFlaggedPayload({ ...options, groups }))
			.then((id) => {
				logger.info("gateway_content_filter_payload_preserved", {
					requestId: options.context.requestId,
					organizationId: options.context.organizationId,
					flaggedPayloadId: id,
					groups,
				});
			})
			.catch((error: unknown) => {
				logger.error(
					"Failed to preserve flagged content filter payload",
					toError(error),
					{
						requestId: options.context.requestId,
						organizationId: options.context.organizationId,
						groups,
					},
				);
			}),
	);
}
