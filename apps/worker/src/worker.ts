import { Decimal } from "decimal.js";
import Stripe from "stripe";
import { z } from "zod";

import {
	closeRedisClient,
	consumeFromQueue,
	LOG_QUEUE,
	publishToQueue,
} from "@llmgateway/cache";
import {
	and,
	apiKey,
	closeDatabase,
	db,
	eq,
	inArray,
	log,
	type LogInsertData,
	lt,
	organization,
	sql,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hasErrorCode } from "@llmgateway/models";
import { calculateFees } from "@llmgateway/shared";

import { runFollowUpEmailsLoop } from "./services/follow-up-emails.js";
import {
	PROJECT_STATS_REFRESH_INTERVAL_SECONDS,
	refreshProjectHourlyStats,
} from "./services/project-stats-aggregator.js";
import {
	backfillHistoryIfNeeded,
	calculateAggregatedStatistics,
	calculateCurrentMinuteHistory,
	calculateMinutelyHistory,
} from "./services/stats-calculator.js";
import { syncProvidersAndModels } from "./services/sync-models.js";

// Configuration for current minute history calculation interval (defaults to 5 seconds)
const CURRENT_MINUTE_HISTORY_INTERVAL_SECONDS =
	Number(process.env.CURRENT_MINUTE_HISTORY_INTERVAL_SECONDS) || 5;

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
	if (!_stripe) {
		if (!process.env.STRIPE_SECRET_KEY) {
			throw new Error(
				"STRIPE_SECRET_KEY environment variable is required for Stripe operations",
			);
		}
		_stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
			apiVersion: "2025-04-30.basil",
		});
	}
	return _stripe;
}

const AUTO_TOPUP_LOCK_KEY = "auto_topup_check";
const CREDIT_PROCESSING_LOCK_KEY = "credit_processing";
const DATA_RETENTION_LOCK_KEY = "data_retention_cleanup";
const LOCK_DURATION_MINUTES = 5;

// Configuration for batch processing
const BATCH_SIZE = Number(process.env.CREDIT_BATCH_SIZE) || 100;
const BATCH_PROCESSING_INTERVAL_SECONDS =
	Number(process.env.CREDIT_BATCH_INTERVAL) || 5;

const schema = z.object({
	id: z.string(),
	request_id: z.string(),
	organization_id: z.string(),
	project_id: z.string(),
	cost: z.number().nullable(),
	cached: z.boolean(),
	api_key_id: z.string(),
	project_mode: z.enum(["api-keys", "credits", "hybrid"]),
	used_mode: z.enum(["api-keys", "credits"]),
	duration: z.number(),
	requested_model: z.string(),
	requested_provider: z.string().nullable(),
	used_model: z.string(),
	used_model_mapping: z.string().nullable(),
	used_provider: z.string(),
	response_size: z.number(),
	hasError: z.boolean().nullable(),
	data_storage_cost: z.string().nullable(),
	prompt_tokens: z.string().nullable(),
	completion_tokens: z.string().nullable(),
	total_tokens: z.string().nullable(),
	reasoning_tokens: z.string().nullable(),
	cached_tokens: z.string().nullable(),
	input_cost: z.number().nullable(),
	output_cost: z.number().nullable(),
	cached_input_cost: z.number().nullable(),
	estimated_cost: z.boolean().nullable(),
	error_details: z
		.object({
			statusCode: z.number(),
			statusText: z.string(),
			responseText: z.string(),
			cause: z.string().optional(),
		})
		.nullable(),
	trace_id: z.string().nullable(),
	unified_finish_reason: z.string().nullable(),
});

export async function acquireLock(key: string): Promise<boolean> {
	// eslint-disable-next-line no-mixed-operators
	const lockExpiry = new Date(Date.now() - LOCK_DURATION_MINUTES * 60 * 1000);

	try {
		await db.transaction(async (tx) => {
			// First, delete any expired locks with the same key
			await tx
				.delete(tables.lock)
				.where(
					and(eq(tables.lock.key, key), lt(tables.lock.updatedAt, lockExpiry)),
				);

			// Then try to insert the new lock
			try {
				await tx.insert(tables.lock).values({
					key,
				});
			} catch (insertError) {
				// If the insert failed due to a unique constraint violation within the transaction,
				// another process holds the lock - throw a special error to be caught outside
				const actualError = (insertError as any)?.cause ?? insertError;
				if (hasErrorCode(actualError) && actualError.code === "23505") {
					throw new Error("LOCK_EXISTS");
				}
				throw insertError;
			}
		});

		return true;
	} catch (error) {
		// If we threw our special error, return false
		if (error instanceof Error && error.message === "LOCK_EXISTS") {
			return false;
		}
		// Re-throw unexpected errors so they can be handled upstream
		throw error;
	}
}

