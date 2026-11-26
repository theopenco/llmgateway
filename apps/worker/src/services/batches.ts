import { isStopRequested } from "@/shutdown.js";

import {
	and,
	asc,
	db,
	eq,
	gt,
	inArray,
	isNull,
	lt,
	lte,
	ne,
	or,
	sql,
	deleteBatchRequests,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	API_KEY_USAGE_LIMIT_ERROR_CODE,
	BATCH_FILE_TTL_MS,
	BATCH_MAX_STORED_RESPONSE_BYTES,
	batchGatewayHeaders,
	buildBatchOutputLine,
	MEMBER_BUDGET_EXCEEDED_ERROR_CODE,
	newBatchFileId,
	newBatchRequestId,
	parseBatchInput,
	toStoredResponseBody,
	type BatchLineError,
} from "@llmgateway/shared/batch";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { decryptProviderKey } from "@llmgateway/shared/provider-key-crypto";
import { randomFloat } from "@llmgateway/shared/random";

const INSERT_CHUNK_SIZE = 1000;
const OUTPUT_PAGE_SIZE = 1000;
const VALIDATION_LEASE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
// Longer than the request timeout, so a live request is never reclaimed.
const REQUEST_LEASE_GRACE_MS = 5 * 60 * 1000;
const REQUEST_LEASE_MS = REQUEST_TIMEOUT_MS + REQUEST_LEASE_GRACE_MS;
const MAX_DELIVERY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 30_000;
const THROTTLE_DELAY_MS = 60_000;
const USAGE_LIMIT_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
const RETRY_JITTER = 0.2;
// Batches considered per organization in one claim round, oldest first.
const CLAIM_SCAN_PER_ORG = 20;
const CLEANUP_LIMIT = 500;
const CLEANUP_TIME_BUDGET_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STUCK_BATCH_AFTER_MS = 30 * 60 * 1000;
// The gateway answered without a result: a timeout or gateway-level 5xx, or a
// provider failure it reports as a 500 with code `upstream_error` after its
// own fallback. Those are logged as upstream errors and bill nothing, so a
// retry cannot charge twice. Any other 500 may follow a billed call.
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const RETRYABLE_500_CODE = "upstream_error";
// Rejected before any work: rate limits, overloaded pods and empty balances.
const THROTTLED_STATUSES = new Set([402, 429, 529]);
const USAGE_LIMIT_ERROR_CODES = new Set([
	API_KEY_USAGE_LIMIT_ERROR_CODE,
	MEMBER_BUDGET_EXCEEDED_ERROR_CODE,
]);
const INTERRUPTED_ERROR = {
	code: "request_interrupted",
	message:
		"The worker stopped while this request was running, so its result is unknown. It was not retried to avoid running it twice.",
};
// Connection errors raised before any byte reached the gateway.
const UNDELIVERED_ERROR_CODES = new Set([
	"ECONNREFUSED",
	"ENOTFOUND",
	"EAI_AGAIN",
	"UND_ERR_CONNECT_TIMEOUT",
]);
let claimRotation = 0;
const CLEANUP_BATCH_LIMIT = 20;
const MS_PER_SECOND = 1000;

export const BATCH_REQUEST_CONCURRENCY =
	Number(process.env.BATCH_REQUEST_CONCURRENCY) || 16;
export const BATCH_REQUEST_CONCURRENCY_PER_BATCH =
	Number(process.env.BATCH_REQUEST_CONCURRENCY_PER_BATCH) || 8;
/** Fleet-wide in-flight requests per organization, across its batches. */
export const BATCH_REQUEST_CONCURRENCY_PER_ORG =
	Number(process.env.BATCH_REQUEST_CONCURRENCY_PER_ORG) || 16;
/** Requests an organization may have in running batches. */
export const BATCH_MAX_QUEUED_REQUESTS_PER_ORG =
	Number(process.env.BATCH_MAX_QUEUED_REQUESTS_PER_ORG) || 1_000_000;

const TERMINAL_ERROR_STATUSES = ["failed", "cancelled", "expired"] as const;

type BatchRow = typeof tables.batch.$inferSelect;

export interface ClaimedBatchRequest {
	id: string;
	batchId: string;
	body: string;
	attempts: number;
}

function credentialRowId(batchId: string) {
	return `batch:${batchId}`;
}

async function deleteCredential(batchId: string) {
	await db
		.delete(tables.batchCredential)
		.where(eq(tables.batchCredential.batchId, batchId));
}

/**
 * Ends a batch that never started. `lease` guards against a validator that
 * outlived its lease: only the holder of the current lease may end the batch.
 */
