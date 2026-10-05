import {
	and,
	asc,
	db,
	eq,
	gt,
	inArray,
	lt,
	lte,
	or,
	sql,
	tables,
} from "@llmgateway/db";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

import {
	decryptDataStreamSecret,
	deliverDataStreamBatch,
	formatAuditEvent,
	formatRequestLogEvent,
	type DataStreamEvent,
} from "./data-streams.js";

import type { AnyColumn, InferSelectModel } from "@llmgateway/db";

export const DATA_STREAM_BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 10;
/**
 * Rows younger than this are not exported yet: request logs are written
 * asynchronously, so a fresh row can land behind the cursor. Waiting closes
 * that gap without re-reading.
 */
const SETTLE_DELAY_MS: Record<"audit_logs" | "request_logs", number> = {
	audit_logs: 30_000,
	request_logs: 120_000,
};

type DataStreamRow = InferSelectModel<typeof tables.dataStream>;

interface Cursor {
	/** `created_at` as Postgres text, keeping its microseconds. */
	createdAt: string;
	id: string;
}

function afterCursor(createdAt: AnyColumn, id: AnyColumn, cursor: Cursor) {
	return or(
		sql`${createdAt} > ${cursor.createdAt}::timestamp`,
		and(sql`${createdAt} = ${cursor.createdAt}::timestamp`, gt(id, cursor.id)),
	);
}

async function projectIdsFor(stream: DataStreamRow): Promise<string[]> {
	if (stream.projectId) {
		return [stream.projectId];
	}
	const rows = await db
		.select({ id: tables.project.id })
		.from(tables.project)
		.where(eq(tables.project.organizationId, stream.organizationId));
	return rows.map((row) => row.id);
}

async function fetchBatch(
	stream: DataStreamRow,
	cursor: Cursor,
	until: Date,
	projectIds: string[],
): Promise<{ events: DataStreamEvent[]; last?: Cursor }> {
	if (stream.source === "audit_logs") {
		const t = tables.auditLog;
		const rows = await db
			.select({ row: t, cursorAt: sql<string>`${t.createdAt}::text` })
			.from(t)
			.where(
				and(
					eq(t.organizationId, stream.organizationId),
					afterCursor(t.createdAt, t.id, cursor),
					lte(t.createdAt, until),
				),
			)
			.orderBy(asc(t.createdAt), asc(t.id))
			.limit(DATA_STREAM_BATCH_SIZE);
		const last = rows.at(-1);
		return {
			events: rows.map(({ row }) => formatAuditEvent(row)),
			last: last ? { createdAt: last.cursorAt, id: last.row.id } : undefined,
		};
	}
	if (projectIds.length === 0) {
		return { events: [] };
	}
	const t = tables.log;
	const rows = await db
		.select({
			id: t.id,
			requestId: t.requestId,
			createdAt: t.createdAt,
			organizationId: t.organizationId,
			projectId: t.projectId,
			apiKeyId: t.apiKeyId,
			requestedModel: t.requestedModel,
			requestedProvider: t.requestedProvider,
			usedModel: t.usedModel,
			usedProvider: t.usedProvider,
			duration: t.duration,
			timeToFirstToken: t.timeToFirstToken,
			promptTokens: t.promptTokens,
			completionTokens: t.completionTokens,
			totalTokens: t.totalTokens,
			reasoningTokens: t.reasoningTokens,
			cachedTokens: t.cachedTokens,
			cost: t.cost,
			finishReason: t.finishReason,
			unifiedFinishReason: t.unifiedFinishReason,
			hasError: t.hasError,
			errorCategory: t.errorCategory,
			cached: t.cached,
			streamed: t.streamed,
			source: t.source,
			apiOrigin: t.apiOrigin,
			sessionId: t.sessionId,
			messages: stream.config.includePayloads ? t.messages : sql<null>`null`,
			content: stream.config.includePayloads ? t.content : sql<null>`null`,
			cursorAt: sql<string>`${t.createdAt}::text`,
		})
		.from(t)
		.where(
			and(
				inArray(t.projectId, projectIds),
				afterCursor(t.createdAt, t.id, cursor),
				lte(t.createdAt, until),
			),
		)
		.orderBy(asc(t.createdAt), asc(t.id))
		.limit(DATA_STREAM_BATCH_SIZE);
	const last = rows.at(-1);
	return {
		events: rows.map((row) =>
			formatRequestLogEvent(row, stream.config.includePayloads === true),
		),
		last: last ? { createdAt: last.cursorAt, id: last.id } : undefined,
	};
}

