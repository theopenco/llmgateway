import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";

import { Decimal } from "decimal.js";
import Stripe from "stripe";
import { z } from "zod";

import {
	checkAndReserveTopUp,
	flushLimitHits,
	releaseTopUpReservation,
} from "@llmgateway/actions";
import {
	closeRedisClient,
	closeStorageRedisClient,
	consumeFromQueue,
	LOG_QUEUE,
	publishToQueue,
} from "@llmgateway/cache";
import {
	addApiKeyPeriodDuration,
	and,
	apiKey,
	cdb,
	closeDatabase,
	db,
	enqueueWebhookDeliveries,
	eq,
	inArray,
	invalidateOrganizationsCache,
	isNotNull,
	isApiKeyPeriodLimitConfigured,
	log,
	type LogInsertData,
	lt,
	organization,
	resolveVerifiedOrgRecipient,
	shortid,
	sql,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hasErrorCode } from "@llmgateway/models";
import {
	assertSafeWebhookUrl,
	calculateFees,
	getRemainingPremiumWeeklyAllowance,
	isCreditTopUpAmountInRange,
	isLoungeSource,
	isPremiumUsedModel,
	isPremiumWeekExpired,
	isPrivateOrReservedIp,
} from "@llmgateway/shared";

import { posthog } from "./posthog.js";
import {
	runFollowUpEmailsLoop,
	sendLowBalanceEmail,
} from "./services/follow-up-emails.js";
import {
	GLOBAL_STATS_INTERVAL_SECONDS,
	processClosedHours,
} from "./services/global-stats-aggregator.js";
import {
	PROJECT_STATS_REFRESH_INTERVAL_SECONDS,
	refreshProjectHourlyStats,
} from "./services/project-stats-aggregator.js";
import {
	backfillHistoryIfNeeded,
	backfillHourlyHistoryIfNeeded,
	calculateAggregatedStatistics,
	calculateCurrentMinuteHistory,
	calculateHourlyHistory,
	calculateMinutelyHistory,
} from "./services/stats-calculator.js";
import { syncProvidersAndModels } from "./services/sync-models.js";
import {
	processPendingVideoJobs,
	processPendingWebhookDeliveries,
} from "./services/video-jobs.js";
import {
	interruptibleSleep,
	isStopRequested,
	requestStop,
	resetShutdown,
} from "./shutdown.js";

import type { DevPlanTier } from "@llmgateway/shared";

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
const MODEL_HISTORY_RETENTION_LOCK_KEY = "model_history_retention_cleanup";
const END_USER_SESSION_CLEANUP_LOCK_KEY = "end_user_session_cleanup";
const API_KEY_EXPIRATION_LOCK_KEY = "api_key_expiration";
const LIMIT_HIT_FLUSH_LOCK_KEY = "limit_hit_flush";
const STALE_TOPUP_PI_LOCK_KEY = "stale_topup_pi_cancel";
const WEBHOOK_DELIVERY_LOCK_KEY = "platform_webhook_delivery";
const MARGIN_PAYOUT_LOCK_KEY = "margin_payout";
const LOCK_DURATION_MINUTES = 5;
// LLM SDK: emit a wallet.low_balance webhook when a wallet's balance
// crosses below this (USD) on a usage debit.
const WALLET_LOW_BALANCE_THRESHOLD = 1;
const AUTO_TOPUP_DISABLE_AFTER_DAYS = 7;
const AUTO_TOPUP_DISABLE_AFTER_MS =
	AUTO_TOPUP_DISABLE_AFTER_DAYS * 24 * 60 * 60 * 1000;

// Configuration for batch processing
const LOG_QUEUE_BATCH_SIZE = Number(process.env.LOG_QUEUE_BATCH_SIZE) || 100;
// Number of log-drain loops to run concurrently in-process. Each loop pulls an
// independent batch (LPOP is atomic, so there is no double-processing) and
// inserts on its own pool connection, multiplying drain throughput without
// adding worker replicas. Bounded by the DB pool size and Postgres write
// capacity.
const LOG_QUEUE_CONCURRENCY = Math.max(
	1,
	Number(process.env.LOG_QUEUE_CONCURRENCY) || 4,
);
const CREDIT_BATCH_SIZE = Number(process.env.CREDIT_BATCH_SIZE) || 100;
// 1s: this interval is the floor of the spend-to-balance settlement gap the
// credit gates operate on, so it directly bounds how far a burst can
// overshoot a balance. Idle cost is one lock round-trip per tick.
const BATCH_PROCESSING_INTERVAL_SECONDS =
	Number(process.env.CREDIT_BATCH_INTERVAL) || 1;
const VIDEO_JOB_POLL_INTERVAL_SECONDS =
	Number(process.env.VIDEO_JOB_POLL_INTERVAL_SECONDS) || 5;
const VIDEO_WEBHOOK_POLL_INTERVAL_SECONDS =
	Number(process.env.VIDEO_WEBHOOK_POLL_INTERVAL_SECONDS) || 5;

interface ApiKeyUsageEvent {
	cost: Decimal;
	createdAt: Date;
}

type ApiKeyPeriodState = Pick<
	typeof apiKey.$inferSelect,
	| "currentPeriodStartedAt"
	| "currentPeriodUsage"
	| "periodUsageLimit"
	| "periodUsageDurationValue"
	| "periodUsageDurationUnit"
>;

interface ApiKeyUsageUpdate {
	hasPeriodUsageUpdate: boolean;
	currentPeriodStartedAt: Date | null;
	currentPeriodUsage: string;
	totalUsageCost: Decimal;
}

function buildApiKeyUsageUpdate(
	apiKeyState: ApiKeyPeriodState,
	events: ApiKeyUsageEvent[],
): ApiKeyUsageUpdate {
	const totalUsageCost = events.reduce(
		(total, event) => total.plus(event.cost),
		new Decimal(0),
	);

	if (!isApiKeyPeriodLimitConfigured(apiKeyState)) {
		return {
			hasPeriodUsageUpdate: false,
			currentPeriodStartedAt: apiKeyState.currentPeriodStartedAt,
			currentPeriodUsage: String(apiKeyState.currentPeriodUsage ?? "0"),
			totalUsageCost,
		};
	}

	let currentPeriodStartedAt = apiKeyState.currentPeriodStartedAt;
	let currentPeriodUsage = new Decimal(apiKeyState.currentPeriodUsage ?? "0");

	for (const event of events) {
		if (
			currentPeriodStartedAt === null ||
			addApiKeyPeriodDuration(
				currentPeriodStartedAt,
				apiKeyState.periodUsageDurationValue,
				apiKeyState.periodUsageDurationUnit,
			) <= event.createdAt
		) {
			currentPeriodStartedAt = event.createdAt;
			currentPeriodUsage = event.cost;
			continue;
		}

		currentPeriodUsage = currentPeriodUsage.plus(event.cost);
	}

	return {
		hasPeriodUsageUpdate: true,
		currentPeriodStartedAt,
		currentPeriodUsage: currentPeriodUsage.toString(),
		totalUsageCost,
	};
}

