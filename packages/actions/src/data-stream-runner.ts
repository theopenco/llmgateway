import {
	and,
	asc,
	db,
	eq,
	exists,
	gt,
	inArray,
	lte,
	or,
	sql,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";
import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

import {
	DataStreamDeliveryError,
	decryptDataStreamSecret,
	deliverDataStreamBatch,
	formatAuditEvent,
	formatRequestLogEvent,
	type DataStreamEvent,
} from "./data-streams.js";

import type { AnyColumn, InferSelectModel } from "@llmgateway/db";

export const DATA_STREAM_BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 10;
/** A slow destination yields to the other streams after this long. */
const MAX_RUN_MS = 20_000;
const CUTOFF_LAG_WARN_MS = 300_000;

const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 3_600_000;
/** Consecutive failures of any kind before the stream pauses. */
export const DATA_STREAM_MAX_FAILURES = 20;
/** Rejections (4xx) since the last accepted delivery before the stream pauses. */
export const DATA_STREAM_MAX_REJECTIONS = 3;

type DataStreamRow = InferSelectModel<typeof tables.dataStream>;

/** When a failed stream is retried: 1, 2, 4 … minutes, capped at an hour. */
export function dataStreamRetryAt(
	stream: Pick<DataStreamRow, "lastErrorAt" | "failureCount">,
): Date | null {
	if (!stream.lastErrorAt || stream.failureCount === 0) {
		return null;
	}
	const doublings = 2 ** (stream.failureCount - 1);
	const delay = Math.min(RETRY_BASE_MS * doublings, RETRY_MAX_MS);
	return new Date(stream.lastErrorAt.getTime() + delay);
}

interface Cursor {
	/** `created_at` as Postgres text, keeping its microseconds. */
	createdAt: string;
	id: string;
}

/**
 * Keyset condition. The explicit `>=` is what lets Postgres use the cursor as
 * an index lower bound; the OR alone starts the scan at the beginning.
 */
function afterCursor(createdAt: AnyColumn, id: AnyColumn, cursor: Cursor) {
	const at = sql`${cursor.createdAt}::timestamp`;
	return and(
		sql`${createdAt} >= ${at}`,
		or(
			sql`${createdAt} > ${at}`,
			and(sql`${createdAt} = ${at}`, gt(id, cursor.id)),
		),
	);
}

/**
 * Rows take `created_at` from `now()`, their transaction's start, so a row
 * still uncommitted is never older than the oldest open transaction. Exporting
 * only below that bound keeps a late commit from landing behind the cursor.
 * The one-second margin covers a transaction that started but has not yet
 * published its start time. Every log and audit writer writes first, so a
 * transaction still without an xid after two minutes is a reader and does not
 * hold exports back. Sessions of another role hide their start time and
 * backend type; while any exist, fall back to a fixed delay.
 */
async function exportCutoff(): Promise<Date> {
	const result = await db.execute<{ cutoff: Date; now: Date }>(sql`
		select now(), least(
			now() - interval '1 second',
			min(xact_start) filter (
				where backend_xid is not null
					or xact_start > now() - interval '2 minutes'
			),
			case when bool_or(query = '<insufficient privilege>')
				then now() - interval '2 minutes' end
		) - interval '1 millisecond' as cutoff
		from pg_stat_activity
		where datname = current_database()
			and coalesce(backend_type, 'client backend') = 'client backend'
			and pid <> pg_backend_pid()
	`);
	const cutoff = new Date(result.rows[0].cutoff);
	const lagMs = new Date(result.rows[0].now).getTime() - cutoff.getTime();
	if (lagMs > CUTOFF_LAG_WARN_MS) {
		logger.warn("Data stream export held back by a long transaction", {
			lagMs,
		});
	}
	return cutoff;
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
	// Metadata columns only: prompts, completions, and tool payloads are never
	// selected, so they cannot leave the platform.
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
		events: rows.map((row) => formatRequestLogEvent(row)),
		last: last ? { createdAt: last.cursorAt, id: last.id } : undefined,
	};
}

export interface DataStreamRunResult {
	delivered: number;
	error?: string;
	/** Set when this run paused the stream after repeated failures. */
	paused?: boolean;
}

export interface DataStreamRunOptions {
	now?: Date;
	/** Called after every delivered batch, e.g. to keep a worker lock fresh. */
	onProgress?: () => Promise<void>;
	/** Stream state is written only while this `lock` row exists. */
	leaseId?: string;
}

class StreamStopped extends Error {}
/** The caller's callback failed; that says nothing about the destination. */
class ProgressFailed extends Error {}

/**
 * Delivers every settled event after the stream's cursor (and any pending
 * replay window), advancing the cursor only after a batch is accepted. A
 * failed batch leaves the cursor in place, so the next run retries it.
 */