async function releaseLock(key: string): Promise<void> {
	await db.delete(tables.lock).where(eq(tables.lock.key, key));
}

async function processAutoTopUp(): Promise<void> {
	const lockAcquired = await acquireLock(AUTO_TOPUP_LOCK_KEY);
	if (!lockAcquired) {
		return;
	}

	try {
		const orgsNeedingTopUp = await db.query.organization.findMany({
			where: {
				autoTopUpEnabled: {
					eq: true,
				},
			},
		});

		// Filter organizations that need top-up based on credits vs threshold
		const filteredOrgs = orgsNeedingTopUp.filter((org) => {
			const credits = Number(org.credits || 0);
			const threshold = Number(org.autoTopUpThreshold ?? 10);
			return credits < threshold;
		});

		for (const org of filteredOrgs) {
			try {
				// Check if there's a recent pending transaction
				const recentTransaction = await db.query.transaction.findFirst({
					where: {
						organizationId: {
							eq: org.id,
						},
						type: {
							eq: "credit_topup",
						},
					},
					orderBy: {
						createdAt: "desc",
					},
				});

				// Check for pending transaction within 1 hour
				if (recentTransaction) {
					// eslint-disable-next-line no-mixed-operators
					const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
					if (
						recentTransaction.createdAt > oneHourAgo &&
						recentTransaction.status === "pending"
					) {
						logger.info(
							`Skipping auto top-up for organization ${org.id}: pending transaction exists`,
						);
						continue;
					}
				}

				// Check for exponential backoff based on payment failure count
				// Backoff intervals: 1h, 2h, 4h, 8h, 16h, 24h (capped)
				if (org.lastPaymentFailureAt && (org.paymentFailureCount ?? 0) > 0) {
					const failureCount = org.paymentFailureCount ?? 0;
					const baseBackoffHours = 1;
					const maxBackoffHours = 24;
					const backoffHours = Math.min(
						baseBackoffHours * Math.pow(2, failureCount - 1),
						maxBackoffHours,
					);
					const backoffMs = backoffHours * 60 * 60 * 1000;
					const nextRetryTime = new Date(
						org.lastPaymentFailureAt.getTime() + backoffMs,
					);

					if (new Date() < nextRetryTime) {
						logger.info(
							`Skipping auto top-up for organization ${org.id}: in backoff period (${failureCount} failures, next retry at ${nextRetryTime.toISOString()})`,
						);
						continue;
					}
				}

				const defaultPaymentMethod = await db.query.paymentMethod.findFirst({
					where: {
						organizationId: {
							eq: org.id,
						},
						isDefault: {
							eq: true,
						},
					},
				});

				if (!defaultPaymentMethod) {
					logger.info(
						`No default payment method for organization ${org.id}, skipping auto top-up`,
					);
					continue;
				}

				const topUpAmount = Number(org.autoTopUpAmount ?? "10");

				// Get the first user associated with this organization for email metadata
				const orgUser = await db.query.userOrganization.findFirst({
					where: {
						organizationId: {
							eq: org.id,
						},
					},
					with: {
						user: true,
					},
				});

				// Use centralized fee calculator
				const feeBreakdown = calculateFees({
					amount: topUpAmount,
				});

				// Insert pending transaction before creating payment intent
				const pendingTransaction = await db
					.insert(tables.transaction)
					.values({
						organizationId: org.id,
						type: "credit_topup",
						creditAmount: feeBreakdown.baseAmount.toString(),
						amount: feeBreakdown.totalAmount.toString(),
						currency: "USD",
						status: "pending",
						description: `Auto top-up for ${topUpAmount} USD (total: ${feeBreakdown.totalAmount} including fees)`,
					})
					.returning()
					.then((rows) => rows[0]);

				logger.info(
					`Created pending transaction ${pendingTransaction.id} for organization ${org.id}`,
				);

				try {
					const paymentIntent = await getStripe().paymentIntents.create({
						amount: Math.round(feeBreakdown.totalAmount * 100),
						currency: "usd",
						description: `Auto top-up for ${topUpAmount} USD (total: ${feeBreakdown.totalAmount} including fees)`,
						payment_method: defaultPaymentMethod.stripePaymentMethodId,
						customer: org.stripeCustomerId!,
						confirm: true,
						off_session: true,
						metadata: {
							organizationId: org.id,
							autoTopUp: "true",
							transactionId: pendingTransaction.id,
							baseAmount: feeBreakdown.baseAmount.toString(),
							platformFee: feeBreakdown.platformFee.toString(),
							...(orgUser?.user?.email && { userEmail: orgUser.user.email }),
						},
					});

					// Update transaction with Stripe payment intent ID
					await db
						.update(tables.transaction)
						.set({
							stripePaymentIntentId: paymentIntent.id,
							description: `Auto top-up for ${topUpAmount} USD (total: ${feeBreakdown.totalAmount} including fees)`,
						})
						.where(eq(tables.transaction.id, pendingTransaction.id));

					if (paymentIntent.status === "succeeded") {
						logger.info(
							`Auto top-up payment intent succeeded immediately for organization ${org.id}: $${topUpAmount}`,
						);
						// Note: The webhook will handle updating the transaction status and adding credits
					} else if (paymentIntent.status === "requires_action") {
						logger.info(
							`Auto top-up requires action for organization ${org.id}: ${paymentIntent.status}`,
						);
					} else {
						logger.error(
							`Auto top-up payment intent failed for organization ${org.id}: ${paymentIntent.status}`,
						);
						// Mark transaction as failed
						await db
							.update(tables.transaction)
							.set({
								status: "failed",
								description: `Auto top-up failed: ${paymentIntent.status}`,
							})
							.where(eq(tables.transaction.id, pendingTransaction.id));
					}
				} catch (stripeError) {
					logger.error(
						`Stripe error for organization ${org.id}`,
						stripeError instanceof Error
							? stripeError
							: new Error(String(stripeError)),
					);
					// Mark transaction as failed
					await db
						.update(tables.transaction)
						.set({
							status: "failed",
							description: `Auto top-up failed: ${stripeError instanceof Error ? stripeError.message : "Unknown error"}`,
						})
						.where(eq(tables.transaction.id, pendingTransaction.id));
				}
			} catch (error) {
				logger.error(
					`Error processing auto top-up for organization ${org.id}`,
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}
	} finally {
		await releaseLock(AUTO_TOPUP_LOCK_KEY);
	}
}

export async function cleanupExpiredLogData(): Promise<void> {
	// Check if data retention cleanup is enabled
	if (process.env.ENABLE_DATA_RETENTION_CLEANUP !== "true") {
		logger.info(
			"Data retention cleanup is disabled. Set ENABLE_DATA_RETENTION_CLEANUP=true to enable.",
		);
		return;
	}

	const lockAcquired = await acquireLock(DATA_RETENTION_LOCK_KEY);
	if (!lockAcquired) {
		return;
	}

	try {
		logger.info("Starting data retention cleanup...");

		// Unified retention period - 30 days for all users
		const RETENTION_DAYS = 30;
		const CLEANUP_BATCH_SIZE = 10000;

		const now = new Date();

		// Calculate cutoff date (30 days ago)
		const cutoffDate = new Date(
			// eslint-disable-next-line no-mixed-operators
			now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
		);

		let totalCleaned = 0;

		// Process all organizations in batches (no plan distinction)
		let hasMoreRecords = true;
		while (hasMoreRecords) {
			const batchResult = await db.transaction(async (tx) => {
				// Hint the planner to prefer index scans for this transaction.
				// Without this, PostgreSQL's default random_page_cost=4 causes it to
				// choose a sequential scan over the partial index, even though the index
				// is far more efficient (scanning ~500 rows vs ~11.5M rows).
				// SET LOCAL resets automatically when the transaction commits.
				await tx.execute(sql`SET LOCAL random_page_cost = 1.1`);

				// Find IDs of records to clean up (with LIMIT for batching)
				// IMPORTANT: Use raw SQL for the boolean condition to match the partial index exactly
				// (parameterized values like $20 prevent PostgreSQL from using partial indexes)
				const recordsToClean = await tx
					.select({ id: log.id })
					.from(log)
					.where(
						and(
							lt(log.createdAt, cutoffDate),
							sql`${log.dataRetentionCleanedUp} = false`,
						),
					)
					.limit(CLEANUP_BATCH_SIZE)
					.for("update", { skipLocked: true });

				if (recordsToClean.length === 0) {
					return 0;
				}

				const idsToClean = recordsToClean.map((r) => r.id);

				// Clean up the batch
				await tx
					.update(log)
					.set({
						messages: null,
						content: null,
						reasoningContent: null,
						tools: null,
						toolChoice: null,
						toolResults: null,
						customHeaders: null,
						rawRequest: null,
						rawResponse: null,
						upstreamRequest: null,
						upstreamResponse: null,
						userAgent: null,
						dataRetentionCleanedUp: true,
					})
					.where(inArray(log.id, idsToClean));

				return recordsToClean.length;
			});

			totalCleaned += batchResult;

			if (batchResult < CLEANUP_BATCH_SIZE) {
				hasMoreRecords = false;
			}

			if (batchResult > 0) {
				logger.info(`Cleaned up ${batchResult} logs in batch`);
			}
		}

		if (totalCleaned > 0) {
			logger.info(
				`Total cleaned up verbose data from ${totalCleaned} logs (older than ${RETENTION_DAYS} days)`,
			);
		}

		logger.info("Data retention cleanup completed successfully");
	} catch (error) {
		logger.error(
			"Error during data retention cleanup",
			error instanceof Error ? error : new Error(String(error)),
		);
	} finally {
		await releaseLock(DATA_RETENTION_LOCK_KEY);
	}
}

export async function batchProcessLogs(): Promise<void> {
	const lockAcquired = await acquireLock(CREDIT_PROCESSING_LOCK_KEY);
	if (!lockAcquired) {
		return;
	}

	try {
		await db.transaction(async (tx) => {
			// Get unprocessed logs with row-level locking to prevent concurrent processing
			const rows = await tx
				.select({
					id: log.id,
					request_id: log.requestId,
					organization_id: log.organizationId,
					project_id: log.projectId,
					cost: log.cost,
					cached: log.cached,
					api_key_id: log.apiKeyId,
					project_mode: tables.project.mode,
					used_mode: log.usedMode,
					duration: log.duration,
					requested_model: log.requestedModel,
					requested_provider: log.requestedProvider,
					used_model: log.usedModel,
					used_model_mapping: log.usedModelMapping,
					used_provider: log.usedProvider,
					response_size: log.responseSize,
					hasError: log.hasError,
					data_storage_cost: log.dataStorageCost,
					prompt_tokens: log.promptTokens,
					completion_tokens: log.completionTokens,
					total_tokens: log.totalTokens,
					reasoning_tokens: log.reasoningTokens,
					cached_tokens: log.cachedTokens,
					input_cost: log.inputCost,
					output_cost: log.outputCost,
					cached_input_cost: log.cachedInputCost,
					estimated_cost: log.estimatedCost,
					error_details: log.errorDetails,
					trace_id: log.traceId,
					unified_finish_reason: log.unifiedFinishReason,
				})
				.from(log)
				.leftJoin(tables.project, eq(tables.project.id, log.projectId))
				.where(sql`${log.processedAt} IS NULL`)
				.orderBy(sql`${log.createdAt} ASC`)
				.limit(BATCH_SIZE)
				.for("update", { of: [log], skipLocked: true });
			const unprocessedLogs = { rows };

			if (unprocessedLogs.rows.length === 0) {
				return;
			}

			logger.info(
				`Processing ${unprocessedLogs.rows.length} logs for credit deduction and API key usage`,
			);

			// Group logs by organization and api key to calculate total costs
			// Use Decimal.js to avoid floating point rounding errors
			const orgCosts = new Map<string, Decimal>();
			const apiKeyCosts = new Map<string, Decimal>();
			const logIds: string[] = [];

			for (const raw of unprocessedLogs.rows) {
				const row = schema.parse(raw);

				// Log each processed log with JSON format
				logger.info("Processing log", {
					kind: "log-process",
					status: row.hasError ? "error" : row.cached ? "cached" : "success",
					logId: row.id,
					requestId: row.request_id,
					organizationId: row.organization_id,
					projectId: row.project_id,
					cost: row.cost,
					inputCost: row.input_cost,
					outputCost: row.output_cost,
					cachedInputCost: row.cached_input_cost,
					estimatedCost: row.estimated_cost,
					error: !!row.hasError,
					cached: row.cached,
					apiKeyId: row.api_key_id,
					projectMode: row.project_mode,
					usedMode: row.used_mode,
					duration: row.duration,
					requestedModel: row.requested_model,
					requestedProvider: row.requested_provider,
					usedModel: row.used_model,
					usedModelMapping: row.used_model_mapping,
					usedProvider: row.used_provider,
					responseSize: row.response_size,
					promptTokens: row.prompt_tokens,
					completionTokens: row.completion_tokens,
					totalTokens: row.total_tokens,
					reasoningTokens: row.reasoning_tokens,
					cachedTokens: row.cached_tokens,
					errorDetails: row.error_details,
					traceId: row.trace_id,
					unifiedFinishReason: row.unified_finish_reason,
				});

				if (row.cost && row.cost > 0 && !row.cached) {
					// Always update API key usage for non-cached logs with cost
					const currentApiKeyCost =
						apiKeyCosts.get(row.api_key_id) ?? new Decimal(0);
					apiKeyCosts.set(
						row.api_key_id,
						currentApiKeyCost.plus(new Decimal(row.cost)),
					);

					// Deduct organization credits based on mode:
					// - Credits mode: deduct full cost (includes request cost + storage cost)
					// - API keys mode: only deduct storage cost (data retention billing)
					if (row.used_mode === "credits") {
						// In credits mode, deduct the full cost
						const currentOrgCost =
							orgCosts.get(row.organization_id) ?? new Decimal(0);
						orgCosts.set(
							row.organization_id,
							currentOrgCost.plus(new Decimal(row.cost)),
						);
					} else if (row.used_mode === "api-keys") {
						// In API keys mode, only deduct storage cost (data retention billing)
						if (row.data_storage_cost) {
							const storageCost = new Decimal(row.data_storage_cost);
							if (storageCost.greaterThan(0)) {
								const currentOrgCost =
									orgCosts.get(row.organization_id) ?? new Decimal(0);
								orgCosts.set(
									row.organization_id,
									currentOrgCost.plus(storageCost),
								);
							}
						}
					}
				}

				logIds.push(row.id);
			}

			// Batch update organization credits within the same transaction
			// Also calculate referral earnings (1% of spent credits)
			// Dev plan credits are deducted first, then regular credits
			const referralEarnings = new Map<string, Decimal>();

			for (const [orgId, totalCost] of orgCosts.entries()) {
				if (totalCost.greaterThan(0)) {
					let remainingCost = totalCost;

					// Fetch the organization to check for dev plan
					const org = await tx.query.organization.findFirst({
						where: { id: { eq: orgId } },
					});

					// First, try to deduct from dev plan credits if available
					if (org && org.devPlan !== "none") {
						const devPlanCreditsLimit = new Decimal(
							org.devPlanCreditsLimit || "0",
						);
						const devPlanCreditsUsed = new Decimal(
							org.devPlanCreditsUsed || "0",
						);
						const devPlanRemaining =
							devPlanCreditsLimit.minus(devPlanCreditsUsed);

						if (devPlanRemaining.greaterThan(0)) {
							const deductFromDevPlan = Decimal.min(
								remainingCost,
								devPlanRemaining,
							);
							const deductNumber = deductFromDevPlan.toNumber();

							await tx
								.update(organization)
								.set({
									devPlanCreditsUsed: sql`${organization.devPlanCreditsUsed} + ${deductNumber}`,
								})
								.where(eq(organization.id, orgId));

							logger.debug(
								`Deducted ${deductNumber} dev plan credits from organization ${orgId}`,
							);

							remainingCost = remainingCost.minus(deductFromDevPlan);
						}
					}

					// Deduct any remaining cost from regular credits
					if (remainingCost.greaterThan(0)) {
						const costNumber = remainingCost.toNumber();
						await tx
							.update(organization)
							.set({
								credits: sql`${organization.credits} - ${costNumber}`,
							})
							.where(eq(organization.id, orgId));

						logger.debug(
							`Deducted ${costNumber} regular credits from organization ${orgId}`,
						);
					}

					// Check if this org was referred and calculate 1% referral earnings
					// Based on total cost (both dev plan and regular credits)
					const referral = await tx.query.referral.findFirst({
						where: {
							referredOrganizationId: { eq: orgId },
						},
					});

					if (referral) {
						const earnings = totalCost.times(0.01);
						const currentEarnings =
							referralEarnings.get(referral.referrerOrganizationId) ??
							new Decimal(0);
						referralEarnings.set(
							referral.referrerOrganizationId,
							currentEarnings.plus(earnings),
						);
					}
				}
			}

			// Apply referral earnings to referrer organizations
			for (const [referrerOrgId, earnings] of referralEarnings.entries()) {
				if (earnings.greaterThan(0)) {
					const earningsNumber = earnings.toNumber();
					await tx
						.update(organization)
						.set({
							credits: sql`${organization.credits} + ${earningsNumber}`,
							referralEarnings: sql`${organization.referralEarnings} + ${earningsNumber}`,
						})
						.where(eq(organization.id, referrerOrgId));

					logger.info(
						`Added ${earningsNumber} referral credits to organization ${referrerOrgId}`,
					);
				}
			}

			// Batch update API key usage within the same transaction
			for (const [apiKeyId, totalCost] of apiKeyCosts.entries()) {
				if (totalCost.greaterThan(0)) {
					const costNumber = totalCost.toNumber();
					await tx
						.update(apiKey)
						.set({
							usage: sql`${apiKey.usage} + ${costNumber}`,
						})
						.where(eq(apiKey.id, apiKeyId));

					logger.debug(`Added ${costNumber} usage to API key ${apiKeyId}`);
				}
			}

			// Mark all logs as processed within the same transaction
			await tx
				.update(log)
				.set({
					processedAt: new Date(),
				})
				.where(inArray(log.id, logIds));

			logger.debug(`Marked ${logIds.length} logs as processed`);
		});
	} catch (error) {
		logger.error(
			"Error processing batch credit deductions",
			error instanceof Error ? error : new Error(String(error)),
		);
	} finally {
		await releaseLock(CREDIT_PROCESSING_LOCK_KEY);
	}
}

export async function processLogQueue(): Promise<void> {
	const message = await consumeFromQueue(LOG_QUEUE);

	if (!message) {
		return;
	}

	const MAX_RETRIES = 5;

	try {
		const logData = message.map((i) => JSON.parse(i) as LogInsertData);

		const processedLogData: (
			| LogInsertData
			| Omit<LogInsertData, "messages" | "content">
		)[] = await Promise.all(
			logData.map(async (data) => {
				const organization = await db.query.organization.findFirst({
					where: {
						id: {
							eq: data.organizationId,
						},
					},
				});

				if (organization?.retentionLevel === "none") {
					const {
						messages: _messages,
						content: _content,
						reasoningContent: _reasoningContent,
						tools: _tools,
						toolChoice: _toolChoice,
						toolResults: _toolResults,
						...metadataOnly
					} = data;
					return metadataOnly;
				}

				return data;
			}),
		);

		// Insert logs with retry logic
		let lastError: Error | undefined;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				// Type assertion is safe here as both LogInsertData and its subset are compatible with the log insert schema
				await db.insert(log).values(processedLogData as LogInsertData[]);
				return; // Success, exit function
			} catch (insertError) {
				lastError =
					insertError instanceof Error
						? insertError
						: new Error(String(insertError));

				if (attempt < MAX_RETRIES) {
					const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s, 16s, ...
					logger.warn(
						`Failed to insert logs (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`,
						lastError,
					);
					await new Promise((resolve) => {
						setTimeout(resolve, delay);
					});
				}
			}
		}

		// All retries exhausted, push messages back to queue for later processing
		logger.error(
			`Failed to insert logs after ${MAX_RETRIES + 1} attempts, pushing back to queue`,
			lastError,
		);

		// Re-add messages to queue
		for (const msg of message) {
			await publishToQueue(LOG_QUEUE, JSON.parse(msg));
		}
	} catch (error) {
		logger.error(
			"Error processing log message",
			error instanceof Error ? error : new Error(String(error)),
		);

		// Re-add messages to queue on unexpected errors
		try {
			for (const msg of message) {
				await publishToQueue(LOG_QUEUE, JSON.parse(msg));
			}
		} catch (requeueError) {
			logger.error(
				"Failed to re-queue log messages",
				requeueError instanceof Error
					? requeueError
					: new Error(String(requeueError)),
			);
		}
	}
}