async function endUnstartedBatch(
	batchId: string,
	lease: Date | null,
	update: { status: "failed" | "expired"; errors: BatchLineError[] },
): Promise<boolean> {
	const now = new Date();
	const [ended] = await db
		.update(tables.batch)
		.set({
			status: update.status,
			errors: update.errors,
			claimedUntil: null,
			...(update.status === "failed" ? { failedAt: now } : { expiredAt: now }),
		})
		.where(
			and(
				eq(tables.batch.id, batchId),
				// The lease holder may also end a batch cancelled while validating.
				lease
					? eq(tables.batch.claimedUntil, lease)
					: and(
							eq(tables.batch.status, "validating"),
							or(
								isNull(tables.batch.claimedUntil),
								lt(tables.batch.claimedUntil, now),
							),
						),
			),
		)
		.returning({ id: tables.batch.id });
	if (!ended) {
		return false;
	}
	await deleteBatchRequests(batchId);
	await deleteCredential(batchId);
	return true;
}

/** Parses validating batches into batch_request rows. */
export async function validatePendingBatches(
	now = new Date(),
): Promise<number> {
	const lease = new Date(now.getTime() + VALIDATION_LEASE_MS);
	const claimed = await db.transaction(async (tx) => {
		const rows = await tx
			.select()
			.from(tables.batch)
			.where(
				and(
					eq(tables.batch.status, "validating"),
					gt(tables.batch.expiresAt, now),
					or(
						isNull(tables.batch.claimedUntil),
						lt(tables.batch.claimedUntil, now),
					),
				),
			)
			.limit(1)
			.for("update", { skipLocked: true });
		if (rows.length === 0) {
			return [];
		}
		await tx
			.update(tables.batch)
			.set({ claimedUntil: lease })
			.where(
				inArray(
					tables.batch.id,
					rows.map((row) => row.id),
				),
			);
		return rows;
	});

	for (const batch of claimed) {
		if (batch.claimedUntil) {
			logger.warn("Batch API re-validating a batch whose lease ran out", {
				batchId: batch.id,
			});
		}
		await validateBatch(batch, lease);
	}
	return claimed.length;
}

async function validateBatch(batch: BatchRow, lease: Date) {
	const [file] = await db
		.select({ content: tables.batchFile.content })
		.from(tables.batchFile)
		.where(
			and(
				eq(tables.batchFile.id, batch.inputFileId),
				eq(tables.batchFile.projectId, batch.projectId),
			),
		);
	if (!file?.content) {
		await endUnstartedBatch(batch.id, lease, {
			status: "failed",
			errors: [
				{
					code: "input_file_missing",
					message: "The input file was deleted before the batch started.",
				},
			],
		});
		return;
	}

	const parsed = parseBatchInput(file.content, batch.endpoint);
	if (!parsed.ok) {
		await endUnstartedBatch(batch.id, lease, {
			status: "failed",
			errors: parsed.errors,
		});
		return;
	}

	const queued = await db
		.select({
			total: sql<number>`coalesce(sum(${tables.batch.requestTotal}), 0)::int`,
		})
		.from(tables.batch)
		.where(
			and(
				eq(tables.batch.organizationId, batch.organizationId),
				eq(tables.batch.status, "in_progress"),
			),
		)
		.then((rows) => rows[0]?.total ?? 0);
	if (queued + parsed.requests.length > BATCH_MAX_QUEUED_REQUESTS_PER_ORG) {
		await endUnstartedBatch(batch.id, lease, {
			status: "failed",
			errors: [
				{
					code: "request_limit_exceeded",
					message: `Batches in progress may hold at most ${BATCH_MAX_QUEUED_REQUESTS_PER_ORG} requests per organization. Retry once some of them finish.`,
				},
			],
		});
		return;
	}

	// A previous attempt may have died midway through the inserts.
	await deleteBatchRequests(batch.id);
	for (
		let start = 0;
		start < parsed.requests.length;
		start += INSERT_CHUNK_SIZE
	) {
		if (!(await holdsLease(batch.id, lease))) {
			return;
		}
		await db.insert(tables.batchRequest).values(
			parsed.requests
				.slice(start, start + INSERT_CHUNK_SIZE)
				.map((request) => ({
					id: newBatchRequestId(),
					batchId: batch.id,
					lineNumber: request.lineNumber,
					customId: request.customId,
					body: request.body,
				})),
		);
	}

	const [started] = await db
		.update(tables.batch)
		.set({
			status: "in_progress",
			inProgressAt: new Date(),
			requestTotal: parsed.requests.length,
			claimedUntil: null,
		})
		.where(
			and(
				eq(tables.batch.id, batch.id),
				eq(tables.batch.status, "validating"),
				eq(tables.batch.claimedUntil, lease),
			),
		)
		.returning({ id: tables.batch.id });
	if (!started) {
		// Cancelled while validating; the regular cancel path settles the rows.
		await db
			.update(tables.batch)
			.set({ requestTotal: parsed.requests.length, claimedUntil: null })
			.where(
				and(
					eq(tables.batch.id, batch.id),
					eq(tables.batch.claimedUntil, lease),
				),
			);
	}
}

/** True while `lease` is still the batch's current lease. */
async function holdsLease(batchId: string, lease: Date): Promise<boolean> {
	const rows = await db
		.select({ id: tables.batch.id })
		.from(tables.batch)
		.where(
			and(eq(tables.batch.id, batchId), eq(tables.batch.claimedUntil, lease)),
		);
	return rows.length > 0;
}