export async function runDataStream(
	stream: DataStreamRow,
	options: DataStreamRunOptions = {},
): Promise<DataStreamRunResult> {
	const now = options.now ?? new Date();
	const started = Date.now();
	let delivered = 0;
	const outOfTime = () => Date.now() - started > MAX_RUN_MS;
	// Locking the lease row makes a takeover's delete wait for this write, or
	// fail it once committed; a plain EXISTS reads a snapshot and misses it.
	const owned = options.leaseId
		? exists(
				db
					.select({ id: tables.lock.id })
					.from(tables.lock)
					.where(eq(tables.lock.id, options.leaseId))
					.for("key share"),
			)
		: undefined;
	const stillActive = async () =>
		(await loadActiveDataStream(stream.id)) !== null;
	const progress = async () => {
		try {
			await options.onProgress?.();
		} catch (cause) {
			throw new ProgressFailed("Data stream progress callback failed", {
				cause,
			});
		}
	};
	try {
		const secret = decryptDataStreamSecret(
			stream.secret,
			stream.id,
			stream.organizationId,
		);
		const projectIds =
			stream.source === "request_logs" ? await projectIdsFor(stream) : [];
		const cutoff = await exportCutoff();
		if (stream.replayFrom && stream.replayTo) {
			// An empty id sorts before every row, so the window starts inclusive.
			let cursor: Cursor = {
				createdAt:
					stream.replayCursorCreatedAt ?? stream.replayFrom.toISOString(),
				id: stream.replayCursorId ?? "",
			};
			const reachesEnd = stream.replayTo <= cutoff;
			const until = reachesEnd ? stream.replayTo : cutoff;
			for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
				const batch = await fetchBatch(stream, cursor, until, projectIds);
				await deliverDataStreamBatch(stream, secret, batch.events, now);
				delivered += batch.events.length;
				const exhausted =
					batch.events.length < DATA_STREAM_BATCH_SIZE || !batch.last;
				const done = exhausted && reachesEnd;
				if (batch.last) {
					cursor = batch.last;
				}
				const [updated] = await db
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
									failureCount: 0,
									rejectionCount: 0,
								}
							: {}),
					})
					// A replay scheduled mid-run replaces this window; leave it alone.
					.where(
						and(
							eq(tables.dataStream.id, stream.id),
							eq(tables.dataStream.replayFrom, stream.replayFrom),
							eq(tables.dataStream.replayTo, stream.replayTo),
							owned,
						),
					)
					.returning({ id: tables.dataStream.id });
				await progress();
				if (!updated || !(await stillActive())) {
					throw new StreamStopped();
				}
				if (exhausted || outOfTime()) {
					break;
				}
			}
		}
		let cursor: Cursor = {
			createdAt: stream.cursorCreatedAt,
			id: stream.cursorId,
		};
		for (let i = 0; i < MAX_BATCHES_PER_RUN && !outOfTime(); i++) {
			const batch = await fetchBatch(stream, cursor, cutoff, projectIds);
			if (!batch.last) {
				break;
			}
			await deliverDataStreamBatch(stream, secret, batch.events, now);
			delivered += batch.events.length;
			cursor = batch.last;
			// The cursor always moves past a delivered batch; a pause or lost
			// access that landed meanwhile only stops the loop.
			const [updated] = await db
				.update(tables.dataStream)
				.set({
					cursorCreatedAt: cursor.createdAt,
					cursorId: cursor.id,
					deliveredCount: sql`${tables.dataStream.deliveredCount} + ${batch.events.length}`,
					lastDeliveredAt: now,
					lastError: null,
					failureCount: 0,
					rejectionCount: 0,
				})
				.where(and(eq(tables.dataStream.id, stream.id), owned))
				.returning({ id: tables.dataStream.id });
			await progress();
			if (!updated || !(await stillActive())) {
				throw new StreamStopped();
			}
			if (batch.events.length < DATA_STREAM_BATCH_SIZE || outOfTime()) {
				break;
			}
		}
		return { delivered };
	} catch (error) {
		if (error instanceof StreamStopped) {
			return { delivered };
		}
		if (error instanceof ProgressFailed) {
			throw error.cause;
		}
		const message = error instanceof Error ? error.message : String(error);
		const rejected =
			error instanceof DataStreamDeliveryError && error.permanent;
		// Counted in SQL: a batch accepted earlier in this run already reset
		// the stored counters, so the run's snapshot is stale.
		const t = tables.dataStream;
		const failureCount = sql`${t.failureCount} + 1`;
		const rejectionCount = sql`${t.rejectionCount} + ${rejected ? 1 : 0}`;
		const rejectedOut = sql`${rejectionCount} >= ${DATA_STREAM_MAX_REJECTIONS}`;
		const failedOut = sql`${failureCount} >= ${DATA_STREAM_MAX_FAILURES}`;
		const [updated] = await db
			.update(t)
			.set({
				lastError: message.slice(0, 1000),
				lastErrorAt: now,
				failureCount,
				rejectionCount,
				enabled: sql`not (${rejectedOut} or ${failedOut})`,
				pausedReason: sql`case
					when ${rejectedOut} then format('Paused after %s rejected deliveries', ${rejectionCount})
					when ${failedOut} then format('Paused after %s failed deliveries', ${failureCount})
					else ${t.pausedReason} end`,
			})
			.where(and(eq(t.id, stream.id), eq(t.enabled, true), owned))
			.returning({ enabled: t.enabled, pausedReason: t.pausedReason });
		const paused = updated?.enabled === false;
		if (paused) {
			await notifyDataStreamPaused(
				stream,
				updated.pausedReason ?? "Paused",
				message,
				now,
			);
		}
		return { delivered, error: message, paused };
	}
}