let isWorkerRunning = false;
let shouldStop = false;
let activeLoops = 0;
let stopFailed = false;

/**
 * Sleep that can be interrupted by shouldStop.
 * Breaks long delays into short chunks so loops exit promptly on shutdown.
 */
async function interruptibleSleep(ms: number): Promise<void> {
	const chunkMs = 500;
	let remaining = ms;

	while (remaining > 0 && !shouldStop) {
		await new Promise((resolve) => {
			setTimeout(resolve, Math.min(remaining, chunkMs));
		});
		remaining -= chunkMs;
	}
}

// Independent worker loops
async function runLogQueueLoop() {
	activeLoops++;
	logger.info("Starting log queue processing loop...");
	try {
		while (!shouldStop) {
			try {
				await processLogQueue();

				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, 1000);
					});
				}
			} catch (error) {
				logger.error(
					"Error in log queue loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, 5000);
					});
				}
			}
		}
	} finally {
		activeLoops--;
		logger.info("Log queue loop stopped");
	}
}

async function runAutoTopUpLoop() {
	activeLoops++;
	const interval = (process.env.NODE_ENV === "production" ? 120 : 5) * 1000; // 2 minutes in prod, 5 seconds in dev
	logger.info(
		`Starting auto top-up loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!shouldStop) {
			try {
				await processAutoTopUp();

				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, interval);
					});
				}
			} catch (error) {
				logger.error(
					"Error in auto top-up loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, 5000);
					});
				}
			}
		}
	} finally {
		activeLoops--;
		logger.info("Auto top-up loop stopped");
	}
}

async function runBatchProcessLoop() {
	activeLoops++;
	const interval = BATCH_PROCESSING_INTERVAL_SECONDS * 1000;
	logger.info(
		`Starting batch process loop (interval: ${BATCH_PROCESSING_INTERVAL_SECONDS} seconds)...`,
	);

	try {
		while (!shouldStop) {
			try {
				await batchProcessLogs();

				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, interval);
					});
				}
			} catch (error) {
				logger.error(
					"Error in batch process loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, 5000);
					});
				}
			}
		}
	} finally {
		activeLoops--;
		logger.info("Batch process loop stopped");
	}
}

async function runMinutelyHistoryLoop() {
	activeLoops++;
	logger.info(
		"Starting minutely history loop (every 60s, aligned to minute boundary)...",
	);

	try {
		// Initial run immediately
		try {
			await calculateMinutelyHistory();
		} catch (error) {
			logger.error(
				"Error in initial minutely history calculation",
				error instanceof Error ? error : new Error(String(error)),
			);
		}

		while (!shouldStop) {
			// Calculate delay to next minute boundary
			const now = new Date();
			const nextMinute = new Date(
				now.getFullYear(),
				now.getMonth(),
				now.getDate(),
				now.getHours(),
				now.getMinutes() + 1,
				0,
				50, // 50ms buffer
			);
			const delay = nextMinute.getTime() - now.getTime();

			await interruptibleSleep(delay);

			if (shouldStop) {
				break;
			}

			try {
				await calculateMinutelyHistory();
			} catch (error) {
				logger.error(
					"Error in minutely history calculation",
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Minutely history loop stopped");
	}
}

async function runCurrentMinuteHistoryLoop() {
	activeLoops++;
	const interval = CURRENT_MINUTE_HISTORY_INTERVAL_SECONDS * 1000;
	logger.info(
		`Starting current minute history loop (interval: ${CURRENT_MINUTE_HISTORY_INTERVAL_SECONDS} seconds)...`,
	);

	try {
		while (!shouldStop) {
			try {
				await calculateCurrentMinuteHistory();

				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, interval);
					});
				}
			} catch (error) {
				logger.error(
					"Error in current minute history loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, 5000);
					});
				}
			}
		}
	} finally {
		activeLoops--;
		logger.info("Current minute history loop stopped");
	}
}

async function runAggregatedStatsLoop() {
	activeLoops++;
	logger.info(
		"Starting aggregated stats loop (every 5min, aligned to 5-min boundary)...",
	);

	try {
		// Initial run immediately
		try {
			await calculateAggregatedStatistics();
		} catch (error) {
			logger.error(
				"Error in initial aggregated statistics calculation",
				error instanceof Error ? error : new Error(String(error)),
			);
		}

		while (!shouldStop) {
			// Calculate delay to next 5-minute boundary
			const now = new Date();
			const currentMinute = now.getMinutes();
			const nextFiveMinuteMark = Math.ceil((currentMinute + 1) / 5) * 5;
			const nextRun = new Date(now);
			nextRun.setSeconds(0, 100); // 100ms buffer
			if (nextFiveMinuteMark >= 60) {
				nextRun.setMinutes(0);
				nextRun.setHours(nextRun.getHours() + 1);
			} else {
				nextRun.setMinutes(nextFiveMinuteMark);
			}

			const delay = nextRun.getTime() - now.getTime();

			await interruptibleSleep(delay);

			if (shouldStop) {
				break;
			}

			try {
				await calculateAggregatedStatistics();
			} catch (error) {
				logger.error(
					"Error in aggregated statistics calculation",
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Aggregated stats loop stopped");
	}
}

async function runProjectStatsLoop() {
	activeLoops++;
	const interval = PROJECT_STATS_REFRESH_INTERVAL_SECONDS * 1000;
	logger.info(
		`Starting project stats loop (interval: ${PROJECT_STATS_REFRESH_INTERVAL_SECONDS} seconds)...`,
	);

	try {
		while (!shouldStop) {
			try {
				await refreshProjectHourlyStats();

				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, interval);
					});
				}
			} catch (error) {
				logger.error(
					"Error in project stats loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, 5000);
					});
				}
			}
		}
	} finally {
		activeLoops--;
		logger.info("Project stats loop stopped");
	}
}

async function runDataRetentionLoop() {
	activeLoops++;
	const interval = (process.env.NODE_ENV === "production" ? 300 : 60) * 1000; // 5 minutes in prod, 1 minute in dev
	logger.info(
		`Starting data retention loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!shouldStop) {
			try {
				await cleanupExpiredLogData();

				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, interval);
					});
				}
			} catch (error) {
				logger.error(
					"Error in data retention loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				if (!shouldStop) {
					await new Promise((resolve) => {
						setTimeout(resolve, 5000);
					});
				}
			}
		}
	} finally {
		activeLoops--;
		logger.info("Data retention loop stopped");
	}
}

