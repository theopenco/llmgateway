import Stripe from "stripe";
import { z } from "zod";

import {
	consumeFromQueue,
	LOG_QUEUE,
	closeRedisClient,
} from "@llmgateway/cache";
import {
	db,
	log,
	organization,
	eq,
	sql,
	and,
	lt,
	tables,
	apiKey,
	inArray,
	type LogInsertData,
	closeDatabase,
	closeCachedDatabase,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hasErrorCode } from "@llmgateway/models";
import { calculateFees } from "@llmgateway/shared";

import {
	calculateMinutelyHistory,
	calculateAggregatedStatistics,
	backfillHistoryIfNeeded,
} from "./services/stats-calculator.js";
import { syncProvidersAndModels } from "./services/sync-models.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_123", {
	apiVersion: "2025-04-30.basil",
});

const AUTO_TOPUP_LOCK_KEY = "auto_topup_check";
const CREDIT_PROCESSING_LOCK_KEY = "credit_processing";
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
	used_provider: z.string(),
	response_size: z.number(),
});

export async function acquireLock(key: string): Promise<boolean> {
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
				const actualError = (insertError as any)?.cause || insertError;
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
			const threshold = Number(org.autoTopUpThreshold || 10);
			return credits < threshold;
		});

		for (const org of filteredOrgs) {
			try {
				// Check if there's a recent pending or failed auto top-up transaction
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

				// Additional check for time constraint (within 1 hour) and status
				if (recentTransaction) {
					const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
					if (recentTransaction.createdAt > oneHourAgo) {
						// Recent transaction within 1 hour, check its status
						if (recentTransaction.status === "pending") {
							logger.info(
								`Skipping auto top-up for organization ${org.id}: pending transaction exists`,
							);
							continue;
						}

						if (recentTransaction.status === "failed") {
							logger.info(
								`Skipping auto top-up for organization ${org.id}: most recent transaction failed`,
							);
							continue;
						}
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

				const topUpAmount = Number(org.autoTopUpAmount || "10");

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

				const stripePaymentMethod = await stripe.paymentMethods.retrieve(
					defaultPaymentMethod.stripePaymentMethodId,
				);

				const cardCountry = stripePaymentMethod.card?.country;

				// Use centralized fee calculator
				const feeBreakdown = calculateFees({
					amount: topUpAmount,
					organizationPlan: org.plan,
					cardCountry: cardCountry || undefined,
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
					const paymentIntent = await stripe.paymentIntents.create({
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
							totalFees: feeBreakdown.totalFees.toString(),
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
					used_provider: log.usedProvider,
					response_size: log.responseSize,
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
			const orgCosts = new Map<string, number>();
			const apiKeyCosts = new Map<string, number>();
			const logIds: string[] = [];

			for (const raw of unprocessedLogs.rows) {
				const row = schema.parse(raw);

				// Log each processed log with JSON format
				logger.info("Processing log", {
					kind: "log-process",
					logId: row.id,
					requestId: row.request_id,
					organizationId: row.organization_id,
					projectId: row.project_id,
					cost: row.cost,
					cached: row.cached,
					apiKeyId: row.api_key_id,
					projectMode: row.project_mode,
					usedMode: row.used_mode,
					duration: row.duration,
					requestedModel: row.requested_model,
					requestedProvider: row.requested_provider,
					usedModel: row.used_model,
					usedProvider: row.used_provider,
					responseSize: row.response_size,
				});

				if (row.cost && row.cost > 0 && !row.cached) {
					// Always update API key usage for non-cached logs with cost
					const currentApiKeyCost = apiKeyCosts.get(row.api_key_id) || 0;
					apiKeyCosts.set(row.api_key_id, currentApiKeyCost + row.cost);

					// Only deduct organization credits when the log actually used credits
					if (row.used_mode === "credits") {
						const currentOrgCost = orgCosts.get(row.organization_id) || 0;
						orgCosts.set(row.organization_id, currentOrgCost + row.cost);
					}
				}

				logIds.push(row.id);
			}

			// Batch update organization credits within the same transaction
			for (const [orgId, totalCost] of orgCosts.entries()) {
				if (totalCost > 0) {
					await tx
						.update(organization)
						.set({
							credits: sql`${organization.credits} - ${totalCost}`,
						})
						.where(eq(organization.id, orgId));

					logger.info(
						`Deducted ${totalCost} credits from organization ${orgId}`,
					);
				}
			}

			// Batch update API key usage within the same transaction
			for (const [apiKeyId, totalCost] of apiKeyCosts.entries()) {
				if (totalCost > 0) {
					await tx
						.update(apiKey)
						.set({
							usage: sql`${apiKey.usage} + ${totalCost}`,
						})
						.where(eq(apiKey.id, apiKeyId));

					logger.info(`Added ${totalCost} usage to API key ${apiKeyId}`);
				}
			}

			// Mark all logs as processed within the same transaction
			await tx
				.update(log)
				.set({
					processedAt: new Date(),
				})
				.where(inArray(log.id, logIds));

			logger.info(`Marked ${logIds.length} logs as processed`);
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
						...metadataOnly
					} = data;
					return metadataOnly;
				}

				return data;
			}),
		);

		// Insert logs without processing credits or API key usage - they will be processed in batches
		// Type assertion is safe here as both LogInsertData and its subset are compatible with the log insert schema
		await db.insert(log).values(processedLogData as LogInsertData[]);
	} catch (error) {
		logger.error(
			"Error processing log message",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

let isWorkerRunning = false;
let shouldStop = false;
let minutelyIntervalId: NodeJS.Timeout | null = null;
let aggregatedIntervalId: NodeJS.Timeout | null = null;

export async function startWorker() {
	if (isWorkerRunning) {
		logger.info("Worker is already running");
		return;
	}

	isWorkerRunning = true;
	shouldStop = false;
	logger.info("Starting worker application...");

	// Initialize providers and models sync
	void syncProvidersAndModels()
		.then(() => {
			logger.info("Initial sync completed");
		})
		.catch((error) => {
			logger.error(
				"Error during initial sync",
				error instanceof Error ? error : new Error(String(error)),
			);
		});

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

	// Start statistics calculator
	logger.info("Starting statistics calculator...");
	logger.info("- Minutely history: runs at the first second of every minute");
	logger.info(
		"- Aggregated stats: runs every 5 minutes at minute boundaries (0, 5, 10, 15, etc.)",
	);

	// Start minutely history calculation (runs at the beginning of every minute)
	calculateMinutelyHistory().catch((error) => {
		logger.error(
			"Error in initial minutely history calculation",
			error instanceof Error ? error : new Error(String(error)),
		);
	});

	// Calculate delay to next minute's first second
	const scheduleMinutelyHistory = () => {
		const now = new Date();
		const nextMinute = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			now.getHours(),
			now.getMinutes() + 1,
			0, // 0 seconds
			50, // 50ms buffer to ensure we're past the second boundary
		);
		const delayToNextMinute = nextMinute.getTime() - now.getTime();

		setTimeout(() => {
			calculateMinutelyHistory().catch((error) => {
				logger.error(
					"Error in scheduled minutely history calculation",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
			// After the first run, schedule it to repeat every minute at the first second
			minutelyIntervalId = setInterval(
				() => {
					calculateMinutelyHistory().catch((error) => {
						logger.error(
							"Error in interval minutely history calculation",
							error instanceof Error ? error : new Error(String(error)),
						);
					});
				},
				60 * 1000, // 1 minute
			);
		}, delayToNextMinute);
	};

	scheduleMinutelyHistory();

	// Start aggregated statistics calculation (runs every 5 minutes at minute boundaries)
	calculateAggregatedStatistics().catch((error) => {
		logger.error(
			"Error in initial aggregated statistics calculation",
			error instanceof Error ? error : new Error(String(error)),
		);
	});

	// Calculate delay to next 5-minute boundary (0, 5, 10, 15, etc.)
	const scheduleAggregatedStats = () => {
		const now = new Date();
		const currentMinute = now.getMinutes();
		const nextFiveMinuteMark = Math.ceil((currentMinute + 1) / 5) * 5;
		const nextRun = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			now.getHours(),
			nextFiveMinuteMark,
			0, // 0 seconds
			100, // 100ms buffer
		);

		// Handle hour rollover
		if (nextFiveMinuteMark >= 60) {
			nextRun.setHours(nextRun.getHours() + 1);
			nextRun.setMinutes(0);
		}

		const delayToNext = nextRun.getTime() - now.getTime();

		setTimeout(() => {
			calculateAggregatedStatistics().catch((error) => {
				logger.error(
					"Error in scheduled aggregated statistics calculation",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
			// After the first run, schedule it to repeat every 5 minutes
			aggregatedIntervalId = setInterval(
				() => {
					calculateAggregatedStatistics().catch((error) => {
						logger.error(
							"Error in interval aggregated statistics calculation",
							error instanceof Error ? error : new Error(String(error)),
						);
					});
				},
				5 * 60 * 1000, // 5 minutes
			);
		}, delayToNext);
	};

	scheduleAggregatedStats();

	logger.info("Starting log queue processing...");
	const count = process.env.NODE_ENV === "production" ? 120 : 5;
	let autoTopUpCounter = 0;
	let creditProcessingCounter = 0;

	// eslint-disable-next-line no-unmodified-loop-condition
	while (!shouldStop) {
		try {
			await processLogQueue();

			autoTopUpCounter++;
			if (autoTopUpCounter >= count) {
				await processAutoTopUp();
				autoTopUpCounter = 0;
			}

			creditProcessingCounter++;
			if (creditProcessingCounter >= BATCH_PROCESSING_INTERVAL_SECONDS) {
				await batchProcessLogs();
				creditProcessingCounter = 0;
			}

			if (!shouldStop) {
				await new Promise((resolve) => {
					setTimeout(resolve, 1000);
				});
			}
		} catch (error) {
			logger.error(
				"Error in log queue worker",
				error instanceof Error ? error : new Error(String(error)),
			);
			if (!shouldStop) {
				await new Promise((resolve) => {
					setTimeout(resolve, 5000);
				});
			}
		}
	}

	isWorkerRunning = false;
	logger.info("Worker stopped");
}

export async function stopWorker(): Promise<void> {
	if (!isWorkerRunning) {
		logger.info("Worker is not running");
		return;
	}

	logger.info("Stopping worker...");
	shouldStop = true;

	// Stop statistics calculator intervals
	if (minutelyIntervalId) {
		clearInterval(minutelyIntervalId);
		minutelyIntervalId = null;
		logger.info("Minutely history calculator stopped");
	}

	if (aggregatedIntervalId) {
		clearInterval(aggregatedIntervalId);
		aggregatedIntervalId = null;
		logger.info("Aggregated statistics calculator stopped");
	}

	const pollInterval = 100;
	const maxWaitTime = 15000; // 15 seconds timeout
	const startTime = Date.now();

	// eslint-disable-next-line no-unmodified-loop-condition
	while (isWorkerRunning) {
		if (Date.now() - startTime > maxWaitTime) {
			logger.warn("Worker stop timeout exceeded, forcing shutdown");
			break;
		}
		await new Promise((resolve) => {
			setTimeout(resolve, pollInterval);
		});
	}

	// Close database and Redis connections
	try {
		await Promise.all([
			closeDatabase(),
			closeCachedDatabase(),
			closeRedisClient(),
		]);
		logger.info("All connections closed successfully");
	} catch (error) {
		logger.error(
			"Error closing connections",
			error instanceof Error ? error : new Error(String(error)),
		);
		// Don't throw here to allow graceful shutdown to continue
	}

	logger.info("Worker stopped gracefully");
}
