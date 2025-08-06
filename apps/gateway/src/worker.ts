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
} from "@llmgateway/db";

import { getProject, getOrganization } from "./lib/cache";
import { consumeFromQueue, LOG_QUEUE } from "./lib/redis";
import { calculateFees } from "../../api/src/lib/fee-calculator";
import { stripe } from "../../api/src/routes/payments";

import type { LogInsertData } from "./lib/logs";

const AUTO_TOPUP_LOCK_KEY = "auto_topup_check";
const LOCK_DURATION_MINUTES = 10;

async function acquireLock(key: string): Promise<boolean> {
	const lockExpiry = new Date(Date.now() - LOCK_DURATION_MINUTES * 60 * 1000);

	try {
		await db
			.delete(tables.lock)
			.where(
				and(eq(tables.lock.key, key), lt(tables.lock.updatedAt, lockExpiry)),
			);

		await db.insert(tables.lock).values({
			key,
		});

		return true;
	} catch (_error) {
		return false;
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
							console.log(
								`Skipping auto top-up for organization ${org.id}: pending transaction exists`,
							);
							continue;
						}

						if (recentTransaction.status === "failed") {
							console.log(
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
					console.log(
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

				console.log(
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
						console.log(
							`Auto top-up payment intent succeeded immediately for organization ${org.id}: $${topUpAmount}`,
						);
						// Note: The webhook will handle updating the transaction status and adding credits
					} else if (paymentIntent.status === "requires_action") {
						console.log(
							`Auto top-up requires action for organization ${org.id}: ${paymentIntent.status}`,
						);
					} else {
						console.error(
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
					console.error(
						`Stripe error for organization ${org.id}:`,
						stripeError,
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
				console.error(
					`Error processing auto top-up for organization ${org.id}:`,
					error,
				);
			}
		}
	} finally {
		await releaseLock(AUTO_TOPUP_LOCK_KEY);
	}
}

export async function processLogQueue(): Promise<void> {
	const message = await consumeFromQueue(LOG_QUEUE);

	if (!message) {
		return;
	}

	try {
		const logData = message.map((i) => JSON.parse(i) as LogInsertData);

		const processedLogData = await Promise.all(
			logData.map(async (data) => {
				const organization = await getOrganization(data.organizationId);

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

		await db.insert(log).values(processedLogData as any);

		for (const data of logData) {
			if (!data.cost || data.cached) {
				continue;
			}

			const project = await getProject(data.projectId);

			if (project?.mode !== "api-keys") {
				await db
					.update(organization)
					.set({
						credits: sql`${organization.credits} - ${data.cost}`,
					})
					.where(eq(organization.id, data.organizationId));
			}

			// update key usage
			await db
				.update(apiKey)
				.set({
					usage: sql`${apiKey.usage} + ${data.cost}`,
				})
				.where(eq(apiKey.id, data.apiKeyId));
		}
	} catch (error) {
		console.error("Error processing log message:", error);
	}
}

let isWorkerRunning = false;
let shouldStop = false;

export async function startWorker() {
	if (isWorkerRunning) {
		console.log("Worker is already running");
		return;
	}

	isWorkerRunning = true;
	shouldStop = false;
	console.log("Starting log queue worker...");
	const count = process.env.NODE_ENV === "production" ? 120 : 5;
	let autoTopUpCounter = 0;

	// eslint-disable-next-line no-unmodified-loop-condition
	while (!shouldStop) {
		try {
			await processLogQueue();

			autoTopUpCounter++;
			if (autoTopUpCounter >= count) {
				await processAutoTopUp();
				autoTopUpCounter = 0;
			}

			if (!shouldStop) {
				await new Promise((resolve) => {
					setTimeout(resolve, 1000);
				});
			}
		} catch (error) {
			console.error("Error in log queue worker:", error);
			if (!shouldStop) {
				await new Promise((resolve) => {
					setTimeout(resolve, 5000);
				});
			}
		}
	}

	isWorkerRunning = false;
	console.log("Worker stopped");
}

export async function stopWorker(): Promise<void> {
	if (!isWorkerRunning) {
		console.log("Worker is not running");
		return;
	}

	console.log("Stopping worker...");
	shouldStop = true;

	const pollInterval = 100;
	const maxWaitTime = 15000; // 15 seconds timeout
	const startTime = Date.now();

	// eslint-disable-next-line no-unmodified-loop-condition
	while (isWorkerRunning) {
		if (Date.now() - startTime > maxWaitTime) {
			console.warn("Worker stop timeout exceeded, forcing shutdown");
			break;
		}
		await new Promise((resolve) => {
			setTimeout(resolve, pollInterval);
		});
	}

	console.log("Worker stopped gracefully");
}