/**
 * Fails requests whose worker died mid-call. The gateway may already have run
 * and billed them, so they are not sent again.
 */
export async function recoverStaleRequests(now = new Date()): Promise<number> {
	const recovered = await db
		.update(tables.batchRequest)
		.set({
			status: "failed",
			claimedUntil: null,
			completedAt: now,
			error: INTERRUPTED_ERROR,
		})
		.where(
			and(
				eq(tables.batchRequest.status, "in_progress"),
				lt(tables.batchRequest.claimedUntil, now),
			),
		)
		.returning({ batchId: tables.batchRequest.batchId });
	if (recovered.length > 0) {
		logger.warn("Batch API failed requests whose worker lease ran out", {
			count: recovered.length,
			batchIds: [...new Set(recovered.map((row) => row.batchId))].slice(0, 20),
		});
	}
	return recovered.length;
}

/** Cancels and expires pending requests of cancelling and expired batches. */
export async function settleStoppedBatches(now = new Date()) {
	const cancelling = await db
		.select({ id: tables.batch.id })
		.from(tables.batch)
		.where(eq(tables.batch.status, "cancelling"));
	for (const { id } of cancelling) {
		await db
			.update(tables.batchRequest)
			.set({
				status: "cancelled",
				completedAt: now,
				error: {
					code: "batch_cancelled",
					message: "The batch was cancelled before this request ran.",
				},
			})
			.where(
				and(
					eq(tables.batchRequest.batchId, id),
					eq(tables.batchRequest.status, "pending"),
				),
			);
	}

	const expired = await db
		.select({ id: tables.batch.id, status: tables.batch.status })
		.from(tables.batch)
		.where(
			and(
				inArray(tables.batch.status, ["validating", "in_progress"]),
				lte(tables.batch.expiresAt, now),
			),
		);
	for (const { id, status } of expired) {
		if (status === "validating") {
			// Skipped while a validator holds the lease; retried next round.
			await endUnstartedBatch(id, null, {
				status: "expired",
				errors: [
					{
						code: "batch_expired",
						message: "The batch could not be validated within its window.",
					},
				],
			});
			continue;
		}
		await db
			.update(tables.batchRequest)
			.set({
				status: "expired",
				completedAt: now,
				error: {
					code: "batch_expired",
					message: "This request did not run within the completion window.",
				},
			})
			.where(
				and(
					eq(tables.batchRequest.batchId, id),
					eq(tables.batchRequest.status, "pending"),
				),
			);
	}
}

interface ClaimCandidate {
	id: string;
	organization_id: string;
	in_flight: number;
}

/**
 * Claims due requests fairly: slots are split across organizations first, then
 * across each organization's batches, so one organization's many or large
 * batches cannot stall everyone else. At most `perBatch` requests run per
 * batch and `perOrg` per organization, fleet-wide; `limit` caps the round.
 */
export async function claimBatchRequests(
	limit: number,
	perBatch: number = BATCH_REQUEST_CONCURRENCY_PER_BATCH,
	now = new Date(),
	perOrg: number = BATCH_REQUEST_CONCURRENCY_PER_ORG,
): Promise<ClaimedBatchRequest[]> {
	if (limit <= 0) {
		return [];
	}
	const nowText = now.toISOString();
	// Only batches with due requests, at most CLAIM_SCAN_PER_ORG per
	// organization, with their running requests counted in the same query.
	const result = await db.execute<ClaimCandidate>(sql`
		select ranked.id, ranked.organization_id, (
			select count(*)::int from ${tables.batchRequest} running
			where running.batch_id = ranked.id and running.status = 'in_progress'
		) as in_flight
		from (
			select b.id, b.organization_id, b.created_at, row_number() over (
				partition by b.organization_id order by b.created_at, b.id
			) as org_rank
			from ${tables.batch} b
			where b.status = 'in_progress'
			and b.expires_at > ${nowText}::timestamp
			and exists (
				select 1 from ${tables.batchRequest} due
				where due.batch_id = b.id and due.status = 'pending'
				and due.next_attempt_at <= ${nowText}::timestamp
			)
		) ranked
		where ranked.org_rank <= ${CLAIM_SCAN_PER_ORG}
		order by ranked.organization_id, ranked.created_at, ranked.id
	`);
	// Running requests per organization across all of its batches, not only the
	// candidates above.
	const running = await db
		.select({
			organizationId: tables.batch.organizationId,
			count: sql<number>`count(*)::int`,
		})
		.from(tables.batchRequest)
		.innerJoin(tables.batch, eq(tables.batch.id, tables.batchRequest.batchId))
		.where(eq(tables.batchRequest.status, "in_progress"))
		.groupBy(tables.batch.organizationId);
	const runningByOrg = new Map(
		running.map((row) => [row.organizationId, Number(row.count)]),
	);
	const byOrg = new Map<string, ClaimCandidate[]>();
	for (const row of result.rows) {
		const list = byOrg.get(row.organization_id) ?? [];
		list.push({ ...row, in_flight: Number(row.in_flight) });
		byOrg.set(row.organization_id, list);
	}
	// Rotate the starting organization and batch every round.
	const rotation = claimRotation++;
	const orgs = rotate([...byOrg.values()], rotation);

	const claimed: ClaimedBatchRequest[] = [];
	for (const [orgIndex, orgBatches] of orgs.entries()) {
		const remaining = limit - claimed.length;
		if (remaining <= 0) {
			break;
		}
		const orgShare = Math.min(
			Math.ceil(remaining / (orgs.length - orgIndex)),
			perOrg - (runningByOrg.get(orgBatches[0].organization_id) ?? 0),
		);
		const batches = rotate(orgBatches, rotation);
		let orgClaimed = 0;
		for (const [batchIndex, batch] of batches.entries()) {
			const orgRemaining = orgShare - orgClaimed;
			if (orgRemaining <= 0) {
				break;
			}
			const take = Math.min(
				Math.ceil(orgRemaining / (batches.length - batchIndex)),
				perBatch - batch.in_flight,
			);
			if (take <= 0) {
				continue;
			}
			const rows = await claimFromBatch(batch.id, take, now);
			orgClaimed += rows.length;
			claimed.push(...rows);
		}
	}
	return claimed;
}