export async function startWorker() {
	if (isWorkerRunning) {
		logger.error("Worker is already running");
		return;
	}

	if (activeLoops > 0) {
		logger.error(
			`Cannot start worker: ${activeLoops} loop(s) from previous worker still active. Please ensure previous worker has fully stopped.`,
		);
		return;
	}

	if (stopFailed) {
		logger.error(
			"Cannot start worker: previous worker stop failed. Please ensure all loops from previous worker have exited before starting a new worker.",
		);
		return;
	}

	isWorkerRunning = true;
	shouldStop = false;
	logger.info("Starting worker application...");

	// Initialize providers and models sync - must complete before other stats syncs
	try {
		await syncProvidersAndModels();
		logger.info("Initial sync completed");
	} catch (error) {
		logger.error(
			"Error during initial sync",
			error instanceof Error ? error : new Error(String(error)),
		);
	}

	void backfillHistoryIfNeeded()
		.then(() => {
			logger.info("History backfill check completed");
		})
		.catch((error) => {
			logger.error(
				"Error during history backfill",
				error instanceof Error ? error : new Error(String(error)),
			);
		});

	// Start all worker loops (all sequential — each waits for completion before scheduling next run)
	logger.info("Starting worker loops...");
	logger.info("- Minutely history: runs at the first second of every minute");
	logger.info(
		`- Current minute history: runs every ${CURRENT_MINUTE_HISTORY_INTERVAL_SECONDS} seconds for real-time metrics`,
	);
	logger.info(
		"- Aggregated stats: runs every 5 minutes at minute boundaries (0, 5, 10, 15, etc.)",
	);
	logger.info(
		`- Project hourly stats: runs every ${PROJECT_STATS_REFRESH_INTERVAL_SECONDS} seconds for dashboard aggregations`,
	);
	logger.info(
		"- Follow-up emails: runs every hour to check for lifecycle emails",
	);

	void runMinutelyHistoryLoop();
	void runCurrentMinuteHistoryLoop();
	void runAggregatedStatsLoop();
	void runProjectStatsLoop();
	void runLogQueueLoop();
	void runAutoTopUpLoop();
	void runBatchProcessLoop();
	void runDataRetentionLoop();
	void runFollowUpEmailsLoop({
		shouldStop: () => shouldStop,
		acquireLock,
		releaseLock,
		interruptibleSleep,
		registerLoop: () => {
			activeLoops++;
		},
		unregisterLoop: () => {
			activeLoops--;
		},
	});
}

