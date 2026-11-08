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
	or,
	sql,
	deleteBatchRequests,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	BATCH_FILE_TTL_MS,
	BATCH_SOURCE,
	buildBatchOutputLine,
	newBatchFileId,
	newBatchRequestId,
	parseBatchInput,
	toStoredResponseBody,
	type BatchLineError,
} from "@llmgateway/shared/batch";
import { getClientIpHeaderName } from "@llmgateway/shared/client-ip";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { decryptProviderKey } from "@llmgateway/shared/provider-key-crypto";

const INSERT_CHUNK_SIZE = 1000;
const OUTPUT_PAGE_SIZE = 1000;
const VALIDATION_LEASE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
// Longer than the request timeout, so a live request is never reclaimed.
const REQUEST_LEASE_GRACE_MS = 5 * 60 * 1000;
const REQUEST_LEASE_MS = REQUEST_TIMEOUT_MS + REQUEST_LEASE_GRACE_MS;
const MAX_SERVER_ERROR_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 30_000;
const THROTTLE_DELAY_MS = 60_000;
const USAGE_LIMIT_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
const MAX_ACTIVE_BATCHES_PER_TICK = 50;
const CLEANUP_LIMIT = 500;
const CLEANUP_BATCH_LIMIT = 20;
const MS_PER_SECOND = 1000;

export const BATCH_REQUEST_CONCURRENCY =
	Number(process.env.BATCH_REQUEST_CONCURRENCY) || 16;
export const BATCH_REQUEST_CONCURRENCY_PER_BATCH =
	Number(process.env.BATCH_REQUEST_CONCURRENCY_PER_BATCH) || 8;

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

async function failBatch(batchId: string, errors: BatchLineError[]) {
	await db
		.update(tables.batch)
		.set({ status: "failed", failedAt: new Date(), errors, claimedUntil: null })
		.where(eq(tables.batch.id, batchId));
	await deleteBatchRequests(batchId);
	await deleteCredential(batchId);
}