function rotate<T>(items: T[], by: number): T[] {
	if (items.length === 0) {
		return items;
	}
	const offset = by % items.length;
	return [...items.slice(offset), ...items.slice(0, offset)];
}

async function claimFromBatch(
	batchId: string,
	take: number,
	now: Date,
): Promise<ClaimedBatchRequest[]> {
	return await db.transaction(async (tx) => {
		const due = await tx
			.select({ id: tables.batchRequest.id })
			.from(tables.batchRequest)
			.where(
				and(
					eq(tables.batchRequest.batchId, batchId),
					eq(tables.batchRequest.status, "pending"),
					lte(tables.batchRequest.nextAttemptAt, now),
				),
			)
			.orderBy(
				asc(tables.batchRequest.nextAttemptAt),
				asc(tables.batchRequest.lineNumber),
			)
			.limit(take)
			.for("update", { skipLocked: true });
		if (due.length === 0) {
			return [];
		}
		return await tx
			.update(tables.batchRequest)
			.set({
				status: "in_progress",
				attempts: sql`${tables.batchRequest.attempts} + 1`,
				claimedUntil: new Date(now.getTime() + REQUEST_LEASE_MS),
			})
			.where(
				inArray(
					tables.batchRequest.id,
					due.map((row) => row.id),
				),
			)
			.returning({
				id: tables.batchRequest.id,
				batchId: tables.batchRequest.batchId,
				body: tables.batchRequest.body,
				attempts: tables.batchRequest.attempts,
			});
	});
}

interface BatchCallContext {
	token: string;
	endpoint: string;
	clientIp: string | null;
}

async function loadCallContext(
	batchId: string,
): Promise<BatchCallContext | null> {
	const [row] = await db
		.select({
			endpoint: tables.batch.endpoint,
			clientIp: tables.batch.clientIp,
			organizationId: tables.batch.organizationId,
			encryptedToken: tables.batchCredential.encryptedToken,
		})
		.from(tables.batch)
		.innerJoin(
			tables.batchCredential,
			eq(tables.batchCredential.batchId, tables.batch.id),
		)
		.where(eq(tables.batch.id, batchId));
	if (!row) {
		return null;
	}
	let token: string;
	try {
		token = decryptProviderKey(
			row.encryptedToken,
			credentialRowId(batchId),
			row.organizationId,
		);
	} catch (error) {
		logBatchError("credential decryption", error);
		return null;
	}
	return { token, endpoint: row.endpoint, clientIp: row.clientIp };
}

function isUndelivered(error: unknown): boolean {
	for (
		let current: unknown = error;
		current instanceof Error;
		current = current.cause
	) {
		const code = (current as Error & { code?: unknown }).code;
		if (typeof code === "string" && UNDELIVERED_ERROR_CODES.has(code)) {
			return true;
		}
	}
	return false;
}

/** Spreads requests requeued together so they do not all come due at once. */
function withJitter(delayMs: number): Date {
	const jitterMs = Math.floor(randomFloat() * delayMs * RETRY_JITTER);
	return new Date(Date.now() + delayMs + jitterMs);
}

function retryDelayMs(attempts: number): number {
	const factor = 2 ** Math.max(attempts - 1, 0);
	return Math.min(RETRY_BASE_DELAY_MS * factor, MAX_RETRY_DELAY_MS);
}

function retryAfterMs(response: Response): number {
	const header = response.headers.get("retry-after");
	const seconds = header ? Number(header) : Number.NaN;
	return Number.isFinite(seconds) && seconds > 0
		? Math.min(seconds * MS_PER_SECOND, MAX_RETRY_DELAY_MS)
		: THROTTLE_DELAY_MS;
}