export interface DataStreamRunResult {
	delivered: number;
	error?: string;
}

/**
 * Delivers every settled event after the stream's cursor (and any pending
 * replay window), advancing the cursor only after a batch is accepted. A
 * failed batch leaves the cursor in place, so the next run retries it.
 */
export async function runDataStream(
	stream: DataStreamRow,
	now: Date = new Date(),
): Promise<DataStreamRunResult> {
	const settled = new Date(now.getTime() - SETTLE_DELAY_MS[stream.source]);
	let delivered = 0;
	try {
		const secret = decryptDataStreamSecret(
			stream.secret,
			stream.id,
			stream.organizationId,
		);
		const projectIds =
			stream.source === "request_logs" ? await projectIdsFor(stream) : [];
		if (stream.replayFrom && stream.replayTo) {
			// An empty id sorts before every row, so the window starts inclusive.
			let cursor: Cursor = {
				createdAt:
					stream.replayCursorCreatedAt ?? stream.replayFrom.toISOString(),
				id: stream.replayCursorId ?? "",
			};
			const until = stream.replayTo < settled ? stream.replayTo : settled;
			for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
				const batch = await fetchBatch(stream, cursor, until, projectIds);
				await deliverDataStreamBatch(stream, secret, batch.events, now);
				delivered += batch.events.length;
				const done =
					batch.events.length < DATA_STREAM_BATCH_SIZE || !batch.last;
				if (batch.last) {
					cursor = batch.last;
				}
				const updated = await db
					.update(tables.dataStream)
					.set({
						...(done
							? {
									replayFrom: null,
									replayTo: null,
									replayCursorCreatedAt: null,
									replayCursorId: null,
								}
							: {
									replayCursorCreatedAt: cursor.createdAt,
									replayCursorId: cursor.id,
								}),
						...(batch.events.length > 0
							? {
									deliveredCount: sql`${tables.dataStream.deliveredCount} + ${batch.events.length}`,
									lastDeliveredAt: now,
									lastError: null,
								}
							: {}),
					})
					// A replay scheduled mid-run replaces this window; leave it alone.
					.where(
						and(
							eq(tables.dataStream.id, stream.id),
							eq(tables.dataStream.replayFrom, stream.replayFrom),
							eq(tables.dataStream.replayTo, stream.replayTo),
						),
					)
					.returning({ id: tables.dataStream.id });
				if (done || updated.length === 0) {
					break;
				}
			}
		}
		let cursor: Cursor = {
			createdAt: stream.cursorCreatedAt,
			id: stream.cursorId,
		};
		for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
			const batch = await fetchBatch(stream, cursor, settled, projectIds);
			if (!batch.last) {
				break;
			}
			await deliverDataStreamBatch(stream, secret, batch.events, now);
			delivered += batch.events.length;
			cursor = batch.last;
			await db
				.update(tables.dataStream)
				.set({
					cursorCreatedAt: cursor.createdAt,
					cursorId: cursor.id,
					deliveredCount: sql`${tables.dataStream.deliveredCount} + ${batch.events.length}`,
					lastDeliveredAt: now,
					lastError: null,
				})
				.where(eq(tables.dataStream.id, stream.id));
			if (batch.events.length < DATA_STREAM_BATCH_SIZE) {
				break;
			}
		}
		return { delivered };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await db
			.update(tables.dataStream)
			.set({ lastError: message.slice(0, 1000), lastErrorAt: now })
			.where(eq(tables.dataStream.id, stream.id));
		return { delivered, error: message };
	}
}

/** Streams the worker should run now. */
export async function listActiveDataStreams(): Promise<DataStreamRow[]> {
	const rows = await db
		.select({
			stream: tables.dataStream,
			organizationId: tables.organization.id,
			plan: tables.organization.plan,
			status: tables.organization.status,
		})
		.from(tables.dataStream)
		.innerJoin(
			tables.organization,
			eq(tables.organization.id, tables.dataStream.organizationId),
		)
		.where(
			and(
				eq(tables.dataStream.enabled, true),
				or(
					sql`${tables.dataStream.lastErrorAt} IS NULL`,
					lt(tables.dataStream.lastErrorAt, new Date(Date.now() - 60_000)),
				),
			),
		);
	// Delivery stops as soon as the organization loses Enterprise access or is
	// deleted; the API guard alone does not cover the worker path.
	return rows
		.filter(
			(row) =>
				row.status !== "deleted" &&
				hasOrganizationEnterpriseAccess(row.organizationId, row.plan),
		)
		.map((row) => row.stream);
}