export async function stopWorker(): Promise<boolean> {
	if (!isWorkerRunning) {
		logger.info("Worker is not running");
		return true;
	}

	logger.info("Stopping worker...");
	shouldStop = true;

	// Wait for all loops to finish by polling activeLoops counter
	const maxWaitTime = 15000; // 15 seconds timeout
	const pollInterval = 100; // 100ms per iteration
	const startTime = Date.now();

	logger.info(
		`Waiting for all worker loops to finish (active loops: ${activeLoops})...`,
	);

	while (activeLoops > 0) {
		const elapsed = Date.now() - startTime;

		if (elapsed >= maxWaitTime) {
			logger.error(
				`Timeout reached (${maxWaitTime}ms) while waiting for worker loops to exit. ${activeLoops} loop(s) still active. Worker stop failed.`,
			);
			stopFailed = true;
			// Keep shouldStop = true and isWorkerRunning = true to prevent new loops from starting
			return false;
		}

		// Sleep for a short period before checking again
		await new Promise((resolve) => {
			setTimeout(resolve, pollInterval);
		});
	}

	logger.info("All worker loops have exited successfully");

	// Only set isWorkerRunning = false if all loops exited successfully
	isWorkerRunning = false;
	stopFailed = false;

	// Close database and Redis connections
	try {
		await Promise.all([closeDatabase(), closeRedisClient()]);
		logger.info("All connections closed successfully");
	} catch (error) {
		logger.error(
			"Error closing connections",
			error instanceof Error ? error : new Error(String(error)),
		);
		// Don't throw here to allow graceful shutdown to continue
	}

	logger.info("Worker stopped gracefully");
	return true;
}