/** The `error.code` of a gateway error body, if it is a string. */
function errorCode(text: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) {
		return null;
	}
	const { error } = parsed;
	return typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
		? error.code
		: null;
}

async function settleRequest(
	request: ClaimedBatchRequest,
	update: Partial<typeof tables.batchRequest.$inferInsert>,
) {
	// The attempt guard keeps a worker that outlived its lease from overwriting
	// the result of a newer claim.
	await db
		.update(tables.batchRequest)
		.set({ claimedUntil: null, ...update })
		.where(
			and(
				eq(tables.batchRequest.id, request.id),
				eq(tables.batchRequest.status, "in_progress"),
				eq(tables.batchRequest.attempts, request.attempts),
			),
		);
}

async function failRemainingRequests(batchId: string, message: string) {
	await db
		.update(tables.batchRequest)
		.set({
			status: "failed",
			completedAt: new Date(),
			error: { code: "authentication_failed", message },
		})
		.where(
			and(
				eq(tables.batchRequest.batchId, batchId),
				eq(tables.batchRequest.status, "pending"),
			),
		);
}

/** Sends one batch request through the gateway's public API as its key. */
export async function executeBatchRequest(
	request: ClaimedBatchRequest,
	context?: BatchCallContext | null,
): Promise<void> {
	const call =
		context === undefined ? await loadCallContext(request.batchId) : context;
	if (!call) {
		const message =
			"The API key that created this batch is no longer available.";
		await settleRequest(request, {
			status: "failed",
			completedAt: new Date(),
			error: { code: "authentication_failed", message },
		});
		await failRemainingRequests(request.batchId, message);
		return;
	}

	let response: Response;
	try {
		response = await fetch(
			`${getGatewayApiBaseUrl()}${call.endpoint.replace(/^\/v1/, "")}`,
			{
				method: "POST",
				headers: batchGatewayHeaders({
					token: call.token,
					requestId: request.id,
					clientIp: call.clientIp,
				}),
				body: request.body,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);
	} catch (error) {
		// Only errors that prove nothing reached the gateway are retried; a
		// timeout or reset may follow a billed call.
		const message = error instanceof Error ? error.message : String(error);
		if (isUndelivered(error) && request.attempts < MAX_DELIVERY_ATTEMPTS) {
			await settleRequest(request, {
				status: "pending",
				nextAttemptAt: withJitter(retryDelayMs(request.attempts)),
			});
		} else {
			await settleRequest(request, {
				status: "failed",
				completedAt: new Date(),
				error: { code: "request_failed", message },
			});
		}
		return;
	}

	const requestId = response.headers.get("x-request-id") ?? request.id;
	const status = response.status;
	let text: string;
	try {
		text = await response.text();
	} catch (error) {
		// The gateway answered, so the request ran; only its body was lost.
		await settleRequest(request, {
			status: "failed",
			completedAt: new Date(),
			responseStatus: status,
			requestId,
			error: {
				code: "response_read_failed",
				message: error instanceof Error ? error.message : String(error),
			},
		});
		return;
	}

	const code = status >= 400 ? errorCode(text) : null;
	const usageLimited =
		(status === 401 || status === 403) &&
		code !== null &&
		USAGE_LIMIT_ERROR_CODES.has(code);
	if (THROTTLED_STATUSES.has(status) || usageLimited) {
		// Rejected before any work, so not billed and not counted as an attempt.
		// The request waits until the limit resets or credits are added, within
		// the completion window.
		await settleRequest(request, {
			status: "pending",
			attempts: Math.max(request.attempts - 1, 0),
			nextAttemptAt: withJitter(
				usageLimited ? USAGE_LIMIT_DELAY_MS : retryAfterMs(response),
			),
		});
		return;
	}

	const retryable =
		RETRYABLE_STATUSES.has(status) ||
		(status === 500 && code === RETRYABLE_500_CODE);
	if (retryable && request.attempts < MAX_DELIVERY_ATTEMPTS) {
		await settleRequest(request, {
			status: "pending",
			nextAttemptAt: withJitter(retryDelayMs(request.attempts)),
		});
		return;
	}

	const ok = status >= 200 && status < 300;
	const responseBody = toStoredResponseBody(text);
	const tooLarge =
		Buffer.byteLength(responseBody) > BATCH_MAX_STORED_RESPONSE_BYTES;
	await settleRequest(request, {
		status: ok && !tooLarge ? "completed" : "failed",
		completedAt: new Date(),
		responseStatus: status,
		responseBody: tooLarge ? null : responseBody,
		requestId,
		...(tooLarge && {
			error: {
				code: "response_too_large",
				message: `The response exceeded ${BATCH_MAX_STORED_RESPONSE_BYTES} bytes and was not stored.`,
			},
		}),
	});
	if (status === 401) {
		// Any other 401 means the key no longer authenticates: stop the batch
		// and drop its stored token instead of retrying for the whole window.
		await deleteCredential(request.batchId);
		await failRemainingRequests(
			request.batchId,
			"The API key that created this batch was rejected.",
		);
	}
}

export const BATCH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export interface BatchLoopState {
	/** Requests still running, shared across iterations of the loop. */
	inFlight: Set<Promise<void>>;
	running: Map<Promise<void>, ClaimedBatchRequest>;
	lastCleanupAt: number;
	lastHealthCheckAt: number;
}

export function createBatchLoopState(): BatchLoopState {
	return {
		inFlight: new Set(),
		running: new Map(),
		lastCleanupAt: 0,
		lastHealthCheckAt: 0,
	};
}

/**
 * Waits up to `timeoutMs` for running requests, then fails the ones still
 * running instead of leaving them to be retried after the lease.
 */
export async function drainBatchRequests(
	state: BatchLoopState,
	timeoutMs: number,
): Promise<number> {
	let timer: NodeJS.Timeout | undefined;
	await Promise.race([
		Promise.allSettled([...state.inFlight]),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, timeoutMs);
		}),
	]);
	clearTimeout(timer);
	const interrupted = [...state.running.values()];
	for (const request of interrupted) {
		await settleRequest(request, {
			status: "failed",
			completedAt: new Date(),
			error: INTERRUPTED_ERROR,
		});
	}
	return interrupted.length;
}