/** Bell and email for the organization's owners and admins. */
async function notifyDataStreamPaused(
	stream: DataStreamRow,
	reason: string,
	lastError: string,
	now: Date,
): Promise<void> {
	const eventKey = `${stream.organizationId}:data_stream:${stream.id}:${now.toISOString()}`;
	const title = `Data stream "${stream.name}" paused`;
	const message = `${reason}. Last error: ${lastError.slice(0, 200)}. Fix the destination, then resume the stream; delivery continues from where it stopped.`;
	const href = `/dashboard/${stream.organizationId}/org/data-streams`;
	const [alert] = await db
		.insert(tables.organizationAlert)
		.values({
			organizationId: stream.organizationId,
			type: "data_stream",
			eventKey,
			title,
			message,
			href,
		})
		.onConflictDoNothing()
		.returning({ id: tables.organizationAlert.id });
	if (!alert) {
		return;
	}
	const members = await db.query.userOrganization.findMany({
		where: { organizationId: { eq: stream.organizationId } },
		columns: { userId: true, role: true },
		with: { user: { columns: { status: true, emailVerified: true } } },
	});
	for (const member of members) {
		if (member.user?.status !== "active" || !isOrganizationAdmin(member.role)) {
			continue;
		}
		const preference = await db.query.notificationPreference.findFirst({
			where: { userId: { eq: member.userId }, type: { eq: "data_stream" } },
		});
		const inApp = preference?.inApp ?? true;
		const email =
			(preference?.email ?? true) && member.user.emailVerified === true;
		if (!inApp && !email) {
			continue;
		}
		await db
			.insert(tables.notification)
			.values({
				userId: member.userId,
				organizationId: stream.organizationId,
				type: "data_stream",
				eventKey,
				title,
				message,
				href,
				inApp,
				email,
			})
			.onConflictDoNothing();
	}
}

function organizationAllows(
	org: {
		status: string | null;
		plan: string;
		id: string;
		dataStreamsEnabled: boolean;
		requestLogExportEnabled: boolean;
	},
	source: DataStreamRow["source"],
): boolean {
	return (
		org.status !== "deleted" &&
		org.dataStreamsEnabled &&
		(source !== "request_logs" || org.requestLogExportEnabled) &&
		hasOrganizationEnterpriseAccess(org.id, org.plan)
	);
}

/** Enabled streams whose organization may export, and whose backoff has elapsed. */
export async function listActiveDataStreams(
	now: Date = new Date(),
): Promise<DataStreamRow[]> {
	const rows = await db
		.select({ stream: tables.dataStream, organization: tables.organization })
		.from(tables.dataStream)
		.innerJoin(
			tables.organization,
			eq(tables.organization.id, tables.dataStream.organizationId),
		)
		.where(eq(tables.dataStream.enabled, true));
	// Delivery stops as soon as the organization loses access; the API guard
	// alone does not cover the worker path.
	return rows
		.filter(
			({ stream, organization }) =>
				organizationAllows(organization, stream.source) &&
				(dataStreamRetryAt(stream)?.getTime() ?? 0) <= now.getTime(),
		)
		.map((row) => row.stream);
}

/**
 * The stream as it is right now, or null once it was paused, deleted, or its
 * organization lost access. The worker lists streams once per pass and
 * re-reads each one just before running it, so a pause or credential rotation
 * made during the pass takes effect immediately.
 */
export async function loadActiveDataStream(
	id: string,
): Promise<DataStreamRow | null> {
	const [row] = await db
		.select({ stream: tables.dataStream, organization: tables.organization })
		.from(tables.dataStream)
		.innerJoin(
			tables.organization,
			eq(tables.organization.id, tables.dataStream.organizationId),
		)
		.where(
			and(eq(tables.dataStream.id, id), eq(tables.dataStream.enabled, true)),
		)
		.limit(1);
	if (!row || !organizationAllows(row.organization, row.stream.source)) {
		return null;
	}
	return row.stream;
}