const schema = z.object({
	id: z.string(),
	created_at: z.date(),
	request_id: z.string(),
	organization_id: z.string(),
	project_id: z.string(),
	cost: z.number().nullable(),
	billing_cost: z.string().nullable(),
	cached: z.boolean(),
	api_key_id: z.string(),
	provider_key_id: z.string().nullable(),
	end_user_session_id: z.string().nullable(),
	end_customer_wallet_id: z.string().nullable(),
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
	cache_write_tokens: z.string().nullable(),
	input_cost: z.number().nullable(),
	output_cost: z.number().nullable(),
	cached_input_cost: z.number().nullable(),
	cache_write_input_cost: z.number().nullable(),
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
	source: z.string().nullable(),
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

async function recordAutoTopUpFailure(org: {
	id: string;
	paymentFailureCount: number | null;
	paymentFailureStartedAt: Date | null;
}): Promise<void> {
	await db
		.update(tables.organization)
		.set({
			paymentFailureCount: (org.paymentFailureCount ?? 0) + 1,
			lastPaymentFailureAt: new Date(),
			paymentFailureStartedAt: org.paymentFailureStartedAt ?? new Date(),
		})
		.where(eq(tables.organization.id, org.id));
}

// DevPass orgs have no payment_method table rows; their card lives on the
// Stripe subscription (or the customer default). Mirrors the resolution in
// the /dev-plans/topup route so auto-reload charges the same card.
async function resolveDevPassStripePaymentMethodId(org: {
	id: string;
	devPlanStripeSubscriptionId: string | null;
	stripeCustomerId: string | null;
}): Promise<string | null> {
	if (org.devPlanStripeSubscriptionId) {
		try {
			const subscription = await getStripe().subscriptions.retrieve(
				org.devPlanStripeSubscriptionId,
			);
			const pm = subscription.default_payment_method;
			const id = typeof pm === "string" ? pm : (pm?.id ?? null);
			if (id) {
				return id;
			}
		} catch (err) {
			logger.warn(
				`Could not read DevPass subscription payment method for organization ${org.id}`,
				{ error: err instanceof Error ? err.message : String(err) },
			);
		}
	}
	if (org.stripeCustomerId) {
		try {
			const customer = await getStripe().customers.retrieve(
				org.stripeCustomerId,
			);
			if (!customer.deleted) {
				const pm = customer.invoice_settings?.default_payment_method;
				return typeof pm === "string" ? pm : (pm?.id ?? null);
			}
		} catch (err) {
			logger.warn(
				`Could not read DevPass customer payment method for organization ${org.id}`,
				{ error: err instanceof Error ? err.message : String(err) },
			);
		}
	}
	return null;
}

export async function processAutoTopUp(): Promise<void> {
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
			// An organization flagged as high risk cannot buy credits manually, so
			// it must not keep charging a card automatically either.
			if (org.riskFlagged) {
				return false;
			}
			// DevPass orgs can only spend credits with the pay-as-you-go
			// overflow opt-in; without it auto-reload would buy credits the
			// org cannot use.
			if (org.kind === "devpass" && !org.devPlanPaygEnabled) {
				return false;
			}
			const credits = Number(org.credits || 0);
			const threshold = Number(org.autoTopUpThreshold ?? 10);
			return credits < threshold;
		});

		for (const org of filteredOrgs) {
			if (isStopRequested()) {
				break;
			}
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

				if (
					org.paymentFailureStartedAt &&
					Date.now() - org.paymentFailureStartedAt.getTime() >=
						AUTO_TOPUP_DISABLE_AFTER_MS
				) {
					const auditActor =
						(await db.query.userOrganization.findFirst({
							where: {
								organizationId: {
									eq: org.id,
								},
								role: {
									eq: "owner",
								},
							},
						})) ??
						(await db.query.userOrganization.findFirst({
							where: {
								organizationId: {
									eq: org.id,
								},
							},
						}));

					const previousFailureStartedAt = org.paymentFailureStartedAt;
					const previousLastPaymentFailureAt = org.lastPaymentFailureAt;
					const previousFailureCount = org.paymentFailureCount ?? 0;

					await db
						.update(tables.organization)
						.set({
							autoTopUpEnabled: false,
							paymentFailureCount: 0,
							lastPaymentFailureAt: null,
							paymentFailureStartedAt: null,
						})
						.where(eq(tables.organization.id, org.id));

					if (auditActor) {
						await db.insert(tables.auditLog).values({
							organizationId: org.id,
							userId: auditActor.userId,
							action: "payment.auto_topup.disable",
							resourceType: "organization",
							resourceId: org.id,
							metadata: {
								automatic: true,
								reason: "payment_failures_exceeded_7_days",
								changes: {
									autoTopUpEnabled: {
										old: true,
										new: false,
									},
								},
								paymentFailureCount: previousFailureCount,
								paymentFailureStartedAt: previousFailureStartedAt.toISOString(),
								lastPaymentFailureAt:
									previousLastPaymentFailureAt?.toISOString() ?? null,
							},
						});
					}

					logger.warn(
						`Disabled auto top-up for organization ${org.id} after ${AUTO_TOPUP_DISABLE_AFTER_DAYS} days of payment failures`,
					);
					continue;
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

				// DevPass orgs keep their card as the Stripe subscription/customer
				// default rather than in the payment_method table, so fall back to
				// it — the same card the manual /dev-plans/topup route charges.
				let stripePaymentMethodId =
					defaultPaymentMethod?.stripePaymentMethodId ?? null;
				if (!stripePaymentMethodId && org.kind === "devpass") {
					stripePaymentMethodId =
						await resolveDevPassStripePaymentMethodId(org);
				}

				if (!stripePaymentMethodId) {
					logger.info(
						`No default payment method for organization ${org.id}, skipping auto top-up`,
					);
					continue;
				}

				const topUpAmount = Number(org.autoTopUpAmount ?? "10");

				if (!isCreditTopUpAmountInRange(topUpAmount)) {
					logger.error(
						`Skipping auto top-up for organization ${org.id}: invalid amount ${org.autoTopUpAmount}`,
					);
					continue;
				}

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

				let isInternational = false;
				try {
					const stripePaymentMethod = await getStripe().paymentMethods.retrieve(
						stripePaymentMethodId,
					);

					const paymentMethodCustomer =
						typeof stripePaymentMethod.customer === "string"
							? stripePaymentMethod.customer
							: (stripePaymentMethod.customer?.id ?? null);

					// A payment method can only be charged against the customer it
					// is attached to; a mismatch (e.g. from a historical duplicate
					// Stripe customer) would be rejected on every attempt, so track
					// the failure for backoff/auto-disable instead of charging.
					if (paymentMethodCustomer !== org.stripeCustomerId) {
						logger.error(
							`Default payment method ${stripePaymentMethodId} for organization ${org.id} is attached to Stripe customer ${paymentMethodCustomer}, but the organization's Stripe customer is ${org.stripeCustomerId}; skipping auto top-up`,
						);
						await recordAutoTopUpFailure(org);
						continue;
					}

					const country = stripePaymentMethod.card?.country;
					isInternational = Boolean(country) && country !== "US";
				} catch (err) {
					logger.error(
						`Failed to retrieve payment method ${stripePaymentMethodId} for organization ${org.id}; skipping auto top-up cycle to avoid undercharging international cards`,
						err as Error,
					);
					continue;
				}

				const feeBreakdown = calculateFees({
					amount: topUpAmount,
					isInternational,
				});

				// The org row was read once at the start of the pass, and the
				// payment-method resolution above makes network calls — the user
				// may have switched auto-reload (or DevPass PAYG overflow) off in
				// the meantime. Re-read and re-authorize immediately before money
				// moves: a charge that loses this check stops before the pending
				// transaction and PaymentIntent are ever created. The residual
				// window is the Stripe call itself, which a settings write cannot
				// revoke.
				const freshOrg = await db.query.organization.findFirst({
					where: {
						id: {
							eq: org.id,
						},
					},
				});
				if (
					!freshOrg ||
					!freshOrg.autoTopUpEnabled ||
					(freshOrg.kind === "devpass" && !freshOrg.devPlanPaygEnabled) ||
					Number(freshOrg.credits || 0) >=
						Number(freshOrg.autoTopUpThreshold ?? 10)
				) {
					logger.info(
						`Skipping auto top-up for organization ${org.id}: settings changed mid-pass`,
					);
					continue;
				}

				// Tier-based top-up velocity cap. Reserving covers the gap between
				// this check and the pending insert below: a concurrent manual
				// top-up in that window would otherwise see neither a reservation
				// nor the pending row and both could pass. On a cap hit just skip
				// (the blocked attempt released its own reservation) — the next
				// cycle re-checks once the window rolls, so auto-reload resumes by
				// itself.
				const velocity = await checkAndReserveTopUp({
					org: freshOrg,
					amountUsd: feeBreakdown.totalAmount,
				});
				if (!velocity.allowed) {
					logger.info(
						`Skipping auto top-up for organization ${org.id}: top-up velocity cap reached`,
						{
							capUsd: velocity.capUsd,
							usedUsd: velocity.usedUsd,
							attemptedUsd: feeBreakdown.totalAmount,
						},
					);
					continue;
				}

				// Insert pending transaction before creating payment intent
				let pendingTransaction;
				try {
					pendingTransaction = await db
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
				} finally {
					// The pending row now counts in the gate's DB window sum, so the
					// bridging reservation must go either way (kept on success it
					// would double-count; kept on failure it would leak headroom).
					await releaseTopUpReservation(org.id, feeBreakdown.totalAmount);
				}

				logger.info(
					`Created pending transaction ${pendingTransaction.id} for organization ${org.id}`,
				);

				try {
					const paymentIntent = await getStripe().paymentIntents.create({
						amount: Math.round(feeBreakdown.totalAmount * 100),
						currency: "usd",
						description: `Auto top-up for ${topUpAmount} USD (total: ${feeBreakdown.totalAmount} including fees)`,
						payment_method: stripePaymentMethodId,
						customer: org.stripeCustomerId!,
						confirm: true,
						off_session: true,
						metadata: {
							organizationId: org.id,
							type: "credit_topup",
							autoTopUp: "true",
							transactionId: pendingTransaction.id,
							baseAmount: feeBreakdown.baseAmount.toString(),
							platformFee: feeBreakdown.platformFee.toString(),
							internationalFee: feeBreakdown.internationalFee.toString(),
							totalAmount: feeBreakdown.totalAmount.toString(),
							isInternational: isInternational.toString(),
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
					const errObj =
						stripeError instanceof Error
							? stripeError
							: new Error(String(stripeError));
					// Card declines (insufficient funds, generic_decline, expired
					// cards, etc.) are an expected outcome of an off-session auto
					// top-up, not a server error, so log them at warn level to avoid
					// noisy error alerts.
					if (stripeError instanceof Stripe.errors.StripeCardError) {
						logger.warn(
							`Auto top-up card declined for organization ${org.id}`,
							errObj,
						);
					} else {
						logger.error(`Stripe error for organization ${org.id}`, errObj);
					}
					// A rejected paymentIntents.create never produces a
					// payment_intent.payment_failed webhook (unlike card declines),
					// so record the failure here or backoff/auto-disable never
					// engage and the same doomed charge retries every cycle.
					if (stripeError instanceof Stripe.errors.StripeInvalidRequestError) {
						await recordAutoTopUpFailure(org);
					}
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
		while (hasMoreRecords && !isStopRequested()) {
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
						gatewayContentFilterResponse: null,
						responsesApiData: null,
						dataRetentionCleanedUp: true,
					})
					// Use `= ANY($1)` with a single array parameter instead of
					// `inArray()`, which expands to `IN ($1, $2, ...)` with a
					// variable number of binds per batch. A varying placeholder
					// count makes pg_stat_statements fingerprint every batch size
					// as a distinct query, so one logical operation shows up as
					// thousands of individual queries. The array form keeps the
					// query text constant.
					.where(sql`${log.id} = ANY(${sql.param(idsToClean)}::text[])`);

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

// Delete minute-level model/mapping history rows older than the retention
// window. The four total and usage-mode tables grow every minute; their hourly
// rollups are kept forever and serve longer windows. Thirty days leaves a
// comfortable buffer over the largest minute-level reader.
const MODEL_HISTORY_RETENTION_DAYS = 30;
const MODEL_HISTORY_CLEANUP_BATCH_SIZE = 10000;
const HISTORY_USAGE_MODES = ["credits", "api-keys"] as const;
type HistoryUsageMode = (typeof HISTORY_USAGE_MODES)[number];
// Cap the work per run (per table) so a single cleanup reliably finishes well
// within the lock TTL (LOCK_DURATION_MINUTES), even on a large initial backlog.
// The loop runs hourly, so any remaining rows are drained over subsequent runs.
// At steady state (~1280 rows/min across all four tables, i.e. a few batches
// per hour) this cap is never approached; it only bounds the initial backlog
// drain. Each table gets its own budget so neither table starves, while both
// usage modes share their table's budget.
const MODEL_HISTORY_MAX_BATCHES_PER_RUN = 50;

async function cleanupModelHistoryTable(
	table:
		| typeof tables.modelHistory
		| typeof tables.modelProviderMappingHistory
		| typeof tables.modelUsageHistory
		| typeof tables.modelProviderMappingUsageHistory,
	cutoffDate: Date,
	maxBatches: number,
	usedMode?: HistoryUsageMode,
): Promise<{ deleted: number; batches: number }> {
	let totalDeleted = 0;
	let batches = 0;
	let hasMoreRecords = true;

	while (hasMoreRecords && batches < maxBatches && !isStopRequested()) {
		const batchDeleted = await db.transaction(async (tx) => {
			// Prefer the minuteTimestamp index over a sequential scan; SET LOCAL
			// resets automatically when the transaction commits.
			await tx.execute(sql`SET LOCAL random_page_cost = 1.1`);

			const cutoffWhere =
				usedMode && "usedMode" in table
					? and(
							eq(table.usedMode, usedMode),
							lt(table.minuteTimestamp, cutoffDate),
						)
					: lt(table.minuteTimestamp, cutoffDate);
			const recordsToDelete = await tx
				.select({ id: table.id })
				.from(table)
				.where(cutoffWhere)
				.limit(MODEL_HISTORY_CLEANUP_BATCH_SIZE)
				.for("update", { skipLocked: true });

			if (recordsToDelete.length === 0) {
				return 0;
			}

			const idsToDelete = recordsToDelete.map((r) => r.id);

			// Use `= ANY($1)` with a single array param instead of inArray()'s
			// variable-length `IN (...)`, so pg_stat_statements fingerprints
			// every batch identically.
			await tx
				.delete(table)
				.where(sql`${table.id} = ANY(${sql.param(idsToDelete)}::text[])`);

			return recordsToDelete.length;
		});

		totalDeleted += batchDeleted;
		batches++;

		if (batchDeleted < MODEL_HISTORY_CLEANUP_BATCH_SIZE) {
			hasMoreRecords = false;
		}
	}

	return { deleted: totalDeleted, batches };
}

async function cleanupUsageHistoryTable(
	table:
		| typeof tables.modelUsageHistory
		| typeof tables.modelProviderMappingUsageHistory,
	cutoffDate: Date,
	maxBatches: number,
): Promise<{ deleted: number; batches: number }> {
	let deleted = 0;
	let batches = 0;
	for (const usedMode of HISTORY_USAGE_MODES) {
		const remainingBatches = maxBatches - batches;
		if (remainingBatches <= 0) {
			break;
		}
		const result = await cleanupModelHistoryTable(
			table,
			cutoffDate,
			remainingBatches,
			usedMode,
		);
		deleted += result.deleted;
		batches += result.batches;
	}
	return { deleted, batches };
}

export async function cleanupExpiredModelHistory(): Promise<void> {
	if (process.env.ENABLE_DATA_RETENTION_CLEANUP !== "true") {
		return;
	}

	const lockAcquired = await acquireLock(MODEL_HISTORY_RETENTION_LOCK_KEY);
	if (!lockAcquired) {
		return;
	}

	try {
		logger.info("Starting model history retention cleanup...");

		const cutoffDate = new Date(
			Date.now() - MODEL_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000, // eslint-disable-line no-mixed-operators
		);

		const mapping = await cleanupModelHistoryTable(
			tables.modelProviderMappingHistory,
			cutoffDate,
			MODEL_HISTORY_MAX_BATCHES_PER_RUN,
		);
		const model = await cleanupModelHistoryTable(
			tables.modelHistory,
			cutoffDate,
			MODEL_HISTORY_MAX_BATCHES_PER_RUN,
		);
		const mappingUsage = await cleanupUsageHistoryTable(
			tables.modelProviderMappingUsageHistory,
			cutoffDate,
			MODEL_HISTORY_MAX_BATCHES_PER_RUN,
		);
		const modelUsage = await cleanupUsageHistoryTable(
			tables.modelUsageHistory,
			cutoffDate,
			MODEL_HISTORY_MAX_BATCHES_PER_RUN,
		);

		const mappingDeleted = mapping.deleted;
		const modelDeleted = model.deleted;
		const mappingUsageDeleted = mappingUsage.deleted;
		const modelUsageDeleted = modelUsage.deleted;

		if (
			mappingDeleted > 0 ||
			modelDeleted > 0 ||
			mappingUsageDeleted > 0 ||
			modelUsageDeleted > 0
		) {
			logger.info(
				`Model history retention cleanup deleted ${mappingDeleted} mapping, ${modelDeleted} model, ${mappingUsageDeleted} mapping-mode, and ${modelUsageDeleted} model-mode rows (older than ${MODEL_HISTORY_RETENTION_DAYS} days)`,
			);
		}

		logger.info("Model history retention cleanup completed successfully");
	} catch (error) {
		logger.error(
			"Error during model history retention cleanup",
			error instanceof Error ? error : new Error(String(error)),
		);
	} finally {
		await releaseLock(MODEL_HISTORY_RETENTION_LOCK_KEY);
	}
}

export async function batchProcessLogs(): Promise<number> {
	const lockAcquired = await acquireLock(CREDIT_PROCESSING_LOCK_KEY);
	if (!lockAcquired) {
		return 0;
	}

	let processedCount = 0;
	const deductedOrgIds: string[] = [];
	// Every org whose row was debited this batch (plan pools or regular
	// credits). Their tagged cache entries are evicted after commit so the
	// gateway's credit gates see the new balance immediately.
	const settledOrgIds: string[] = [];
	// Provider keys (BYOK or managed) whose accumulated usage crossed their
	// spend limit this batch — deactivated after the transaction commits.
	let overLimitProviderKeyIds: string[] = [];
	// LLM SDK: wallets that crossed below the low-balance threshold this
	// batch — webhooks are enqueued after the transaction commits.
	const walletLowBalanceEvents: Array<{
		projectId: string;
		walletId: string;
		endCustomerId: string;
		balance: string;
	}> = [];

	try {
		// Only batches that actually commit count toward processedCount, so a
		// rolled-back transaction leaves it at 0 and the loop backs off instead
		// of hot-looping on a failing batch.
		processedCount = await db.transaction(async (tx) => {
			// Get unprocessed logs with row-level locking to prevent concurrent processing
			const rows = await tx
				.select({
					id: log.id,
					created_at: log.createdAt,
					request_id: log.requestId,
					organization_id: log.organizationId,
					project_id: log.projectId,
					cost: log.cost,
					billing_cost: log.billingCost,
					cached: log.cached,
					api_key_id: log.apiKeyId,
					provider_key_id: log.providerKeyId,
					end_user_session_id: log.endUserSessionId,
					end_customer_wallet_id: log.endCustomerWalletId,
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
					cache_write_tokens: log.cacheWriteTokens,
					input_cost: log.inputCost,
					output_cost: log.outputCost,
					cached_input_cost: log.cachedInputCost,
					cache_write_input_cost: log.cacheWriteInputCost,
					estimated_cost: log.estimatedCost,
					error_details: log.errorDetails,
					trace_id: log.traceId,
					unified_finish_reason: log.unifiedFinishReason,
					source: log.source,
				})
				.from(log)
				.leftJoin(tables.project, eq(tables.project.id, log.projectId))
				.where(sql`${log.processedAt} IS NULL`)
				.orderBy(sql`${log.createdAt} ASC`)
				.limit(CREDIT_BATCH_SIZE)
				.for("update", { of: [log], skipLocked: true });
			const unprocessedLogs = { rows };

			if (unprocessedLogs.rows.length === 0) {
				return 0;
			}

			logger.info(
				`Processing ${unprocessedLogs.rows.length} logs for credit deduction and API key usage`,
			);

			// Group logs by organization and api key to calculate total costs.
			// We split per-org costs into a chat bucket and a default bucket so
			// the deduction step below can prefer chat-plan credits for requests
			// originating from Lounge (matching how users mentally account for
			// their plans), and dev-plan credits everywhere else.
			// Use Decimal.js to avoid floating point rounding errors.
			interface OrgCostBuckets {
				chat: Decimal;
				other: Decimal;
				chatPremium: Decimal;
				otherPremium: Decimal;
			}
			const orgCosts = new Map<string, OrgCostBuckets>();
			const apiKeyEvents = new Map<string, ApiKeyUsageEvent[]>();
			const endUserSessionEvents = new Map<string, ApiKeyUsageEvent[]>();
			const logIds: string[] = [];
			// LLM SDK: end-user wallet costs are accumulated separately and
			// debited from wallet.balance (not organization.credits). Keyed by
			// walletId; we keep a representative logId per wallet to link the
			// usage_debit ledger row back to a gateway log.
			const walletCosts = new Map<string, Decimal>();
			const walletLogIds = new Map<string, string>();
			// Upstream provider spend attributed per provider_key row (BYOK and
			// managed alike). Uses the raw `cost` column — what the credential
			// spends at the provider — not billingCost, which carries plan/margin
			// adjustments on what the org pays us.
			const providerKeyCosts = new Map<string, Decimal>();

			// Accepts both the current and the pre-move Lounge host: logs written
			// before the domain move are still queued here, and rewriting them is
			// not an option.
			const isChatSource = isLoungeSource;

			for (const raw of unprocessedLogs.rows) {
				const row = schema.parse(raw);

				// Log each processed log with JSON format
				logger.info("processing log", {
					kind: "log-process",
					status: row.hasError ? "error" : row.cached ? "cached" : "success",
					logId: row.id,
					createdAt: row.created_at,
					requestId: row.request_id,
					organizationId: row.organization_id,
					projectId: row.project_id,
					cost: row.cost,
					inputCost: row.input_cost,
					outputCost: row.output_cost,
					cachedInputCost: row.cached_input_cost,
					cacheWriteInputCost: row.cache_write_input_cost,
					estimatedCost: row.estimated_cost,
					error: !!row.hasError,
					cached: row.cached,
					apiKeyId: row.api_key_id,
					endUserSessionId: row.end_user_session_id,
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
					cacheWriteTokens: row.cache_write_tokens,
					errorDetails: row.error_details,
					traceId: row.trace_id,
					unifiedFinishReason: row.unified_finish_reason,
				});

				// Cached responses never hit the upstream, so they don't spend
				// against the credential. Runs before the wallet `continue` below so
				// end-user-wallet traffic still attributes provider spend.
				if (
					row.provider_key_id &&
					row.cost !== null &&
					row.cost > 0 &&
					!row.cached
				) {
					providerKeyCosts.set(
						row.provider_key_id,
						(providerKeyCosts.get(row.provider_key_id) ?? new Decimal(0)).plus(
							new Decimal(row.cost),
						),
					);
				}

				const sourceBucket = isChatSource(row.source) ? "chat" : "other";

				const addToBucket = (amount: Decimal, premium: boolean) => {
					const existing = orgCosts.get(row.organization_id) ?? {
						chat: new Decimal(0),
						other: new Decimal(0),
						chatPremium: new Decimal(0),
						otherPremium: new Decimal(0),
					};
					existing[sourceBucket] = existing[sourceBucket].plus(amount);
					if (premium) {
						const premiumBucket =
							sourceBucket === "chat" ? "chatPremium" : "otherPremium";
						existing[premiumBucket] = existing[premiumBucket].plus(amount);
					}
					orgCosts.set(row.organization_id, existing);
				};

				// Data retention storage is billed separately from inference (log.cost
				// never includes it), so it is deducted from org credits for every
				// mode: credits, api-keys (BYOK) and wallet-backed end-user traffic
				// alike — and also when inference itself was free or zeroed (e.g.
				// unbilled refusals keep their storage cost).
				if (row.data_storage_cost) {
					const storageCost = new Decimal(row.data_storage_cost);
					if (storageCost.greaterThan(0)) {
						addToBucket(storageCost, false);
					}
				}

				// Prefer the exact decimal billingCost (realtime and other
				// decimal-billed rows) over the legacy float cost column.
				const effectiveCost =
					row.billing_cost !== null
						? new Decimal(row.billing_cost)
						: row.cost !== null
							? new Decimal(row.cost)
							: null;

				if (effectiveCost && effectiveCost.greaterThan(0) && !row.cached) {
					const apiKeyCost = effectiveCost;
					const usageEvent = {
						cost: apiKeyCost,
						createdAt: row.created_at,
					};
					if (row.end_user_session_id) {
						const existingEvents =
							endUserSessionEvents.get(row.end_user_session_id) ?? [];
						existingEvents.push(usageEvent);
						endUserSessionEvents.set(row.end_user_session_id, existingEvents);
					} else {
						const existingEvents = apiKeyEvents.get(row.api_key_id) ?? [];
						existingEvents.push(usageEvent);
						apiKeyEvents.set(row.api_key_id, existingEvents);
					}

					// LLM SDK: end-user session traffic debits the wallet, not
					// the developer's org credits. Always full-cost (credits mode).
					if (row.end_customer_wallet_id) {
						const currentWalletCost =
							walletCosts.get(row.end_customer_wallet_id) ?? new Decimal(0);
						walletCosts.set(
							row.end_customer_wallet_id,
							currentWalletCost.plus(apiKeyCost),
						);
						if (!walletLogIds.has(row.end_customer_wallet_id)) {
							walletLogIds.set(row.end_customer_wallet_id, row.id);
						}
						logIds.push(row.id);
						continue;
					}

					// Inference cost: credits mode deducts the full cost from org
					// credits; api-keys mode pays the provider directly (BYOK), so
					// only the storage cost above is billed.
					if (row.used_mode === "credits") {
						addToBucket(
							apiKeyCost,
							Boolean(row.used_model && isPremiumUsedModel(row.used_model)),
						);
					}
				}

				logIds.push(row.id);
			}

			// Batch update organization credits within the same transaction.
			// Also calculate referral earnings (1% of spent credits).
			//
			// Deduction order is source-aware:
			//   • Lounge requests → chat plan → dev plan → regular
			//   • everything else → dev plan → chat plan → regular
			// The non-preferred plan acts as a fallback if the preferred plan's
			// cycle credits are exhausted, so a single org with both plans gets
			// the same total spend ceiling regardless of source.
			const referralEarnings = new Map<string, Decimal>();

			interface PlanPool {
				kind: "chat" | "dev";
				remaining: Decimal;
				premiumCreditsUsed?: Decimal;
				premiumWeekStart?: Date | null;
			}

			const deductFromPlanPool = async (
				orgId: string,
				pool: PlanPool,
				amount: Decimal,
				premiumAmount: Decimal,
			) => {
				const amountStr = amount.toString();
				if (pool.kind === "chat") {
					await tx
						.update(organization)
						.set({
							chatPlanCreditsUsed: sql`${organization.chatPlanCreditsUsed} + ${amountStr}`,
						})
						.where(eq(organization.id, orgId));
					logger.debug(
						`Deducted ${amountStr} chat plan credits from organization ${orgId}`,
					);
				} else {
					const weekExpired = isPremiumWeekExpired(pool.premiumWeekStart);
					const now = new Date();
					const premiumAmountStr = premiumAmount.toString();

					if (premiumAmount.greaterThan(0)) {
						if (weekExpired) {
							await tx
								.update(organization)
								.set({
									devPlanCreditsUsed: sql`${organization.devPlanCreditsUsed} + ${amountStr}`,
									devPlanPremiumCreditsUsed: premiumAmountStr,
									devPlanPremiumWeekStart: now,
								})
								.where(eq(organization.id, orgId));
							pool.premiumCreditsUsed = premiumAmount;
							pool.premiumWeekStart = now;
						} else {
							await tx
								.update(organization)
								.set({
									devPlanCreditsUsed: sql`${organization.devPlanCreditsUsed} + ${amountStr}`,
									devPlanPremiumCreditsUsed: sql`${organization.devPlanPremiumCreditsUsed} + ${premiumAmountStr}`,
								})
								.where(eq(organization.id, orgId));
							pool.premiumCreditsUsed = (
								pool.premiumCreditsUsed ?? new Decimal(0)
							).plus(premiumAmount);
						}
					} else if (weekExpired && pool.premiumWeekStart) {
						await tx
							.update(organization)
							.set({
								devPlanCreditsUsed: sql`${organization.devPlanCreditsUsed} + ${amountStr}`,
								devPlanPremiumCreditsUsed: "0",
								devPlanPremiumWeekStart: now,
							})
							.where(eq(organization.id, orgId));
						pool.premiumCreditsUsed = new Decimal(0);
						pool.premiumWeekStart = now;
					} else {
						await tx
							.update(organization)
							.set({
								devPlanCreditsUsed: sql`${organization.devPlanCreditsUsed} + ${amountStr}`,
							})
							.where(eq(organization.id, orgId));
					}
					logger.debug(
						`Deducted ${amountStr} dev plan credits from organization ${orgId}`,
					);
				}
				pool.remaining = pool.remaining.minus(amount);
			};

			for (const [orgId, buckets] of orgCosts.entries()) {
				const totalCost = buckets.chat.plus(buckets.other);
				if (totalCost.lessThanOrEqualTo(0)) {
					continue;
				}

				settledOrgIds.push(orgId);

				const org = await tx.query.organization.findFirst({
					where: { id: { eq: orgId } },
				});

				const chatPool: PlanPool | null =
					org && org.chatPlan !== "none"
						? {
								kind: "chat",
								remaining: new Decimal(org.chatPlanCreditsLimit || "0").minus(
									new Decimal(org.chatPlanCreditsUsed || "0"),
								),
							}
						: null;

				const devPool: PlanPool | null =
					org && org.devPlan !== "none"
						? {
								kind: "dev",
								remaining: new Decimal(org.devPlanCreditsLimit || "0").minus(
									new Decimal(org.devPlanCreditsUsed || "0"),
								),
								premiumCreditsUsed: new Decimal(
									org.devPlanPremiumCreditsUsed || "0",
								),
								premiumWeekStart: org.devPlanPremiumWeekStart,
							}
						: null;

				const drainBucket = async (
					bucketCost: Decimal,
					premiumCost: Decimal,
					preferred: PlanPool | null,
					fallback: PlanPool | null,
				): Promise<{ remaining: Decimal; remainingPremium: Decimal }> => {
					let remaining = bucketCost;
					let remainingPremium = premiumCost;
					// With PAYG overflow enabled, premium spend past the weekly
					// fair-use allowance must not consume the plan pools: the gateway
					// admits those requests on the strength of the credits balance, so
					// the excess is held out of the pool drain here and falls through
					// to the regular-credits remainder below. Without this the cap
					// would stop limiting anything — over-cap premium would just keep
					// draining the monthly pool.
					// Scoped to buckets whose spend is the dev pool's to pay (its own
					// bucket, or any bucket when there is no chat pool) — a dual-plan
					// org's chat-sourced premium keeps draining the chat pool as before.
					let premiumOverflow = new Decimal(0);
					if (
						org?.devPlanPaygEnabled &&
						devPool &&
						(preferred === devPool || !chatPool) &&
						remainingPremium.greaterThan(0)
					) {
						const allowanceLeft = new Decimal(
							getRemainingPremiumWeeklyAllowance(
								org.devPlan as DevPlanTier,
								devPool.premiumCreditsUsed?.toNumber() ?? 0,
								devPool.premiumWeekStart,
							),
						);
						premiumOverflow = Decimal.max(
							0,
							remainingPremium.minus(allowanceLeft),
						);
						remaining = remaining.minus(premiumOverflow);
						remainingPremium = remainingPremium.minus(premiumOverflow);
					}
					for (const pool of [preferred, fallback]) {
						if (!pool || remaining.lessThanOrEqualTo(0)) {
							continue;
						}
						if (pool.remaining.lessThanOrEqualTo(0)) {
							continue;
						}
						const take = Decimal.min(remaining, pool.remaining);
						const premiumTake =
							pool.kind === "dev"
								? Decimal.min(remainingPremium, take)
								: new Decimal(0);
						await deductFromPlanPool(orgId, pool, take, premiumTake);
						remaining = remaining.minus(take);
						remainingPremium = remainingPremium.minus(premiumTake);
					}
					return {
						remaining: remaining.plus(premiumOverflow),
						remainingPremium,
					};
				};

				const fromChat = buckets.chat.greaterThan(0)
					? await drainBucket(
							buckets.chat,
							buckets.chatPremium,
							chatPool,
							devPool,
						)
					: { remaining: new Decimal(0), remainingPremium: new Decimal(0) };

				const fromOther = buckets.other.greaterThan(0)
					? await drainBucket(
							buckets.other,
							buckets.otherPremium,
							devPool,
							chatPool,
						)
					: { remaining: new Decimal(0), remainingPremium: new Decimal(0) };

				const remainingCost = fromChat.remaining.plus(fromOther.remaining);

				// A dev-plan org that has not opted into pay-as-you-go overflow
				// cannot spend its `credits` balance: getAvailableCredits zeroes
				// that pool, so the gateway rejects the request rather than
				// billing it. Draining `credits` here would therefore charge a
				// balance the org was never allowed to use — silently eating an
				// admin gift, or pushing an empty balance negative so a later
				// top-up first pays off phantom debt. The overshoot exists
				// because requests admitted while the pool still had room can
				// collectively cost more than was left, so keep it on the plan
				// pool: usage stays accounted for and the allowance stays the
				// hard cap the plan promises.
				const plannedOverflowOnly =
					org && org.devPlan !== "none" && !org.devPlanPaygEnabled;

				if (remainingCost.greaterThan(0) && plannedOverflowOnly && devPool) {
					await deductFromPlanPool(
						orgId,
						devPool,
						remainingCost,
						fromChat.remainingPremium.plus(fromOther.remainingPremium),
					);
					logger.debug(
						`Kept ${remainingCost.toString()} on the dev plan pool for organization ${orgId} (pay-as-you-go overflow disabled)`,
					);
				} else if (remainingCost.greaterThan(0)) {
					const costStr = remainingCost.toString();
					await tx
						.update(organization)
						.set({
							credits: sql`${organization.credits} - ${costStr}`,
						})
						.where(eq(organization.id, orgId));

					deductedOrgIds.push(orgId);

					logger.debug(
						`Deducted ${costStr} regular credits from organization ${orgId}`,
					);
				}

				// 1% referral earnings on the full charge regardless of which pool paid.
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

			// deductedOrgIds is populated inside the loop above — only orgs
			// with actual regular-credit deductions are included.

			// LLM SDK: debit end-user wallets and append usage_debit ledger
			// rows. Kept fully separate from the org-credit path above so normal
			// developer traffic is untouched.
			for (const [walletId, totalCost] of walletCosts.entries()) {
				if (!totalCost.greaterThan(0)) {
					continue;
				}
				const costStr = totalCost.toString();
				// Debit atomically and derive the resulting balance from the row we
				// actually updated, so a concurrent top-up/reversal can't make
				// balanceAfter or the low-balance crossing check stale.
				const [updatedWallet] = await tx
					.update(tables.wallet)
					.set({
						balance: sql`${tables.wallet.balance} - ${costStr}`,
					})
					.where(eq(tables.wallet.id, walletId))
					.returning();

				if (!updatedWallet) {
					logger.warn(
						`Wallet ${walletId} not found while debiting end-user usage`,
					);
					continue;
				}

				const newBalance = new Decimal(updatedWallet.balance);
				const prevBalance = newBalance.plus(totalCost);

				// Emit a single low-balance event on the downward crossing.
				if (
					prevBalance.greaterThanOrEqualTo(WALLET_LOW_BALANCE_THRESHOLD) &&
					newBalance.lessThan(WALLET_LOW_BALANCE_THRESHOLD)
				) {
					walletLowBalanceEvents.push({
						projectId: updatedWallet.projectId,
						walletId,
						endCustomerId: updatedWallet.endCustomerId,
						balance: newBalance.toString(),
					});
				}

				await tx.insert(tables.walletLedger).values({
					walletId,
					endCustomerId: updatedWallet.endCustomerId,
					organizationId: updatedWallet.organizationId,
					type: "usage_debit",
					amount: totalCost.negated().toString(),
					balanceAfter: newBalance.toString(),
					gatewayLogId: walletLogIds.get(walletId) ?? null,
					description: "AI usage",
				});

				logger.debug(`Debited ${costStr} from end-user wallet ${walletId}`);
			}

			// Apply referral earnings to referrer organizations
			for (const [referrerOrgId, earnings] of referralEarnings.entries()) {
				if (earnings.greaterThan(0)) {
					const earningsStr = earnings.toString();
					await tx
						.update(organization)
						.set({
							credits: sql`${organization.credits} + ${earningsStr}`,
							referralEarnings: sql`${organization.referralEarnings} + ${earningsStr}`,
						})
						.where(eq(organization.id, referrerOrgId));

					logger.info(
						`Added ${earningsStr} referral credits to organization ${referrerOrgId}`,
					);
				}
			}

			// Batch update API key usage within the same transaction.
			// Period windows are replayed from each log's event time so delayed
			// processing does not shift usage across recurring-limit boundaries.
			const apiKeyIds = Array.from(apiKeyEvents.keys());
			if (apiKeyIds.length > 0) {
				const apiKeyRecords = await tx.query.apiKey.findMany({
					columns: {
						id: true,
						currentPeriodStartedAt: true,
						currentPeriodUsage: true,
						periodUsageLimit: true,
						periodUsageDurationValue: true,
						periodUsageDurationUnit: true,
					},
					where: {
						id: {
							in: apiKeyIds,
						},
					},
				});
				const apiKeyRecordsById = new Map(
					apiKeyRecords.map((record) => [record.id, record]),
				);

				for (const [apiKeyId, events] of apiKeyEvents.entries()) {
					const apiKeyRecord = apiKeyRecordsById.get(apiKeyId);
					if (!apiKeyRecord) {
						logger.warn(
							`Skipping usage update for missing API key ${apiKeyId}`,
						);
						continue;
					}

					const usageUpdate = buildApiKeyUsageUpdate(apiKeyRecord, events);
					const costStr = usageUpdate.totalUsageCost.toString();

					await tx
						.update(apiKey)
						.set({
							usage: sql`${apiKey.usage} + ${costStr}`,
							...(usageUpdate.hasPeriodUsageUpdate && {
								currentPeriodUsage: usageUpdate.currentPeriodUsage,
								currentPeriodStartedAt: usageUpdate.currentPeriodStartedAt,
							}),
						})
						.where(eq(apiKey.id, apiKeyId));

					logger.debug(`Added ${costStr} usage to API key ${apiKeyId}`);
				}
			}

			// Batch update end-user session usage separately from the hidden
			// aggregate API key. This keeps API-key stats low-cardinality while
			// preserving session max-spend and period-limit enforcement.
			const endUserSessionIds = Array.from(endUserSessionEvents.keys());
			if (endUserSessionIds.length > 0) {
				const sessionRecords = await tx.query.endUserSession.findMany({
					columns: {
						id: true,
						currentPeriodStartedAt: true,
						currentPeriodUsage: true,
						periodUsageLimit: true,
						periodUsageDurationValue: true,
						periodUsageDurationUnit: true,
					},
					where: {
						id: {
							in: endUserSessionIds,
						},
					},
				});
				const sessionRecordsById = new Map(
					sessionRecords.map((record) => [record.id, record]),
				);

				for (const [sessionId, events] of endUserSessionEvents.entries()) {
					const sessionRecord = sessionRecordsById.get(sessionId);
					if (!sessionRecord) {
						logger.warn(
							`Skipping usage update for missing end-user session ${sessionId}`,
						);
						continue;
					}

					const usageUpdate = buildApiKeyUsageUpdate(sessionRecord, events);
					const costStr = usageUpdate.totalUsageCost.toString();

					await tx
						.update(tables.endUserSession)
						.set({
							usage: sql`${tables.endUserSession.usage} + ${costStr}`,
							...(usageUpdate.hasPeriodUsageUpdate && {
								currentPeriodUsage: usageUpdate.currentPeriodUsage,
								currentPeriodStartedAt: usageUpdate.currentPeriodStartedAt,
							}),
						})
						.where(eq(tables.endUserSession.id, sessionId));

					logger.debug(
						`Added ${costStr} usage to end-user session ${sessionId}`,
					);
				}
			}

			// Accumulate upstream spend per provider key. Plain (uncached) writes
			// on purpose: nothing hot-path reads `usage`, and invalidating the
			// provider_key read cache every batch would hammer the database.
			if (providerKeyCosts.size > 0) {
				for (const [providerKeyId, keyCost] of providerKeyCosts.entries()) {
					const costStr = keyCost.toString();
					await tx
						.update(tables.providerKey)
						.set({
							usage: sql`${tables.providerKey.usage} + ${costStr}`,
						})
						.where(eq(tables.providerKey.id, providerKeyId));
				}

				// Detect keys that crossed their spend limit; the status flip
				// happens after commit so it can go through the cache-invalidating
				// client without holding the batch transaction open.
				const overLimitKeys = await tx
					.select({ id: tables.providerKey.id })
					.from(tables.providerKey)
					.where(
						and(
							inArray(tables.providerKey.id, [...providerKeyCosts.keys()]),
							eq(tables.providerKey.status, "active"),
							isNotNull(tables.providerKey.usageLimit),
							sql`${tables.providerKey.usage} >= ${tables.providerKey.usageLimit}`,
						),
					);
				overLimitProviderKeyIds = overLimitKeys.map((key) => key.id);
			}

			// Mark all logs as processed within the same transaction.
			// `= ANY($1)` keeps the query text constant across batch sizes; see
			// the data-retention cleanup above for why this matters.
			await tx
				.update(log)
				.set({
					processedAt: new Date(),
				})
				.where(sql`${log.id} = ANY(${sql.param(logIds)}::text[])`);

			logger.debug(`Marked ${logIds.length} logs as processed`);

			return unprocessedLogs.rows.length;
		});

		// Evict the debited orgs' tagged cache entries so the gateway's next
		// org read (and thus its credit gate) sees the new balance now rather
		// than after the cache TTL — the debits above went through the plain
		// client, which never fires cache invalidation. Best-effort.
		await invalidateOrganizationsCache(settledOrgIds);

		// Auto-deactivate provider keys that hit their spend limit. Goes through
		// cdb so the gateway's provider_key read cache and SWR mirrors are
		// invalidated and the key drops out of rotation promptly — and only runs
		// when a key actually crossed, so the 5s batch loop never busts the
		// cache on quiet batches. The predicate is repeated to stay idempotent
		// and to respect a limit raised between commit and flip. If the process
		// dies in between, the key's next attributed batch re-detects it.
		if (overLimitProviderKeyIds.length > 0) {
			const deactivated = await cdb
				.update(tables.providerKey)
				.set({ status: "inactive" })
				.where(
					and(
						inArray(tables.providerKey.id, overLimitProviderKeyIds),
						eq(tables.providerKey.status, "active"),
						isNotNull(tables.providerKey.usageLimit),
						sql`${tables.providerKey.usage} >= ${tables.providerKey.usageLimit}`,
					),
				)
				.returning({
					id: tables.providerKey.id,
					provider: tables.providerKey.provider,
					managed: tables.providerKey.managed,
					organizationId: tables.providerKey.organizationId,
					usage: tables.providerKey.usage,
					usageLimit: tables.providerKey.usageLimit,
				});
			for (const key of deactivated) {
				logger.info("Provider key auto-deactivated: spend limit reached", {
					providerKeyId: key.id,
					provider: key.provider,
					managed: key.managed,
					organizationId: key.organizationId,
					usage: key.usage,
					usageLimit: key.usageLimit,
				});
			}
		}

		// Async low-balance alert check (outside transaction, non-blocking)
		if (deductedOrgIds.length > 0) {
			void checkLowBalanceAlerts(deductedOrgIds);
		}

		// LLM SDK: enqueue end-user wallet low-balance webhooks (best-effort).
		for (const ev of walletLowBalanceEvents) {
			try {
				await enqueueWebhookDeliveries({
					projectId: ev.projectId,
					eventType: "wallet.low_balance",
					data: {
						walletId: ev.walletId,
						endCustomerId: ev.endCustomerId,
						balance: ev.balance,
						threshold: WALLET_LOW_BALANCE_THRESHOLD,
					},
				});
			} catch (err) {
				logger.warn("Failed to enqueue wallet.low_balance webhook", {
					walletId: ev.walletId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	} catch (error) {
		logger.error(
			"Error processing batch credit deductions",
			error instanceof Error ? error : new Error(String(error)),
		);
	} finally {
		await releaseLock(CREDIT_PROCESSING_LOCK_KEY);
	}

	return processedCount;
}

async function checkLowBalanceAlerts(orgIds: string[]): Promise<void> {
	try {
		const orgs = await db
			.select()
			.from(organization)
			.where(inArray(organization.id, orgIds));

		for (const org of orgs) {
			try {
				const lastTopUp = Number(org.lastTopUpAmount ?? 0);
				if (lastTopUp <= 0) {
					continue;
				}

				const currentBalance = Number(org.credits ?? 0);
				const ratio = currentBalance / lastTopUp;

				if (ratio < 0.2) {
					await enqueueLowBalanceEmail(
						org.id,
						"low_balance_20",
						currentBalance,
					);
				}

				if (ratio < 0.05) {
					await enqueueLowBalanceEmail(org.id, "low_balance_5", currentBalance);
				}
			} catch (error) {
				logger.error(
					`Error checking low balance alerts for org ${org.id}`,
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}
	} catch (error) {
		logger.error(
			"Error checking low balance alerts",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

async function enqueueLowBalanceEmail(
	organizationId: string,
	emailType: "low_balance_20" | "low_balance_5",
	currentBalance: number,
): Promise<void> {
	const email = await resolveVerifiedOrgRecipient(organizationId);
	if (!email) {
		return;
	}

	// Check if already sent for this cycle (without inserting yet)
	const existing = await db.query.followUpEmail.findFirst({
		where: {
			organizationId: { eq: organizationId },
			emailType: { eq: emailType },
		},
	});

	if (existing) {
		return;
	}

	const threshold = emailType === "low_balance_20" ? "20" : "5";

	if (process.env.EMAIL_FOLLOW_UPS !== "true") {
		logger.info("Low balance alert (dry run)", {
			kind: "low_balance_alert",
			emailType,
			organizationId,
			to: email,
			currentBalance,
			threshold,
		});
		return;
	}

	// Send first, then persist dedup record on success
	await sendLowBalanceEmail({
		to: email,
		currentBalance,
		threshold,
		organizationId,
	});

	posthog.capture({
		distinctId: "organization",
		event: "low_balance_alert_sent",
		groups: { organization: organizationId },
		properties: { threshold, currentBalance, organization: organizationId },
	});

	// Persist dedup record after successful send
	await db
		.insert(tables.followUpEmail)
		.values({
			organizationId,
			emailType,
			sentTo: email,
		})
		.onConflictDoNothing();

	logger.info("Low balance alert sent", {
		emailType,
		organizationId,
		currentBalance,
		threshold,
	});
}

// Circuit breaker: skip queue consumption while postgres is known-down.
export const logInsertCircuit = {
	consecutiveFailures: 0,
	nextAttemptAt: 0,
};

const LOG_INSERT_BACKOFF_BASE_MS = 1000;
const LOG_INSERT_BACKOFF_MAX_MS = 5 * 60 * 1000;

function recordLogInsertFailure(): void {
	logInsertCircuit.consecutiveFailures += 1;
	const backoff = Math.min(
		LOG_INSERT_BACKOFF_BASE_MS *
			Math.pow(2, logInsertCircuit.consecutiveFailures - 1),
		LOG_INSERT_BACKOFF_MAX_MS,
	);
	logInsertCircuit.nextAttemptAt = Date.now() + backoff;
	logger.warn(
		`Postgres log insertion failing; backing off for ${backoff}ms (consecutive failures: ${logInsertCircuit.consecutiveFailures})`,
	);
}

function recordLogInsertSuccess(): void {
	if (logInsertCircuit.consecutiveFailures > 0) {
		logger.info(
			`Postgres log insertion recovered after ${logInsertCircuit.consecutiveFailures} consecutive failures`,
		);
	}
	logInsertCircuit.consecutiveFailures = 0;
	logInsertCircuit.nextAttemptAt = 0;
}

// Returns the number of messages successfully inserted, so the drain loop can
// decide whether to sleep (partial batch) or immediately fetch the next batch
// (full batch, queue likely still backed up).
export async function processLogQueue(): Promise<number> {
	if (Date.now() < logInsertCircuit.nextAttemptAt) {
		return 0;
	}

	const message = await consumeFromQueue(LOG_QUEUE, LOG_QUEUE_BATCH_SIZE);

	if (!message) {
		return 0;
	}

	const MAX_RETRIES = 5;

	try {
		// The gateway decides what to persist: it strips request/response payload
		// fields before publishing for orgs that don't retain data, so the worker
		// inserts the queued rows as-is with no per-batch org retention lookup.
		const logData = message.map((i) => JSON.parse(i) as LogInsertData);

		// Insert logs with retry logic
		let lastError: Error | undefined;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				const insertStart = Date.now();
				await db.insert(log).values(logData);
				const insertMs = Date.now() - insertStart;
				recordLogInsertSuccess();
				logger.info(
					`Processed log batch: ${message.length} rows (insert ${insertMs}ms)`,
				);
				return message.length; // Success, exit function
			} catch (insertError) {
				lastError =
					insertError instanceof Error
						? insertError
						: new Error(String(insertError));

				if (attempt < MAX_RETRIES && !isStopRequested()) {
					const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s, 16s, ...
					logger.warn(
						`Failed to insert logs (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`,
						lastError,
					);
					await interruptibleSleep(delay);
					if (isStopRequested()) {
						break;
					}
				} else {
					break;
				}
			}
		}

		// All retries exhausted, push messages back to queue for later processing
		recordLogInsertFailure();
		logger.error(
			`Failed to insert logs after ${MAX_RETRIES + 1} attempts, pushing back to queue`,
			lastError,
		);

		// Re-add messages to queue
		for (const msg of message) {
			await publishToQueue(LOG_QUEUE, JSON.parse(msg));
		}

		return 0;
	} catch (error) {
		// Opens the circuit when the pre-insert postgres read (cdb.select) throws,
		// so we stop draining the queue while postgres is down.
		recordLogInsertFailure();
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

		return 0;
	}
}

let isWorkerRunning = false;
let activeLoops = 0;
let stopFailed = false;
// Gate minute-history retention on the hourly backfill having completed this
// process. The hourly rollups are reconstructed from minute rows on startup
// (backfillHourlyHistoryIfNeeded walks oldest->newest); pruning minute rows
// older than 30d before that finishes would permanently truncate the
// kept-forever hourly history. Defaults false so a failed/never-run backfill
// leaves cleanup disabled rather than risking data loss.
let hourlyBackfillComplete = false;
// Live hourly rollups must not race the startup minute backfill. Otherwise an
// hour can be written from a partially populated minute sidecar and then look
// complete to the hourly backfill's missing-row check.
let liveHourlyRollupsReady = false;

// Independent worker loops
async function runLogQueueLoop(loopIndex = 0) {
	activeLoops++;
	logger.info(`Starting log queue processing loop ${loopIndex}...`);
	try {
		while (!isStopRequested()) {
			try {
				const drained = await processLogQueue();
				// Only idle-poll when the queue came back empty. As long as any
				// messages were drained the queue is still backed up, so loop
				// straight into the next batch instead of sleeping. Tying this to
				// LOG_QUEUE_BATCH_SIZE was wrong: when the batch size is raised
				// above the steady-state queue depth the sleep fired every cycle.
				// 250ms keeps queue latency out of the billing settlement gap at
				// the cost of four cheap LPOPs per idle second.
				if (drained === 0) {
					await interruptibleSleep(250);
				}
			} catch (error) {
				logger.error(
					`Error in log queue loop ${loopIndex}`,
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info(`Log queue loop ${loopIndex} stopped`);
	}
}

async function runAutoTopUpLoop() {
	activeLoops++;
	const interval = (process.env.NODE_ENV === "production" ? 120 : 5) * 1000; // 2 minutes in prod, 5 seconds in dev
	logger.info(
		`Starting auto top-up loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await processAutoTopUp();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in auto top-up loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
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
		while (!isStopRequested()) {
			try {
				const processed = await batchProcessLogs();

				// A full batch means more unprocessed logs remain, so loop straight
				// into the next batch instead of sleeping. Without this the loop is
				// hard-capped at CREDIT_BATCH_SIZE / interval logs per second (e.g.
				// 100 / 5s = 20/s) regardless of how far behind credit processing is.
				if (processed < CREDIT_BATCH_SIZE) {
					await interruptibleSleep(interval);
				}
			} catch (error) {
				logger.error(
					"Error in batch process loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
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

		if (liveHourlyRollupsReady) {
			try {
				await calculateHourlyHistory();
			} catch (error) {
				logger.error(
					"Error in initial hourly history calculation",
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}

		while (!isStopRequested()) {
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

			if (isStopRequested()) {
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

			if (liveHourlyRollupsReady) {
				try {
					await calculateHourlyHistory();
				} catch (error) {
					logger.error(
						"Error in hourly history calculation",
						error instanceof Error ? error : new Error(String(error)),
					);
				}
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
		while (!isStopRequested()) {
			try {
				await calculateCurrentMinuteHistory();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in current minute history loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Current minute history loop stopped");
	}
}

async function runVideoJobsLoop() {
	activeLoops++;
	const interval = VIDEO_JOB_POLL_INTERVAL_SECONDS * 1000;
	logger.info(
		`Starting video jobs loop (interval: ${VIDEO_JOB_POLL_INTERVAL_SECONDS} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await processPendingVideoJobs();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in video jobs loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Video jobs loop stopped");
	}
}

async function runVideoWebhookLoop() {
	activeLoops++;
	const interval = VIDEO_WEBHOOK_POLL_INTERVAL_SECONDS * 1000;
	logger.info(
		`Starting video webhook loop (interval: ${VIDEO_WEBHOOK_POLL_INTERVAL_SECONDS} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await processPendingWebhookDeliveries();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in video webhook loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Video webhook loop stopped");
	}
}

async function runAggregatedStatsLoop() {
	activeLoops++;
	logger.info(
		"Starting aggregated stats loop (every 1min, aligned to minute boundary)...",
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

		while (!isStopRequested()) {
			const now = new Date();
			const nextRun = new Date(
				now.getFullYear(),
				now.getMonth(),
				now.getDate(),
				now.getHours(),
				now.getMinutes() + 1,
				0,
				100, // 100ms buffer
			);

			const delay = nextRun.getTime() - now.getTime();

			await interruptibleSleep(delay);

			if (isStopRequested()) {
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
		while (!isStopRequested()) {
			try {
				await refreshProjectHourlyStats();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in project stats loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Project stats loop stopped");
	}
}

async function runGlobalStatsLoop() {
	activeLoops++;
	const interval = GLOBAL_STATS_INTERVAL_SECONDS * 1000;
	logger.info(
		`Starting global stats loop (interval: ${GLOBAL_STATS_INTERVAL_SECONDS} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await processClosedHours();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in global daily stats loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Global stats loop stopped");
	}
}

async function runDataRetentionLoop() {
	activeLoops++;
	const interval = (process.env.NODE_ENV === "production" ? 300 : 60) * 1000; // 5 minutes in prod, 1 minute in dev
	logger.info(
		`Starting data retention loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await cleanupExpiredLogData();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in data retention loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Data retention loop stopped");
	}
}

async function runModelHistoryRetentionLoop() {
	activeLoops++;
	const interval = (process.env.NODE_ENV === "production" ? 3600 : 60) * 1000; // hourly in prod, 1 minute in dev
	logger.info(
		`Starting model history retention loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				if (hourlyBackfillComplete) {
					await cleanupExpiredModelHistory();
				} else {
					logger.info(
						"Skipping model history cleanup until hourly backfill completes",
					);
				}

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in model history retention loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Model history retention loop stopped");
	}
}

/**
 * LLM SDK: deactivate expired end-user session tokens so they stop
 * authenticating and don't accumulate.
 */
async function cleanupExpiredEndUserSessions(): Promise<void> {
	const lockAcquired = await acquireLock(END_USER_SESSION_CLEANUP_LOCK_KEY);
	if (!lockAcquired) {
		return;
	}

	try {
		const expired = await db
			.update(tables.endUserSession)
			.set({ status: "deleted" })
			.where(
				and(
					eq(tables.endUserSession.status, "active"),
					lt(tables.endUserSession.expiresAt, new Date()),
				),
			)
			.returning({ id: tables.endUserSession.id });

		if (expired.length > 0) {
			logger.info(`Deactivated ${expired.length} expired end-user session(s)`);
		}
	} finally {
		await releaseLock(END_USER_SESSION_CLEANUP_LOCK_KEY);
	}
}

async function runEndUserSessionCleanupLoop() {
	activeLoops++;
	const interval = (process.env.NODE_ENV === "production" ? 300 : 60) * 1000; // 5 minutes in prod, 1 minute in dev
	logger.info(
		`Starting end-user session cleanup loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await cleanupExpiredEndUserSessions();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in end-user session cleanup loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Ephemeral session cleanup loop stopped");
	}
}

/**
 * Disable developer API keys whose TTL has passed. The gateway already rejects
 * expired keys in real time; this persists the "inactive" status so the
 * dashboard reflects it and the key can be reactivated with a fresh TTL.
 */
async function disableExpiredApiKeys(): Promise<void> {
	const lockAcquired = await acquireLock(API_KEY_EXPIRATION_LOCK_KEY);
	if (!lockAcquired) {
		return;
	}

	try {
		// `lt(expiresAt, now)` naturally skips keys with a NULL expiry (never
		// expire). Scoped to developer keys; platform/end-user keys have their
		// own lifecycle.
		const expired = await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(
				and(
					eq(tables.apiKey.keyType, "user"),
					eq(tables.apiKey.status, "active"),
					lt(tables.apiKey.expiresAt, new Date()),
				),
			)
			.returning({ id: tables.apiKey.id });

		if (expired.length > 0) {
			logger.info(`Disabled ${expired.length} expired API key(s)`);
		}
	} finally {
		await releaseLock(API_KEY_EXPIRATION_LOCK_KEY);
	}
}

async function runApiKeyExpirationLoop() {
	activeLoops++;
	const interval = (process.env.NODE_ENV === "production" ? 300 : 60) * 1000; // 5 minutes in prod, 1 minute in dev
	logger.info(
		`Starting API key expiration loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await disableExpiredApiKeys();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in API key expiration loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("API key expiration loop stopped");
	}
}

async function flushLimitHitCounters(): Promise<void> {
	const lockAcquired = await acquireLock(LIMIT_HIT_FLUSH_LOCK_KEY);
	if (!lockAcquired) {
		return;
	}

	try {
		// Single flusher (the lock) is what makes the RENAME-based drain in
		// flushLimitHits safe.
		const flushed = await flushLimitHits();
		if (flushed > 0) {
			logger.info(`Flushed ${flushed} limit-hit bucket(s) to Postgres`);
		}
	} finally {
		await releaseLock(LIMIT_HIT_FLUSH_LOCK_KEY);
	}
}

async function runLimitHitFlushLoop() {
	activeLoops++;
	const interval =
		parseInt(process.env.LIMIT_HIT_FLUSH_INTERVAL_SECONDS || "60", 10) * 1000;
	logger.info(
		`Starting limit-hit flush loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await flushLimitHitCounters();

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in limit-hit flush loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Limit-hit flush loop stopped");
	}
}

// Client-confirmation credit top-ups (create-payment-intent hands the browser
// a client secret to confirm later) can be abandoned. Their velocity
// reservation self-expires with its TTL, but the client secret stays
// confirmable — so stockpiled secrets could later all be confirmed at once,
// blowing through the top-up cap with no reservation counting them. Cancel
// PIs still unconfirmed well past the reservation TTL; a genuinely active
// checkout finishes in minutes, and a canceled PI just means starting over.
const STALE_TOPUP_PI_MAX_AGE_SECONDS = 35 * 60;
const STALE_TOPUP_PI_CANCELABLE_STATUSES = [
	"requires_payment_method",
	"requires_confirmation",
	"requires_action",
] as const;

async function cancelStaleTopUpPaymentIntents(): Promise<number> {
	const nowSeconds = Math.floor(Date.now() / 1000);
	const cutoff = nowSeconds - STALE_TOPUP_PI_MAX_AGE_SECONDS;
	let canceled = 0;
	for (const status of STALE_TOPUP_PI_CANCELABLE_STATUSES) {
		// Search is eventually consistent (~1 min lag) — irrelevant at a
		// 35-minute horizon. One page per status per run bounds Stripe traffic;
		// leftovers are picked up next run.
		const page = await getStripe().paymentIntents.search({
			query: `status:"${status}" AND metadata["flow"]:"client_confirmation" AND created<${cutoff}`,
			limit: 100,
		});
		for (const pi of page.data) {
			try {
				await getStripe().paymentIntents.cancel(pi.id, {
					cancellation_reason: "abandoned",
				});
				canceled++;
			} catch (error) {
				// Lost a race with a just-started confirmation (or another
				// canceller) — the PI is no longer cancelable; skip it.
				logger.warn("Could not cancel stale top-up PaymentIntent", {
					paymentIntentId: pi.id,
					status,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
	return canceled;
}

async function runStaleTopUpPiCancelLoop() {
	if (!process.env.STRIPE_SECRET_KEY) {
		logger.info(
			"Stale top-up PaymentIntent cancel loop disabled (no STRIPE_SECRET_KEY)",
		);
		return;
	}
	activeLoops++;
	const interval =
		parseInt(process.env.STALE_TOPUP_PI_CANCEL_INTERVAL_SECONDS || "600", 10) *
		1000;
	logger.info(
		`Starting stale top-up PaymentIntent cancel loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				const lockAcquired = await acquireLock(STALE_TOPUP_PI_LOCK_KEY);
				if (lockAcquired) {
					try {
						const canceled = await cancelStaleTopUpPaymentIntents();
						if (canceled > 0) {
							logger.info(`Canceled ${canceled} stale top-up PaymentIntent(s)`);
						}
					} finally {
						await releaseLock(STALE_TOPUP_PI_LOCK_KEY);
					}
				}

				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in stale top-up PaymentIntent cancel loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Stale top-up PaymentIntent cancel loop stopped");
	}
}

const MAX_WEBHOOK_ATTEMPTS = 5;
const WEBHOOK_DELIVERY_BATCH_SIZE = 50;

/**
 * LLM SDK: deliver queued platform webhook events with an HMAC signature,
 * retrying with exponential backoff. The signature header is
 * `X-LLMGateway-Signature: t=<unix>,v1=<hex hmac of "t.body">`, which
 * `@llmgateway/server`'s `webhooks.constructEvent` verifies.
 */
/**
 * SSRF guard for an outbound webhook delivery: validate the URL is https + not
 * an internal literal, then resolve the host and reject if any resolved address
 * is private/reserved (DNS rebinding protection). Throws on an unsafe target.
 */
async function assertSafeWebhookTarget(rawUrl: string): Promise<void> {
	const url = assertSafeWebhookUrl(rawUrl);
	const resolved = await lookup(url.hostname, { all: true });
	for (const { address } of resolved) {
		if (isPrivateOrReservedIp(address)) {
			throw new Error(
				`Webhook host ${url.hostname} resolves to a disallowed address (${address})`,
			);
		}
	}
}

async function processWebhookDeliveries(): Promise<void> {
	const lockAcquired = await acquireLock(WEBHOOK_DELIVERY_LOCK_KEY);
	if (!lockAcquired) {
		return;
	}

	try {
		const pending = await db.query.platformWebhookDelivery.findMany({
			where: {
				status: { eq: "pending" },
				nextAttemptAt: { lte: new Date() },
			},
			with: { endpoint: true },
			orderBy: { nextAttemptAt: "asc" },
			limit: WEBHOOK_DELIVERY_BATCH_SIZE,
		});

		for (const delivery of pending) {
			if (!delivery.endpoint || delivery.endpoint.status !== "active") {
				await db
					.update(tables.platformWebhookDelivery)
					.set({ status: "failed", lastError: "Endpoint inactive or deleted" })
					.where(eq(tables.platformWebhookDelivery.id, delivery.id));
				continue;
			}

			const body = JSON.stringify(delivery.payload);
			const timestamp = Math.floor(Date.now() / 1000);
			const signature = createHmac("sha256", delivery.endpoint.secret)
				.update(`${timestamp}.${body}`)
				.digest("hex");

			const attempts = delivery.attempts + 1;
			try {
				// SSRF guard at delivery time: https + literal checks, plus resolve
				// the host and reject if any address is private/reserved (defeats
				// DNS rebinding between registration and delivery).
				await assertSafeWebhookTarget(delivery.endpoint.url);

				const res = await fetch(delivery.endpoint.url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-LLMGateway-Signature": `t=${timestamp},v1=${signature}`,
						"X-LLMGateway-Event": delivery.eventType,
						"X-LLMGateway-Event-Id": delivery.eventId,
					},
					body,
					signal: AbortSignal.timeout(10000),
				});

				if (res.ok) {
					await db
						.update(tables.platformWebhookDelivery)
						.set({
							status: "delivered",
							attempts,
							lastAttemptAt: new Date(),
							responseStatus: res.status,
						})
						.where(eq(tables.platformWebhookDelivery.id, delivery.id));
				} else {
					await scheduleWebhookRetry(
						delivery.id,
						attempts,
						res.status,
						`HTTP ${res.status}`,
					);
				}
			} catch (err) {
				await scheduleWebhookRetry(
					delivery.id,
					attempts,
					null,
					err instanceof Error ? err.message : String(err),
				);
			}
		}
	} finally {
		await releaseLock(WEBHOOK_DELIVERY_LOCK_KEY);
	}
}

async function scheduleWebhookRetry(
	deliveryId: string,
	attempts: number,
	responseStatus: number | null,
	error: string,
): Promise<void> {
	const exhausted = attempts >= MAX_WEBHOOK_ATTEMPTS;
	// Exponential backoff: 2^attempts minutes (2, 4, 8, 16…).
	const backoffMs = Math.pow(2, attempts) * 60 * 1000;
	await db
		.update(tables.platformWebhookDelivery)
		.set({
			status: exhausted ? "failed" : "pending",
			attempts,
			lastAttemptAt: new Date(),
			nextAttemptAt: new Date(Date.now() + backoffMs),
			responseStatus,
			lastError: error,
		})
		.where(eq(tables.platformWebhookDelivery.id, deliveryId));
}

async function runWebhookDeliveryLoop() {
	activeLoops++;
	const interval = (process.env.NODE_ENV === "production" ? 15 : 5) * 1000;
	logger.info(
		`Starting webhook delivery loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await processWebhookDeliveries();
				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in webhook delivery loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Webhook delivery loop stopped");
	}
}

/** Minimum accrued margin (USD) before the auto-payout loop transfers it. */
const AUTO_PAYOUT_MIN_AMOUNT = 25;

/**
 * LLM SDK: automatically pay out accrued developer margin to onboarded
 * connected accounts above a threshold, via Stripe Connect transfers.
 */
async function processMarginPayouts(): Promise<void> {
	const lockAcquired = await acquireLock(MARGIN_PAYOUT_LOCK_KEY);
	if (!lockAcquired) {
		return;
	}

	try {
		const orgs = await db.query.organization.findMany({
			where: {
				stripeConnectOnboarded: { eq: true },
			},
		});

		for (const org of orgs) {
			const balance = Number(org.endUserMarginBalance ?? "0");
			if (!org.stripeConnectAccountId || balance < AUTO_PAYOUT_MIN_AMOUNT) {
				continue;
			}

			const amountCents = Math.floor(balance * 100);
			const amount = amountCents / 100;

			// Reserve the funds first with a conditional decrement: only proceed if
			// we actually claimed >= amount. This prevents the manual payout
			// endpoint (or another tick) from racing this one into an overpayment.
			const reserved = await db
				.update(organization)
				.set({
					endUserMarginBalance: sql`${organization.endUserMarginBalance} - ${amount}`,
				})
				.where(
					and(
						eq(organization.id, org.id),
						sql`${organization.endUserMarginBalance} >= ${amount}`,
					),
				)
				.returning();

			if (reserved.length === 0) {
				// Balance changed under us; skip this org this tick.
				continue;
			}

			// Unique per-payout reference. The idempotency key MUST NOT be derived
			// from the amount alone: two distinct payouts of the same cents value
			// within Stripe's idempotency window would collide, silently replaying
			// the first transfer (no money moves) while we still debit the margin
			// balance — losing the developer's funds. A fresh ref per reservation
			// keeps single-call network retries safe (the Stripe SDK reuses this
			// key) while letting genuinely distinct payouts through.
			const payoutRef = shortid();

			try {
				const transfer = await getStripe().transfers.create(
					{
						amount: amountCents,
						currency: "usd",
						destination: org.stripeConnectAccountId,
						metadata: {
							organizationId: org.id,
							kind: "end_user_margin_payout",
							payoutRef,
						},
					},
					{ idempotencyKey: `margin_payout_${org.id}_${payoutRef}` },
				);

				await db.insert(tables.transaction).values({
					organizationId: org.id,
					type: "end_user_margin_payout",
					amount: String(amount),
					creditAmount: String(amount),
					status: "completed",
					description: `Automatic end-user margin payout (transfer ${transfer.id})`,
				});

				logger.info(
					`Auto-paid out ${amount} end-user margin for organization ${org.id}`,
				);
			} catch (err) {
				// Transfer failed — restore the reserved funds so they aren't lost.
				await db
					.update(organization)
					.set({
						endUserMarginBalance: sql`${organization.endUserMarginBalance} + ${amount}`,
					})
					.where(eq(organization.id, org.id));
				logger.error(
					`Failed to auto-pay-out margin for organization ${org.id}`,
					err instanceof Error ? err : new Error(String(err)),
				);
			}
		}
	} finally {
		await releaseLock(MARGIN_PAYOUT_LOCK_KEY);
	}
}

async function runMarginPayoutLoop() {
	activeLoops++;
	const interval = (process.env.NODE_ENV === "production" ? 3600 : 120) * 1000; // hourly in prod
	logger.info(
		`Starting margin payout loop (interval: ${interval / 1000} seconds)...`,
	);

	try {
		while (!isStopRequested()) {
			try {
				await processMarginPayouts();
				await interruptibleSleep(interval);
			} catch (error) {
				logger.error(
					"Error in margin payout loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				await interruptibleSleep(5000);
			}
		}
	} finally {
		activeLoops--;
		logger.info("Margin payout loop stopped");
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
	resetShutdown();
	hourlyBackfillComplete = false;
	liveHourlyRollupsReady = false;
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
			// Hourly summaries roll up the minute history, so backfill them only
			// after the minute backfill has had a chance to fill recent gaps.
			return backfillHourlyHistoryIfNeeded();
		})
		.then(() => {
			logger.info("Hourly history backfill check completed");
			// Hourly rollups are now populated, so minute-history pruning is safe.
			hourlyBackfillComplete = true;
		})
		.catch((error) => {
			logger.error(
				"Error during history backfill",
				error instanceof Error ? error : new Error(String(error)),
			);
		})
		.finally(async () => {
			// Refresh the live buckets immediately from the now-stable minute source.
			// Even if startup backfill failed, resume live rollups instead of leaving
			// them disabled for the lifetime of this worker process.
			try {
				await calculateHourlyHistory();
			} catch (error) {
				logger.error(
					"Error refreshing hourly history after startup backfill",
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				liveHourlyRollupsReady = true;
			}
		});

	// Start all worker loops (all sequential — each waits for completion before scheduling next run)
	logger.info("Starting worker loops...");
	logger.info(
		`- Log queue: ${LOG_QUEUE_CONCURRENCY} concurrent loop(s), each dequeues up to ${LOG_QUEUE_BATCH_SIZE} logs per iteration`,
	);
	logger.info(
		`- Credit processing: processes up to ${CREDIT_BATCH_SIZE} logs per batch`,
	);
	logger.info("- Minutely history: runs at the first second of every minute");
	logger.info(
		"- Hourly history: rolls up minute history into hourly summaries each minute",
	);
	logger.info(
		`- Current minute history: runs every ${CURRENT_MINUTE_HISTORY_INTERVAL_SECONDS} seconds for real-time metrics`,
	);
	logger.info(
		`- Video jobs: runs every ${VIDEO_JOB_POLL_INTERVAL_SECONDS} seconds for async video status polling`,
	);
	logger.info(
		`- Video webhooks: runs every ${VIDEO_WEBHOOK_POLL_INTERVAL_SECONDS} seconds for callback delivery`,
	);
	logger.info(
		"- Aggregated stats: runs every 1 minute at the start of each minute",
	);
	logger.info(
		`- Project hourly stats: runs every ${PROJECT_STATS_REFRESH_INTERVAL_SECONDS} seconds for dashboard aggregations`,
	);
	logger.info(
		`- Global stats: runs every ${GLOBAL_STATS_INTERVAL_SECONDS} seconds, processes closed buckets incrementally`,
	);
	logger.info(
		"- Follow-up emails: runs every hour to check for lifecycle emails",
	);
	logger.info(
		"- API key expiration: runs every 5 minutes to disable keys whose TTL passed",
	);

	void runMinutelyHistoryLoop();
	void runCurrentMinuteHistoryLoop();
	void runVideoJobsLoop();
	void runVideoWebhookLoop();
	void runAggregatedStatsLoop();
	void runProjectStatsLoop();
	void runGlobalStatsLoop();
	for (let i = 0; i < LOG_QUEUE_CONCURRENCY; i++) {
		void runLogQueueLoop(i);
	}
	void runAutoTopUpLoop();
	void runBatchProcessLoop();
	void runDataRetentionLoop();
	void runModelHistoryRetentionLoop();
	void runEndUserSessionCleanupLoop();
	void runApiKeyExpirationLoop();
	void runLimitHitFlushLoop();
	void runStaleTopUpPiCancelLoop();
	void runWebhookDeliveryLoop();
	void runMarginPayoutLoop();
	void runFollowUpEmailsLoop({
		shouldStop: isStopRequested,
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
	requestStop();

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
			// Keep stop state and isWorkerRunning = true to prevent new loops from starting
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
		await Promise.all([
			closeDatabase(),
			closeRedisClient(),
			closeStorageRedisClient(),
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
	return true;
}