/**
 * Claims as many requests as free slots allow and starts them without waiting.
 * The credential is decrypted once per batch per claim round. Nothing is
 * claimed once the worker is stopping.
 */
export async function startBatchRequests(
	state: BatchLoopState,
	limit: number = BATCH_REQUEST_CONCURRENCY,
): Promise<number> {
	if (isStopRequested()) {
		return 0;
	}
	const claimed = await claimBatchRequests(limit - state.inFlight.size);
	const contexts = new Map<string, Promise<BatchCallContext | null>>();
	for (const request of claimed) {
		let context = contexts.get(request.batchId);
		if (!context) {
			context = loadCallContext(request.batchId);
			contexts.set(request.batchId, context);
		}
		const pending = context;
		const task: Promise<void> = (async () => {
			await executeBatchRequest(request, await pending);
		})()
			.catch((error: unknown) => logBatchError("request", error))
			.finally(() => {
				state.inFlight.delete(task);
				state.running.delete(task);
			});
		state.inFlight.add(task);
		state.running.set(task, request);
	}
	return claimed.length;
}

/** One pass of the worker's batch loop: housekeeping, cleanup, new requests. */
export async function runBatchLoopIteration(
	state: BatchLoopState,
	now = new Date(),
): Promise<number> {
	await runBatchHousekeeping(now);
	if (now.getTime() - state.lastCleanupAt >= BATCH_CLEANUP_INTERVAL_MS) {
		await cleanupExpiredBatchData(now);
		state.lastCleanupAt = now.getTime();
	}
	if (now.getTime() - state.lastHealthCheckAt >= HEALTH_CHECK_INTERVAL_MS) {
		await reportStuckBatches(now);
		state.lastHealthCheckAt = now.getTime();
	}
	return await startBatchRequests(state);
}

/**
 * Drops stored tokens of keys that were disabled, deleted or expired, and fails
 * the remaining requests of running batches that no longer have a token (the
 * API also drops them when a key is disabled, deleted or rolled).
 */
export async function revokeUnusableCredentials(now = new Date()) {
	await db.delete(tables.batchCredential).where(
		inArray(
			tables.batchCredential.batchId,
			db
				.select({ batchId: tables.batchCredential.batchId })
				.from(tables.batchCredential)
				.innerJoin(
					tables.apiKey,
					eq(tables.apiKey.id, tables.batchCredential.apiKeyId),
				)
				.where(
					or(
						ne(tables.apiKey.status, "active"),
						lte(tables.apiKey.expiresAt, now),
					),
				),
		),
	);
	const orphaned = await db
		.select({ id: tables.batch.id })
		.from(tables.batch)
		.where(
			and(
				inArray(tables.batch.status, ["in_progress", "cancelling"]),
				sql`not exists (
					select 1 from ${tables.batchCredential}
					where ${tables.batchCredential.batchId} = ${tables.batch.id}
				)`,
				sql`exists (
					select 1 from ${tables.batchRequest}
					where ${tables.batchRequest.batchId} = ${tables.batch.id}
					and ${tables.batchRequest.status} = 'pending'
				)`,
			),
		);
	for (const { id } of orphaned) {
		await failRemainingRequests(
			id,
			"The API key that created this batch was disabled, deleted or rolled.",
		);
	}
}

interface FileStats {
	bytes: number;
	count: number;
}

interface FinalizeStats {
	output: FileStats;
	errors: FileStats;
	failed: number;
	expired: number;
}

/**
 * Reads a finishing batch's settled requests once, in line order, sizing its
 * output and error files. Returns null once `lease` is no longer held; the
 * lease is renewed after every page so a large batch keeps it.
 */