/** Parses validating batches into batch_request rows. */
export async function validatePendingBatches(
	now = new Date(),
): Promise<number> {
	const claimed = await db.transaction(async (tx) => {
		const rows = await tx
			.select()
			.from(tables.batch)
			.where(
				and(
					eq(tables.batch.status, "validating"),
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
			.set({ claimedUntil: new Date(now.getTime() + VALIDATION_LEASE_MS) })
			.where(
				inArray(
					tables.batch.id,
					rows.map((row) => row.id),
				),
			);
		return rows;
	});

	for (const batch of claimed) {
		await validateBatch(batch);
	}
	return claimed.length;
}

async function validateBatch(batch: BatchRow) {
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
		await failBatch(batch.id, [
			{
				code: "input_file_missing",
				message: "The input file was deleted before the batch started.",
			},
		]);
		return;
	}

	const parsed = parseBatchInput(file.content, batch.endpoint);
	if (!parsed.ok) {
		await failBatch(batch.id, parsed.errors);
		return;
	}

	// A previous attempt may have died midway through the inserts.
	await deleteBatchRequests(batch.id);
	for (
		let start = 0;
		start < parsed.requests.length;
		start += INSERT_CHUNK_SIZE
	) {
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
			and(eq(tables.batch.id, batch.id), eq(tables.batch.status, "validating")),
		)
		.returning({ id: tables.batch.id });
	if (!started) {
		// Cancelled while validating; the regular cancel path settles the rows.
		await db
			.update(tables.batch)
			.set({ requestTotal: parsed.requests.length, claimedUntil: null })
			.where(eq(tables.batch.id, batch.id));
	}
}

/** Moves requests whose worker died mid-call back to pending. */
export async function recoverStaleRequests(now = new Date()) {
	await db
		.update(tables.batchRequest)
		.set({ status: "pending", claimedUntil: null, nextAttemptAt: now })
		.where(
			and(
				eq(tables.batchRequest.status, "in_progress"),
				lt(tables.batchRequest.claimedUntil, now),
			),
		);
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
			await failBatch(id, [
				{
					code: "batch_expired",
					message: "The batch could not be validated within its window.",
				},
			]);
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

/**
 * Claims due requests round-robin across active batches, at most `perBatch`
 * per batch and `limit` in total.
 */
export async function claimBatchRequests(
	limit: number,
	perBatch: number = BATCH_REQUEST_CONCURRENCY_PER_BATCH,
	now = new Date(),
): Promise<ClaimedBatchRequest[]> {
	if (limit <= 0) {
		return [];
	}
	const active = await db
		.select({ id: tables.batch.id })
		.from(tables.batch)
		.where(
			and(
				eq(tables.batch.status, "in_progress"),
				gt(tables.batch.expiresAt, now),
			),
		)
		.orderBy(asc(tables.batch.createdAt))
		.limit(MAX_ACTIVE_BATCHES_PER_TICK);

	const claimed: ClaimedBatchRequest[] = [];
	for (const { id: batchId } of active) {
		const remaining = limit - claimed.length;
		if (remaining <= 0) {
			break;
		}
		const inFlight = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(tables.batchRequest)
			.where(
				and(
					eq(tables.batchRequest.batchId, batchId),
					eq(tables.batchRequest.status, "in_progress"),
				),
			)
			.then((rows) => rows[0]?.count ?? 0);
		const take = Math.min(remaining, perBatch - inFlight);
		if (take <= 0) {
			continue;
		}
		const rows = await db.transaction(async (tx) => {
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
		claimed.push(...rows);
	}
	return claimed;
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

/**
 * The gateway answers 401 both for a revoked key and for a key that reached
 * its usage limit. Only the first ends the batch.
 */
async function isBatchKeyUsable(batchId: string): Promise<boolean> {
	const [row] = await db
		.select({
			status: tables.apiKey.status,
			expiresAt: tables.apiKey.expiresAt,
		})
		.from(tables.batchCredential)
		.innerJoin(
			tables.apiKey,
			eq(tables.apiKey.id, tables.batchCredential.apiKeyId),
		)
		.where(eq(tables.batchCredential.batchId, batchId));
	return (
		row !== undefined &&
		row.status === "active" &&
		(row.expiresAt === null || row.expiresAt.getTime() > Date.now())
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
				headers: {
					Authorization: `Bearer ${call.token}`,
					"Content-Type": "application/json",
					"x-request-id": request.id,
					"x-source": BATCH_SOURCE,
					...(call.clientIp
						? { [getClientIpHeaderName()]: call.clientIp }
						: {}),
				},
				body: request.body,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (request.attempts < MAX_SERVER_ERROR_ATTEMPTS) {
			await settleRequest(request, {
				status: "pending",
				nextAttemptAt: new Date(Date.now() + retryDelayMs(request.attempts)),
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

	const text = await response.text();
	const requestId = response.headers.get("x-request-id") ?? request.id;
	const status = response.status;

	const usageLimited =
		status === 401 && (await isBatchKeyUsable(request.batchId));

	if (status === 429 || status === 402 || usageLimited) {
		// Rate limits and empty balances do not count as attempts; the request
		// waits until the limit resets or credits are added, within the window.
		await settleRequest(request, {
			status: "pending",
			attempts: Math.max(request.attempts - 1, 0),
			nextAttemptAt: new Date(
				Date.now() +
					(usageLimited ? USAGE_LIMIT_DELAY_MS : retryAfterMs(response)),
			),
		});
		return;
	}

	if (status >= 500 && request.attempts < MAX_SERVER_ERROR_ATTEMPTS) {
		await settleRequest(request, {
			status: "pending",
			nextAttemptAt: new Date(Date.now() + retryDelayMs(request.attempts)),
		});
		return;
	}

	const ok = status >= 200 && status < 300;
	await settleRequest(request, {
		status: ok ? "completed" : "failed",
		completedAt: new Date(),
		responseStatus: status,
		responseBody: toStoredResponseBody(text),
		requestId,
	});
	if (status === 401) {
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
	lastCleanupAt: number;
}

export function createBatchLoopState(): BatchLoopState {
	return { inFlight: new Set(), lastCleanupAt: 0 };
}

/**
 * Claims as many requests as free slots allow and starts them without waiting.
 * The credential is decrypted once per batch per claim round.
 */
export async function startBatchRequests(
	state: BatchLoopState,
	limit: number = BATCH_REQUEST_CONCURRENCY,
): Promise<number> {
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
			});
		state.inFlight.add(task);
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
	return await startBatchRequests(state);
}

async function fileBytes(
	batchId: string,
	statuses: readonly (typeof tables.batchRequest.$inferSelect)["status"][],
): Promise<{ bytes: number; count: number }> {
	let bytes = 0;
	let count = 0;
	let lastLine = 0;
	for (;;) {
		const rows = await db
			.select({
				id: tables.batchRequest.id,
				lineNumber: tables.batchRequest.lineNumber,
				customId: tables.batchRequest.customId,
				responseStatus: tables.batchRequest.responseStatus,
				responseBody: tables.batchRequest.responseBody,
				requestId: tables.batchRequest.requestId,
				error: tables.batchRequest.error,
			})
			.from(tables.batchRequest)
			.where(
				and(
					eq(tables.batchRequest.batchId, batchId),
					inArray(tables.batchRequest.status, [...statuses]),
					gt(tables.batchRequest.lineNumber, lastLine),
				),
			)
			.orderBy(asc(tables.batchRequest.lineNumber))
			.limit(OUTPUT_PAGE_SIZE);
		for (const row of rows) {
			bytes += Buffer.byteLength(
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
		}
		count += rows.length;
		if (rows.length < OUTPUT_PAGE_SIZE) {
			return { bytes, count };
		}
		lastLine = rows[rows.length - 1].lineNumber;
	}
}

async function countRequests(
	batchId: string,
	status: (typeof tables.batchRequest.$inferSelect)["status"],
): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(tables.batchRequest)
		.where(
			and(
				eq(tables.batchRequest.batchId, batchId),
				eq(tables.batchRequest.status, status),
			),
		);
	return row?.count ?? 0;
}

/** Finishes batches with no pending or running requests left. */
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

	for (const batch of candidates) {
		const claimed = await db
			.update(tables.batch)
			.set({
				status: "finalizing",
				finalizingAt: batch.finalizingAt ?? now,
				claimedUntil: new Date(now.getTime() + VALIDATION_LEASE_MS),
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

		const output = await fileBytes(batch.id, ["completed"]);
		const errors = await fileBytes(batch.id, TERMINAL_ERROR_STATUSES);
		const failedCount = await countRequests(batch.id, "failed");
		const expiredCount = await countRequests(batch.id, "expired");
		const expiresAt = new Date(now.getTime() + BATCH_FILE_TTL_MS);
		const outputFileId = output.count > 0 ? newBatchFileId() : null;
		const errorFileId = errors.count > 0 ? newBatchFileId() : null;
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
				bytes: output.bytes,
				filename: `${batch.id}_output.jsonl`,
			});
		}
		if (errorFileId) {
			files.push({
				id: errorFileId,
				purpose: "batch_error",
				bytes: errors.bytes,
				filename: `${batch.id}_error.jsonl`,
			});
		}

		const wasCancelled =
			batch.status === "cancelling" || batch.cancellingAt !== null;
		const wasExpired = !wasCancelled && expiredCount > 0;
		const finalStatus = wasCancelled
			? "cancelled"
			: wasExpired
				? "expired"
				: "completed";

		await db.transaction(async (tx) => {
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
				.update(tables.batch)
				.set({
					status: finalStatus,
					outputFileId,
					errorFileId,
					requestCompleted: output.count,
					requestFailed: failedCount,
					completedAt: finalStatus === "completed" ? now : null,
					cancelledAt: finalStatus === "cancelled" ? now : null,
					expiredAt: finalStatus === "expired" ? now : null,
					claimedUntil: null,
				})
				.where(eq(tables.batch.id, batch.id));
			await tx
				.delete(tables.batchCredential)
				.where(eq(tables.batchCredential.batchId, batch.id));
		});
	}
	return candidates.length;
}

/** Deletes expired files and batches finished more than 30 days ago. */
export async function cleanupExpiredBatchData(now = new Date()) {
	await db
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
		);
	const cutoff = new Date(now.getTime() - BATCH_FILE_TTL_MS);
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
}

/** Housekeeping steps that run before requests are claimed. */
export async function runBatchHousekeeping(now = new Date()) {
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
