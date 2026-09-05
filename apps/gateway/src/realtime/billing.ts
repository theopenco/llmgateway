import { Decimal } from "decimal.js";

import { getAirsideRoutingSnapshot } from "@/lib/airside-routing-snapshot.js";
import { normalizeLogSource } from "@/lib/normalize-log-source.js";
import { recordSpend } from "@/lib/spend-limit.js";

import { swrWrap } from "@llmgateway/cache";
import {
	and,
	cdb,
	db,
	eq,
	getTableName,
	isNotNull,
	isNull,
	log,
	realtimeSession,
	shortid,
	sql,
	UnifiedFinishReason,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { RealtimeMappingMatch } from "./catalog.js";
import type { RealtimePreflightResult } from "./preflight.js";
import type {
	NormalizedRealtimeUsage,
	RealtimeCostBreakdown,
	RealtimePriceSnapshot,
} from "./pricing.js";
import type {
	NormalizedTranscriptionUsage,
	TranscriptionCostBreakdown,
	TranscriptionPriceSnapshot,
} from "./transcription.js";

export interface RealtimeSessionRecord {
	id: string;
}

export async function createRealtimeSessionRecord(
	preflight: RealtimePreflightResult,
	requestedModel: string,
): Promise<RealtimeSessionRecord> {
	const id = shortid();
	await db.insert(realtimeSession).values({
		id,
		organizationId: preflight.project.organizationId,
		projectId: preflight.project.id,
		apiKeyId: preflight.apiKey.id,
		requestedModel,
		usedModel: `${preflight.match.mapping.providerId}/${preflight.match.modelId}`,
		usedModelMapping: preflight.match.mapping.externalId,
		usedProvider: preflight.match.mapping.providerId,
		mode: preflight.project.mode as "api-keys" | "credits" | "hybrid",
		usedMode: preflight.usedMode,
	});
	return { id };
}

export async function markRealtimeSessionUpstream(
	sessionId: string,
	upstreamSessionId: string,
): Promise<void> {
	await db
		.update(realtimeSession)
		.set({ upstreamSessionId, lastActivityAt: new Date() })
		.where(eq(realtimeSession.id, sessionId));
}

export async function closeRealtimeSessionRecord(
	sessionId: string,
	status: "closed" | "error",
	closeReason: string,
	counters: { bytesIn: number; bytesOut: number },
): Promise<void> {
	await db
		.update(realtimeSession)
		.set({
			status,
			closeReason,
			bytesIn: counters.bytesIn,
			bytesOut: counters.bytesOut,
			closedAt: new Date(),
			lastActivityAt: new Date(),
		})
		.where(eq(realtimeSession.id, sessionId));
}

/**
 * Sum of the organization's realtime costs the worker has NOT yet debited from
 * its balance. Used by the credit gate so spend is never double-counted: once
 * the worker settles a row (processedAt set), the organization balance already
 * reflects it. Scoped to the organization rather than the current session
 * because an organization may run several concurrent sessions, and a
 * session-scoped sum would let each of them authorize work against the same
 * undebited balance.
 *
 * Cached with swrWrap + a PINNED short-TTL Drizzle entry (`autoInvalidate:
 * false`): `log` receives no cdb-visible writes (this module and the worker
 * both write it outside cdb), so auto-invalidation would never fire and the
 * default TTL would lag the gate by up to a minute. The short fixed TTL keeps
 * the gate near-fresh while collapsing the per-turn aggregate scan to one
 * query per window; the brief staleness only affects when the gate trips,
 * never what is billed.
 */
const UNSETTLED_SPEND_TTL_SECONDS = 2;

export async function getUnsettledRealtimeOrganizationSpend(
	organizationId: string,
): Promise<Decimal> {
	const rows = await swrWrap(
		`realtimeUnsettled:${organizationId}`,
		[getTableName(log)],
		async () =>
			await cdb
				.select({
					total: sql<
						string | null
					>`sum(coalesce(${log.billingCost}, ${log.cost}::float8::numeric))`,
				})
				.from(log)
				.where(
					and(
						eq(log.organizationId, organizationId),
						isNotNull(log.realtimeSessionId),
						isNull(log.processedAt),
						eq(log.cached, false),
					),
				)
				.$withCache({
					tag: `realtime-unsettled:${organizationId}`,
					autoInvalidate: false,
					config: { ex: UNSETTLED_SPEND_TTL_SECONDS },
				}),
	);
	return new Decimal(rows[0]?.total ?? "0");
}

export interface RecordRealtimeResponseInput {
	preflight: RealtimePreflightResult;
	sessionId: string;
	requestedModel: string;
	/**
	 * Upstream response id; forms the idempotency key "response:<id>".
	 */
	responseId: string;
	responseStatus: string;
	durationMs: number;
	responseSizeBytes: number;
	usage: NormalizedRealtimeUsage;
	costs: RealtimeCostBreakdown;
	pricingSnapshot: RealtimePriceSnapshot;
	/**
	 * Effective discount fraction applied to the costs (0 when none).
	 */
	discount: number;
	source: string | null;
	userAgent: string | undefined;
}

function unifiedFinishReasonForStatus(status: string): string {
	switch (status) {
		case "completed":
			return UnifiedFinishReason.COMPLETED;
		case "cancelled":
			return UnifiedFinishReason.CANCELED;
		case "incomplete":
			return UnifiedFinishReason.LENGTH_LIMIT;
		case "failed":
			return UnifiedFinishReason.UPSTREAM_ERROR;
		default:
			return UnifiedFinishReason.UNKNOWN;
	}
}

/**
 * Durably persist one billable realtime response as a log row BEFORE its
 * terminal event is forwarded to the caller. Idempotent on
 * (realtimeSessionId, "response:<responseId>") via the partial unique index —
 * a redelivered terminal event inserts nothing and charges nothing. The log
 * insert and the session aggregate update commit in one transaction.
 *
 * Throws on database failure: the caller must fail closed (close the session
 * without forwarding the terminal event) rather than deliver unbilled work.
 */
export async function recordRealtimeResponse(
	input: RecordRealtimeResponseInput,
): Promise<{ inserted: boolean }> {
	const { preflight, usage, costs } = input;
	const usageKey = `response:${input.responseId}`;
	const billingCost = costs.totalCost.toString();
	const airsideRoutingSnapshot = await getAirsideRoutingSnapshot(
		preflight.match.mapping.providerId,
		preflight.match.modelId,
	);

	const inserted = await db.transaction(async (tx) => {
		const rows = await tx
			.insert(log)
			.values({
				id: shortid(),
				requestId: `${input.sessionId}:${input.responseId}`,
				organizationId: preflight.project.organizationId,
				projectId: preflight.project.id,
				apiKeyId: preflight.apiKey.id,
				providerKeyId: preflight.trackedKeyHealthId ?? null,
				duration: input.durationMs,
				requestedModel: input.requestedModel,
				requestedProvider: preflight.match.mapping.providerId,
				usedModel: `${preflight.match.mapping.providerId}/${preflight.match.modelId}`,
				usedModelMapping: preflight.match.mapping.externalId,
				usedProvider: preflight.match.mapping.providerId,
				...airsideRoutingSnapshot,
				responseSize: input.responseSizeBytes,
				// Conversation content (text transcripts, audio) is intentionally not
				// persisted for realtime sessions.
				content: null,
				messages: [],
				finishReason: input.responseStatus,
				unifiedFinishReason: unifiedFinishReasonForStatus(input.responseStatus),
				promptTokens: usage.inputTokens.toString(),
				completionTokens: usage.outputTokens.toString(),
				totalTokens: usage.totalTokens.toString(),
				cachedTokens: usage.cachedTokens.toString(),
				audioInputTokens: usage.inputAudioTokens.toString(),
				audioOutputTokens: usage.outputAudioTokens.toString(),
				imageInputTokens: usage.inputImageTokens.toString(),
				hasError: input.responseStatus === "failed",
				canceled: input.responseStatus === "cancelled",
				streamed: true,
				cached: false,
				mode: preflight.project.mode as "api-keys" | "credits" | "hybrid",
				usedMode: preflight.usedMode,
				source: normalizeLogSource(input.source),
				userAgent: input.userAgent ?? null,
				// Float cost columns stay populated for dashboards and legacy queries;
				// billingCost is the exact decimal the worker debits.
				cost: costs.totalCost.toNumber(),
				inputCost: costs.inputCost.toNumber(),
				outputCost: costs.outputCost.toNumber(),
				cachedInputCost: costs.cachedInputCost.toNumber(),
				audioInputCost: costs.audioInputCost.toNumber(),
				audioOutputCost: costs.audioOutputCost.toNumber(),
				imageInputCost: costs.imageInputCost.toNumber(),
				requestCost: 0,
				estimatedCost: false,
				discount: input.discount !== 0 ? input.discount : null,
				billingCost,
				realtimeSessionId: input.sessionId,
				realtimeUsageKey: usageKey,
				realtimeUsage: {
					usage: { ...usage },
					pricing: Object.fromEntries(
						Object.entries(input.pricingSnapshot).filter(
							([, value]) => value !== undefined,
						),
					) as Record<string, string>,
					status: input.responseStatus,
				},
				// No conversation payloads are persisted for realtime sessions, so
				// no data-retention storage fee applies.
				dataStorageCost: "0",
			})
			.onConflictDoNothing({
				target: [log.realtimeSessionId, log.realtimeUsageKey],
				// Pinning the arbiter keeps any other unique violation loud rather
				// than reporting it as an already-billed duplicate. The predicate
				// repeats the index's own: PostgreSQL will not infer a partial
				// unique index without it.
				where: sql`realtime_usage_key is not null`,
			})
			.returning({ id: log.id });

		if (rows.length === 0) {
			return false;
		}

		await tx
			.update(realtimeSession)
			.set({
				responseCount: sql`${realtimeSession.responseCount} + 1`,
				totalCost: sql`${realtimeSession.totalCost} + ${billingCost}`,
				lastActivityAt: new Date(),
			})
			.where(eq(realtimeSession.id, input.sessionId));

		return true;
	});

	if (!inserted) {
		logger.info("Duplicate realtime usage event ignored", {
			realtimeSessionId: input.sessionId,
			usageKey,
		});
	} else if (preflight.usedMode === "credits") {
		// Realtime bypasses insertLog, so advance the daily/monthly spend-cap
		// counters here; the account gate reads them on the next turn.
		await recordSpend(
			preflight.project.organizationId,
			costs.totalCost.toNumber(),
		);
	}
	return { inserted };
}

export interface RecordRealtimeTranscriptionInput {
	preflight: RealtimePreflightResult;
	sessionId: string;
	/**
	 * ASR mapping the transcription is billed against (distinct from the
	 * session's realtime mapping).
	 */
	transcription: RealtimeMappingMatch;
	/**
	 * Model string the caller requested for transcription (as sent in
	 * session.update / the client-secret request).
	 */
	requestedModel: string;
	/**
	 * Upstream conversation item id; forms the idempotency key
	 * "transcription:<itemId>:<contentIndex>".
	 */
	itemId: string;
	contentIndex: number;
	responseSizeBytes: number;
	usage: NormalizedTranscriptionUsage;
	costs: TranscriptionCostBreakdown;
	pricingSnapshot: TranscriptionPriceSnapshot;
	/**
	 * Effective discount fraction applied to the costs (0 when none).
	 */
	discount: number;
	source: string | null;
	userAgent: string | undefined;
}

/**
 * Durably persist one billed input-audio transcription as a log row BEFORE
 * its completed event is forwarded to the caller. The row is attributed to
 * the ASR model/mapping while remaining linked to the realtime session, so
 * unsettled-session spend queries (which key on realtimeSessionId) include
 * ASR spend in subsequent generation gates. Idempotent on
 * (realtimeSessionId, "transcription:<itemId>:<contentIndex>") via the
 * partial unique index. Updates the session's totalCost and lastActivityAt
 * but not responseCount, which counts model generations only.
 *
 * Throws on database failure: the caller must fail closed rather than
 * deliver an unbilled transcript.
 */
export async function recordRealtimeTranscription(
	input: RecordRealtimeTranscriptionInput,
): Promise<{ inserted: boolean }> {
	const { preflight, transcription, usage, costs } = input;
	const usageKey = `transcription:${input.itemId}:${input.contentIndex}`;
	const billingCost = costs.totalCost.toString();
	const airsideRoutingSnapshot = await getAirsideRoutingSnapshot(
		transcription.mapping.providerId,
		transcription.modelId,
	);

	const inserted = await db.transaction(async (tx) => {
		const rows = await tx
			.insert(log)
			.values({
				id: shortid(),
				requestId: `${input.sessionId}:${input.itemId}:${input.contentIndex}`,
				organizationId: preflight.project.organizationId,
				projectId: preflight.project.id,
				apiKeyId: preflight.apiKey.id,
				providerKeyId: preflight.trackedKeyHealthId ?? null,
				duration: 0,
				requestedModel: input.requestedModel,
				requestedProvider: transcription.mapping.providerId,
				usedModel: `${transcription.mapping.providerId}/${transcription.modelId}`,
				usedModelMapping: transcription.mapping.externalId,
				usedProvider: transcription.mapping.providerId,
				...airsideRoutingSnapshot,
				responseSize: input.responseSizeBytes,
				// Transcript content is intentionally not persisted, matching the
				// no-conversation-content policy for realtime sessions.
				content: null,
				messages: [],
				finishReason: "completed",
				unifiedFinishReason: UnifiedFinishReason.COMPLETED,
				promptTokens: usage.inputTokens.toString(),
				completionTokens: usage.outputTokens.toString(),
				totalTokens: usage.totalTokens.toString(),
				cachedTokens: "0",
				audioInputTokens: usage.inputAudioTokens.toString(),
				audioOutputTokens: "0",
				imageInputTokens: "0",
				hasError: false,
				canceled: false,
				streamed: true,
				cached: false,
				mode: preflight.project.mode as "api-keys" | "credits" | "hybrid",
				usedMode: preflight.usedMode,
				source: normalizeLogSource(input.source),
				userAgent: input.userAgent ?? null,
				cost: costs.totalCost.toNumber(),
				inputCost: costs.inputCost.toNumber(),
				outputCost: costs.outputCost.toNumber(),
				cachedInputCost: 0,
				audioInputCost: costs.audioInputCost.toNumber(),
				audioOutputCost: 0,
				imageInputCost: 0,
				requestCost: 0,
				estimatedCost: false,
				discount: input.discount !== 0 ? input.discount : null,
				billingCost,
				realtimeSessionId: input.sessionId,
				realtimeUsageKey: usageKey,
				realtimeUsage: {
					usage: { ...usage },
					pricing: Object.fromEntries(
						Object.entries(input.pricingSnapshot).filter(
							([, value]) => value !== undefined,
						),
					) as Record<string, string>,
					status: "completed",
				},
				dataStorageCost: "0",
			})
			.onConflictDoNothing({
				target: [log.realtimeSessionId, log.realtimeUsageKey],
				where: sql`realtime_usage_key is not null`,
			})
			.returning({ id: log.id });

		if (rows.length === 0) {
			return false;
		}

		await tx
			.update(realtimeSession)
			.set({
				totalCost: sql`${realtimeSession.totalCost} + ${billingCost}`,
				lastActivityAt: new Date(),
			})
			.where(eq(realtimeSession.id, input.sessionId));

		return true;
	});

	if (!inserted) {
		logger.info("Duplicate realtime transcription event ignored", {
			realtimeSessionId: input.sessionId,
			usageKey,
		});
	} else if (preflight.usedMode === "credits") {
		// Same spend-cap accounting as recordRealtimeResponse above.
		await recordSpend(
			preflight.project.organizationId,
			costs.totalCost.toNumber(),
		);
	}
	return { inserted };
}