async function collectFinalizeStats(
	batchId: string,
	lease: { until: Date },
): Promise<FinalizeStats | null> {
	const stats: FinalizeStats = {
		output: { bytes: 0, count: 0 },
		errors: { bytes: 0, count: 0 },
		failed: 0,
		expired: 0,
	};
	let lastLine = 0;
	for (;;) {
		const rows = await db
			.select({
				id: tables.batchRequest.id,
				lineNumber: tables.batchRequest.lineNumber,
				customId: tables.batchRequest.customId,
				status: tables.batchRequest.status,
				responseStatus: tables.batchRequest.responseStatus,
				responseBody: tables.batchRequest.responseBody,
				requestId: tables.batchRequest.requestId,
				error: tables.batchRequest.error,
			})
			.from(tables.batchRequest)
			.where(
				and(
					eq(tables.batchRequest.batchId, batchId),
					inArray(tables.batchRequest.status, [
						"completed",
						...TERMINAL_ERROR_STATUSES,
					]),
					gt(tables.batchRequest.lineNumber, lastLine),
				),
			)
			.orderBy(asc(tables.batchRequest.lineNumber))
			.limit(OUTPUT_PAGE_SIZE);
		for (const row of rows) {
			const file = row.status === "completed" ? stats.output : stats.errors;
			file.count++;
			file.bytes += Buffer.byteLength(
				buildBatchOutputLine({
					id: row.id,
					customId: row.customId,
					responseStatus: row.responseStatus,
					responseBody: row.responseBody,
					requestId: row.requestId,
					error: row.error
						? { code: row.error.code, message: row.error.message }
						: null,
				}),
			);
			if (row.status === "failed") {
				stats.failed++;
			} else if (row.status === "expired") {
				stats.expired++;
			}
		}
		if (rows.length < OUTPUT_PAGE_SIZE) {
			return stats;
		}
		lastLine = rows[rows.length - 1].lineNumber;
		const renewed = new Date(Date.now() + VALIDATION_LEASE_MS);
		const [held] = await db
			.update(tables.batch)
			.set({ claimedUntil: renewed })
			.where(
				and(
					eq(tables.batch.id, batchId),
					eq(tables.batch.claimedUntil, lease.until),
				),
			)
			.returning({ id: tables.batch.id });
		if (!held) {
			return null;
		}
		lease.until = renewed;
	}
}

class LeaseLostError extends Error {}

/**
 * Finishes batches with no pending or running requests left. Each batch is
 * leased, and its files and final state are written only while that lease is
 * still held, so two workers never both finalize it. Returns how many batches
 * this call finalized.
 */
export async function finalizeBatches(now = new Date()): Promise<number> {
	const candidates = await db
		.select()
		.from(tables.batch)
		.where(
			and(
				inArray(tables.batch.status, [
					"in_progress",
					"cancelling",
					"finalizing",
				]),
				sql`not exists (
					select 1 from ${tables.batchRequest}
					where ${tables.batchRequest.batchId} = ${tables.batch.id}
					and ${tables.batchRequest.status} in ('pending', 'in_progress')
				)`,
			),
		);

	let finalized = 0;
	for (const batch of candidates) {
		const lease = { until: new Date(now.getTime() + VALIDATION_LEASE_MS) };
		const claimed = await db
			.update(tables.batch)
			.set({
				status: "finalizing",
				finalizingAt: batch.finalizingAt ?? now,
				claimedUntil: lease.until,
			})
			.where(
				and(
					eq(tables.batch.id, batch.id),
					eq(tables.batch.status, batch.status),
					or(
						isNull(tables.batch.claimedUntil),
						lt(tables.batch.claimedUntil, now),
					),
				),
			)
			.returning({ id: tables.batch.id });
		if (claimed.length === 0) {
			continue;
		}
		if (batch.status === "finalizing") {
			logger.warn("Batch API resuming a finalize whose lease ran out", {
				batchId: batch.id,
			});
		}

		const stats = await collectFinalizeStats(batch.id, lease);
		if (!stats) {
			continue;
		}
		const expiresAt = new Date(now.getTime() + BATCH_FILE_TTL_MS);
		const outputFileId = stats.output.count > 0 ? newBatchFileId() : null;
		const errorFileId = stats.errors.count > 0 ? newBatchFileId() : null;
		const files: {
			id: string;
			purpose: "batch_output" | "batch_error";
			bytes: number;
			filename: string;
		}[] = [];
		if (outputFileId) {
			files.push({
				id: outputFileId,
				purpose: "batch_output",
				bytes: stats.output.bytes,
				filename: `${batch.id}_output.jsonl`,
			});
		}
		if (errorFileId) {
			files.push({
				id: errorFileId,
				purpose: "batch_error",
				bytes: stats.errors.bytes,
				filename: `${batch.id}_error.jsonl`,
			});
		}

		const wasCancelled =
			batch.status === "cancelling" || batch.cancellingAt !== null;
		const wasExpired = !wasCancelled && stats.expired > 0;
		const finalStatus = wasCancelled
			? "cancelled"
			: wasExpired
				? "expired"
				: "completed";

		try {
			await db.transaction(async (tx) => {
				const [owned] = await tx
					.update(tables.batch)
					.set({
						status: finalStatus,
						outputFileId,
						errorFileId,
						requestCompleted: stats.output.count,
						requestFailed: stats.failed,
						completedAt: finalStatus === "completed" ? now : null,
						cancelledAt: finalStatus === "cancelled" ? now : null,
						expiredAt: finalStatus === "expired" ? now : null,
						claimedUntil: null,
					})
					.where(
						and(
							eq(tables.batch.id, batch.id),
							eq(tables.batch.status, "finalizing"),
							eq(tables.batch.claimedUntil, lease.until),
						),
					)
					.returning({ id: tables.batch.id });
				if (!owned) {
					throw new LeaseLostError();
				}
				if (files.length > 0) {
					await tx.insert(tables.batchFile).values(
						files.map((file) => ({
							...file,
							organizationId: batch.organizationId,
							projectId: batch.projectId,
							apiKeyId: batch.apiKeyId,
							batchId: batch.id,
							expiresAt,
						})),
					);
				}
				await tx
					.delete(tables.batchCredential)
					.where(eq(tables.batchCredential.batchId, batch.id));
			});
		} catch (error) {
			if (error instanceof LeaseLostError) {
				logger.warn("Batch API finalize lost its lease", {
					batchId: batch.id,
				});
				continue;
			}
			throw error;
		}
		finalized++;
	}
	return finalized;
}

/**
 * Deletes expired files and batches finished more than 30 days ago, in chunks
 * until none are left or the time budget runs out.
 */
export async function cleanupExpiredBatchData(
	now = new Date(),
	budgetMs = CLEANUP_TIME_BUDGET_MS,
): Promise<{ files: number; batches: number; drained: boolean }> {
	const deadline = Date.now() + budgetMs;
	let files = 0;
	let batches = 0;
	let drained = false;
	const cutoff = new Date(now.getTime() - BATCH_FILE_TTL_MS);
	while (Date.now() < deadline && !isStopRequested()) {
		const deletedFiles = await db
			.delete(tables.batchFile)
			.where(
				inArray(
					tables.batchFile.id,
					db
						.select({ id: tables.batchFile.id })
						.from(tables.batchFile)
						.where(lt(tables.batchFile.expiresAt, now))
						.limit(CLEANUP_LIMIT),
				),
			)
			.returning({ id: tables.batchFile.id });
		files += deletedFiles.length;
		const old = await db
			.select({ id: tables.batch.id })
			.from(tables.batch)
			.where(
				and(
					inArray(tables.batch.status, [
						"completed",
						"failed",
						"expired",
						"cancelled",
					]),
					lt(tables.batch.updatedAt, cutoff),
				),
			)
			.limit(CLEANUP_BATCH_LIMIT);
		for (const { id } of old) {
			await deleteBatchRequests(id);
			await db.delete(tables.batch).where(eq(tables.batch.id, id));
		}
		batches += old.length;
		if (
			deletedFiles.length < CLEANUP_LIMIT &&
			old.length < CLEANUP_BATCH_LIMIT
		) {
			drained = true;
			break;
		}
	}
	if (files > 0 || batches > 0) {
		logger.info("Batch API cleanup deleted expired data", { files, batches });
	}
	if (!drained) {
		logger.warn("Batch API cleanup stopped with expired data left", {
			files,
			batches,
			budgetMs,
		});
	}
	return { files, batches, drained };
}

/** Logs batches stuck validating or finalizing, which should take minutes. */
export async function reportStuckBatches(now = new Date()) {
	const before = new Date(now.getTime() - STUCK_BATCH_AFTER_MS);
	const stuck = await db
		.select({ id: tables.batch.id, status: tables.batch.status })
		.from(tables.batch)
		.where(
			or(
				and(
					eq(tables.batch.status, "validating"),
					lt(tables.batch.createdAt, before),
				),
				and(
					eq(tables.batch.status, "finalizing"),
					lt(tables.batch.finalizingAt, before),
				),
			),
		)
		.limit(20);
	if (stuck.length > 0) {
		logger.warn("Batch API batches stuck validating or finalizing", {
			batches: stuck.map((row) => `${row.id}:${row.status}`),
		});
	}
	return stuck.length;
}

/** Housekeeping steps that run before requests are claimed. */
export async function runBatchHousekeeping(now = new Date()) {
	await revokeUnusableCredentials(now);
	await validatePendingBatches(now);
	await recoverStaleRequests(now);
	await settleStoppedBatches(now);
	await finalizeBatches(now);
}

export function logBatchError(step: string, error: unknown) {
	logger.error(
		`Batch API ${step} failed`,
		error instanceof Error ? error : new Error(String(error)),
	);
}
