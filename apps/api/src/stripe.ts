import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db, eq, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getDevPlanCreditsLimit, type DevPlanTier } from "@llmgateway/shared";

import { posthog } from "./posthog.js";
import { stripe } from "./routes/payments.js";
import {
	generatePaymentFailureEmailHtml,
	generateSubscriptionCancelledEmailHtml,
	sendTransactionalEmail,
} from "./utils/email.js";
import { generateAndEmailInvoice } from "./utils/invoice.js";

import type { ServerTypes } from "./vars.js";
import type Stripe from "stripe";

export async function ensureStripeCustomer(
	organizationId: string,
): Promise<string> {
	const organization = await db.query.organization.findFirst({
		where: {
			id: organizationId,
		},
	});

	if (!organization) {
		throw new Error(`Organization not found: ${organizationId}`);
	}

	let stripeCustomerId = organization.stripeCustomerId;
	if (!stripeCustomerId) {
		const customer = await stripe.customers.create({
			email: organization.billingEmail,
			metadata: {
				organizationId,
			},
		});
		stripeCustomerId = customer.id;

		await db
			.update(tables.organization)
			.set({
				stripeCustomerId,
			})
			.where(eq(tables.organization.id, organizationId));
	} else {
		// Update existing customer email if billingEmail has changed
		await stripe.customers.update(stripeCustomerId, {
			email: organization.billingEmail,
		});
	}

	return stripeCustomerId;
}

/**
 * Unified helper to resolve organizationId from various Stripe event sources
 * and validate that the organization exists in the database.
 */
async function resolveOrganizationFromStripeEvent(eventData: {
	metadata?: { organizationId?: string };
	customer?: string;
	subscription?: string;
	lines?: { data?: Array<{ metadata?: { organizationId?: string } }> };
}): Promise<{ organizationId: string; organization: any } | null> {
	let organizationId: string | null = null;

	// 1. Try to get organizationId from direct metadata
	if (eventData.metadata?.organizationId) {
		organizationId = eventData.metadata.organizationId;
		logger.debug("Found organizationId in direct metadata", { organizationId });
	}

	// 2. Check line items metadata (common in invoices)
	if (!organizationId && eventData.lines?.data) {
		logger.info(
			`Checking ${eventData.lines.data.length} line items for organizationId`,
		);
		for (const lineItem of eventData.lines.data) {
			if (lineItem.metadata?.organizationId) {
				organizationId = lineItem.metadata.organizationId;
				logger.info(
					`Found organizationId in line item metadata: ${organizationId}`,
				);
				break;
			}
		}
	}

	// 3. Try to get from subscription metadata if subscription ID is available
	if (!organizationId && eventData.subscription) {
		try {
			const stripeSubscription = await stripe.subscriptions.retrieve(
				eventData.subscription,
			);
			if (stripeSubscription.metadata?.organizationId) {
				organizationId = stripeSubscription.metadata.organizationId;
				logger.info(
					`Found organizationId in subscription metadata: ${organizationId}`,
				);
			}
		} catch (error) {
			logger.error("Error retrieving subscription:", error as Error);
		}
	}

	// 4. Fallback: find organization by Stripe customer ID
	if (!organizationId && eventData.customer) {
		const organization = await db.query.organization.findFirst({
			where: {
				stripeCustomerId: eventData.customer,
			},
		});

		if (organization) {
			organizationId = organization.id;
			logger.info(
				`Found organizationId via customer lookup: ${organizationId}`,
			);
		}
	}

	if (!organizationId) {
		logger.error(`Organization not found for event data:`, {
			hasMetadata: !!eventData.metadata,
			customer: eventData.customer,
			subscription: eventData.subscription,
			lineItemsCount: eventData.lines?.data?.length || 0,
		});
		return null;
	}

	// Validate that the organization exists
	const organization = await db.query.organization.findFirst({
		where: {
			id: organizationId,
		},
	});

	if (!organization) {
		logger.error(
			`Organization with ID ${organizationId} does not exist in database`,
		);
		return null;
	}

	logger.info(
		`Successfully resolved organization: ${organization.name} (${organization.id})`,
	);
	return { organizationId, organization };
}

export const stripeRoutes = new OpenAPIHono<ServerTypes>();

const webhookHandler = createRoute({
	method: "post",
	path: "/webhook",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						received: z.boolean(),
					}),
				},
			},
			description: "Webhook received successfully",
		},
	},
});

stripeRoutes.openapi(webhookHandler, async (c) => {
	const sig = c.req.header("stripe-signature");

	if (!sig) {
		throw new HTTPException(400, {
			message: "Missing stripe-signature header",
		});
	}

	try {
		const body = await c.req.raw.text();
		const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

		const event = stripe.webhooks.constructEvent(body, sig, webhookSecret);

		logger.info(JSON.stringify({ kind: "stripe-event", payload: event }));

		switch (event.type) {
			case "payment_intent.succeeded":
				await handlePaymentIntentSucceeded(event);
				break;
			case "payment_intent.payment_failed":
				await handlePaymentIntentFailed(event);
				break;
			case "setup_intent.succeeded":
				await handleSetupIntentSucceeded(event);
				break;
			case "checkout.session.completed":
				await handleCheckoutSessionCompleted(event);
				break;
			case "invoice.payment_succeeded":
				await handleInvoicePaymentSucceeded(event);
				break;
			case "customer.subscription.created":
				await handleSubscriptionCreated(event);
				break;
			case "customer.subscription.updated":
				await handleSubscriptionUpdated(event);
				break;
			case "customer.subscription.deleted":
				await handleSubscriptionDeleted(event);
				break;
			case "charge.refunded":
				await handleChargeRefunded(event);
				break;
			default:
				logger.warn(`Unhandled event type: ${event.type}`);
		}

		return c.json({ received: true });
	} catch (error) {
		logger.error("Webhook error:", error as Error);
		throw new HTTPException(400, {
			message: `Webhook error: ${error instanceof Error ? error.message : "Unknown error"}`,
		});
	}
});

async function handleCheckoutSessionCompleted(
	event: Stripe.CheckoutSessionCompletedEvent,
) {
	const session = event.data.object;
	const { customer, metadata, subscription } = session;

	logger.info(
		`Processing checkout session completed for customer: ${customer}, subscription: ${subscription}`,
	);

	if (!subscription) {
		logger.info("Not a subscription checkout session, skipping");
		return;
	}

	const result = await resolveOrganizationFromStripeEvent({
		metadata: metadata as { organizationId?: string } | undefined,
		customer: typeof customer === "string" ? customer : customer?.id,
		subscription:
			typeof subscription === "string" ? subscription : subscription?.id,
	});

	if (!result) {
		logger.error(
			`Organization not found for customer: ${customer}, subscription: ${subscription}`,
		);
		return;
	}

	const { organizationId, organization } = result;
	const subscriptionId =
		typeof subscription === "string" ? subscription : subscription?.id;

	// Check if this is a dev plan subscription
	const isDevPlan = metadata?.subscriptionType === "dev_plan";
	const devPlanTier = metadata?.devPlan as DevPlanTier | undefined;

	logger.info(
		`Found organization: ${organization.name} (${organization.id}), current plan: ${organization.plan}, isDevPlan: ${isDevPlan}`,
	);

	try {
		if (isDevPlan && devPlanTier) {
			// Handle dev plan subscription
			const creditsLimit = getDevPlanCreditsLimit(devPlanTier);

			await db
				.update(tables.organization)
				.set({
					devPlan: devPlanTier,
					devPlanCreditsLimit: creditsLimit.toString(),
					devPlanCreditsUsed: "0",
					devPlanBillingCycleStart: new Date(),
					devPlanStripeSubscriptionId: subscriptionId,
					devPlanCancelled: false,
				})
				.where(eq(tables.organization.id, organizationId));

			logger.info(
				`Successfully activated dev plan ${devPlanTier} for organization ${organizationId} with ${creditsLimit} credits`,
			);

			// Create transaction record for dev plan start
			const stripeInvoiceId = session.invoice as string | undefined;
			const existing = stripeInvoiceId
				? await db.query.transaction.findFirst({
						where: {
							stripeInvoiceId: {
								eq: stripeInvoiceId,
							},
						},
					})
				: null;

			if (!existing) {
				const [transaction] = await db
					.insert(tables.transaction)
					.values({
						organizationId,
						type: "dev_plan_start",
						amount: ((session.amount_total || 0) / 100).toString(),
						creditAmount: creditsLimit.toString(),
						currency: (session.currency || "USD").toUpperCase(),
						status: "completed",
						stripeInvoiceId: stripeInvoiceId,
						description: `Dev Plan ${devPlanTier.toUpperCase()} started via Stripe Checkout`,
					})
					.returning();

				// Generate and email invoice
				try {
					await generateAndEmailInvoice({
						invoiceNumber: transaction.id,
						invoiceDate: new Date(),
						organizationName: organization.name,
						billingEmail: organization.billingEmail,
						billingCompany: organization.billingCompany,
						billingAddress: organization.billingAddress,
						billingTaxId: organization.billingTaxId,
						billingNotes: organization.billingNotes,
						lineItems: [
							{
								description: `Dev Plan ${devPlanTier.toUpperCase()} ($${creditsLimit} credits included)`,
								amount: (session.amount_total || 0) / 100,
							},
						],
						currency: (session.currency || "USD").toUpperCase(),
					});
				} catch (e) {
					logger.error(
						"Invoice email failed (dev plan checkout); suppressing webhook failure",
						e as Error,
					);
				}
			}

			// Track dev plan subscription in PostHog
			posthog.groupIdentify({
				groupType: "organization",
				groupKey: organizationId,
				properties: {
					name: organization.name,
				},
			});
			posthog.capture({
				distinctId: "organization",
				event: "dev_plan_started",
				groups: {
					organization: organizationId,
				},
				properties: {
					devPlan: devPlanTier,
					creditsLimit: creditsLimit,
					organization: organizationId,
					subscriptionId: subscriptionId,
					source: "stripe_checkout",
				},
			});
		} else {
			// Handle regular pro plan subscription
			// Skip setting plan to "pro" for personal orgs - they use devPlan field instead
			if (organization.isPersonal) {
				logger.warn(
					`Skipping plan: "pro" for personal org ${organizationId} - personal orgs should use devPlan field`,
				);
				return;
			}

			const result = await db
				.update(tables.organization)
				.set({
					plan: "pro",
					stripeSubscriptionId: subscriptionId,
					subscriptionCancelled: false,
				})
				.where(eq(tables.organization.id, organizationId))
				.returning();

			logger.info(
				`Successfully upgraded organization ${organizationId} to pro plan via checkout. Updated rows: ${result.length}`,
			);

			// Check for existing transaction to avoid duplicates
			const stripeInvoiceId = session.invoice as string | undefined;
			const existing = stripeInvoiceId
				? await db.query.transaction.findFirst({
						where: {
							stripeInvoiceId: {
								eq: stripeInvoiceId,
							},
						},
					})
				: null;

			if (!existing) {
				// Create transaction record for subscription start
				const [transaction] = await db
					.insert(tables.transaction)
					.values({
						organizationId,
						type: "subscription_start",
						amount: ((session.amount_total || 0) / 100).toString(),
						currency: (session.currency || "USD").toUpperCase(),
						status: "completed",
						stripeInvoiceId: stripeInvoiceId,
						description: "Pro subscription started via Stripe Checkout",
					})
					.returning();

				// Generate and email invoice
				try {
					await generateAndEmailInvoice({
						invoiceNumber: transaction.id,
						invoiceDate: new Date(),
						organizationName: organization.name,
						billingEmail: organization.billingEmail,
						billingCompany: organization.billingCompany,
						billingAddress: organization.billingAddress,
						billingTaxId: organization.billingTaxId,
						billingNotes: organization.billingNotes,
						lineItems: [
							{
								description: "Pro Subscription",
								amount: (session.amount_total || 0) / 100,
							},
						],
						currency: (session.currency || "USD").toUpperCase(),
					});
				} catch (e) {
					logger.error(
						"Invoice email failed (checkout); suppressing webhook failure",
						e as Error,
					);
				}
			} else {
				logger.info(
					"Subscription transaction already exists for invoice; skipping duplicate insert/email",
					{ stripeInvoiceId },
				);
			}

			// Track subscription creation in PostHog
			posthog.groupIdentify({
				groupType: "organization",
				groupKey: organizationId,
				properties: {
					name: organization.name,
				},
			});
			posthog.capture({
				distinctId: "organization",
				event: "subscription_created",
				groups: {
					organization: organizationId,
				},
				properties: {
					plan: "pro",
					organization: organizationId,
					subscriptionId: subscriptionId,
					source: "stripe_checkout",
				},
			});
		}
	} catch (error) {
		logger.error(
			`Error updating organization ${organizationId} via checkout:`,
			error as Error,
		);
		throw error;
	}
}

async function handlePaymentIntentSucceeded(
	event: Stripe.PaymentIntentSucceededEvent,
) {
	const paymentIntent = event.data.object;
	const { metadata, amount } = paymentIntent;

	// Get the credit amount (base amount without fees) from metadata
	const creditAmount = parseFloat(paymentIntent.metadata.baseAmount);
	if (!creditAmount) {
		return;
	}

	const result = await resolveOrganizationFromStripeEvent({
		metadata,
		customer: paymentIntent.customer as string,
	});

	if (!result) {
		logger.error("Could not resolve organization from payment intent");
		return;
	}
	const { organizationId, organization } = result;

	// Convert amount from cents to dollars
	const totalAmountInDollars = amount / 100;

	// Calculate bonus for first-time credit purchases
	let bonusAmount = 0;
	let finalCreditAmount = creditAmount;
	const bonusMultiplier = process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER
		? parseFloat(process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER)
		: 0;

	if (bonusMultiplier && bonusMultiplier > 1) {
		// Check user email verification
		const userEmail = metadata?.userEmail;
		let isEmailVerified = false;

		if (userEmail) {
			const user = await db.query.user.findFirst({
				where: {
					email: { eq: userEmail },
				},
			});
			isEmailVerified = user?.emailVerified ?? false;
		}

		if (isEmailVerified) {
			// Check if this is the first credit purchase
			const previousPurchases = await db.query.transaction.findFirst({
				where: {
					organizationId: { eq: organizationId },
					type: { eq: "credit_topup" },
					status: { eq: "completed" },
				},
			});

			if (!previousPurchases) {
				// This is the first credit purchase, apply bonus
				const potentialBonus = creditAmount * (bonusMultiplier - 1);
				const maxBonus = 50; // Max $50 bonus

				bonusAmount = Math.min(potentialBonus, maxBonus);
				finalCreditAmount = creditAmount + bonusAmount;

				logger.info(
					`Applied first-time bonus of $${bonusAmount} to organization ${organizationId} (${bonusMultiplier}x multiplier, max $${maxBonus})`,
				);
			}
		} else {
			logger.info(
				`Skipping first-time bonus for organization ${organizationId}: email not verified`,
			);
		}
	}

	// Update organization credits with credit amount (plus bonus if applicable)
	// Also reset payment failure tracking since payment succeeded
	await db
		.update(tables.organization)
		.set({
			credits: sql`${tables.organization.credits} + ${finalCreditAmount}`,
			paymentFailureCount: 0,
			lastPaymentFailureAt: null,
		})
		.where(eq(tables.organization.id, organizationId));

	// Check if this is an auto top-up with an existing pending transaction
	const transactionId = metadata?.transactionId;
	let completedTransaction;

	const transactionDescription =
		bonusAmount > 0
			? `Credit top-up via Stripe (+$${bonusAmount.toFixed(2)} first-time bonus)`
			: "Credit top-up via Stripe";

	if (transactionId) {
		// Update existing pending transaction
		const updatedTransaction = await db
			.update(tables.transaction)
			.set({
				status: "completed",
				description:
					bonusAmount > 0
						? `Auto top-up completed via Stripe webhook (+$${bonusAmount.toFixed(2)} first-time bonus)`
						: "Auto top-up completed via Stripe webhook",
				creditAmount: finalCreditAmount.toString(),
				amount: totalAmountInDollars.toString(),
			})
			.where(eq(tables.transaction.id, transactionId))
			.returning()
			.then((rows) => rows[0]);

		if (updatedTransaction) {
			logger.info(
				`Updated pending transaction ${transactionId} to completed for organization ${organizationId}`,
			);
			completedTransaction = updatedTransaction;
		} else {
			logger.warn(
				`Could not find pending transaction ${transactionId} for organization ${organizationId}`,
			);
			// Fallback: create new transaction record
			const [newTransaction] = await db
				.insert(tables.transaction)
				.values({
					organizationId,
					type: "credit_topup",
					creditAmount: finalCreditAmount.toString(),
					amount: totalAmountInDollars.toString(),
					currency: paymentIntent.currency.toUpperCase(),
					status: "completed",
					stripePaymentIntentId: paymentIntent.id,
					description: transactionDescription,
				})
				.returning();
			completedTransaction = newTransaction;
		}
	} else {
		// Create new transaction record (for manual top-ups or old auto top-ups)
		const [newTransaction] = await db
			.insert(tables.transaction)
			.values({
				organizationId,
				type: "credit_topup",
				creditAmount: finalCreditAmount.toString(),
				amount: totalAmountInDollars.toString(),
				currency: paymentIntent.currency.toUpperCase(),
				status: "completed",
				stripePaymentIntentId: paymentIntent.id,
				description: transactionDescription,
			})
			.returning();
		completedTransaction = newTransaction;
	}

	// Generate and email invoice for credit purchase
	const lineItems = [
		{
			description: `Credit Top-up ($${creditAmount})`,
			amount: totalAmountInDollars,
		},
	];

	if (bonusAmount > 0) {
		lineItems.push({
			description: `First-time bonus (+$${bonusAmount.toFixed(2)})`,
			amount: 0,
		});
	}

	await generateAndEmailInvoice({
		invoiceNumber: completedTransaction.id,
		invoiceDate: new Date(),
		organizationName: organization.name,
		billingEmail: organization.billingEmail,
		billingCompany: organization.billingCompany,
		billingAddress: organization.billingAddress,
		billingTaxId: organization.billingTaxId,
		billingNotes: organization.billingNotes,
		lineItems,
		currency: paymentIntent.currency.toUpperCase(),
	});

	posthog.groupIdentify({
		groupType: "organization",
		groupKey: organizationId,
		properties: {
			name: organization.name,
		},
	});
	posthog.capture({
		distinctId: "organization",
		event: "credits_purchased",
		groups: {
			organization: organizationId,
		},
		properties: {
			amount: creditAmount,
			totalPaid: totalAmountInDollars,
			source: "payment_intent",
			organization: organizationId,
		},
	});

	logger.info(
		`Added ${creditAmount} credits to organization ${organizationId} (paid ${totalAmountInDollars} including fees)`,
	);
}

async function handlePaymentIntentFailed(
	event: Stripe.PaymentIntentPaymentFailedEvent,
) {
	const paymentIntent = event.data.object;
	const { metadata, amount } = paymentIntent;

	const result = await resolveOrganizationFromStripeEvent({
		metadata,
		customer: paymentIntent.customer as string,
	});

	if (!result) {
		logger.error("Could not resolve organization from failed payment intent");
		return;
	}

	const { organizationId, organization } = result;

	// Convert amount from cents to dollars
	const totalAmountInDollars = amount / 100;

	// Get the credit amount from metadata if available
	const creditAmount = metadata?.baseAmount
		? parseFloat(metadata.baseAmount)
		: null;

	// Extract error details from Stripe
	const lastPaymentError = paymentIntent.last_payment_error;
	const errorMessage = lastPaymentError?.message || "Unknown error";
	const errorCode = lastPaymentError?.code;
	const declineCode = lastPaymentError?.decline_code;

	// Log warning for payment failure
	logger.warn("Payment intent failed", {
		organizationId,
		organizationName: organization.name,
		amount: totalAmountInDollars,
		currency: paymentIntent.currency.toUpperCase(),
		errorMessage,
		errorCode,
		declineCode,
		stripePaymentIntentId: paymentIntent.id,
	});

	// Check if this is an auto top-up with an existing pending transaction
	const transactionId = metadata?.transactionId;
	if (transactionId) {
		// Update existing pending transaction to failed
		const updatedTransaction = await db
			.update(tables.transaction)
			.set({
				status: "failed",
				description: `Auto top-up failed via Stripe webhook: ${errorMessage}`,
			})
			.where(eq(tables.transaction.id, transactionId))
			.returning()
			.then((rows) => rows[0]);

		if (updatedTransaction) {
			logger.info(
				`Updated pending transaction ${transactionId} to failed for organization ${organizationId}`,
			);
		} else {
			logger.warn(
				`Could not find pending transaction ${transactionId} for organization ${organizationId}`,
			);
			// Fallback: create new failed transaction record
			await db.insert(tables.transaction).values({
				organizationId,
				type: "credit_topup",
				creditAmount: creditAmount ? creditAmount.toString() : null,
				amount: totalAmountInDollars.toString(),
				currency: paymentIntent.currency.toUpperCase(),
				status: "failed",
				stripePaymentIntentId: paymentIntent.id,
				description: `Credit top-up failed via Stripe (fallback): ${errorMessage}`,
			});
		}
	} else {
		// Create new failed transaction record (for manual top-ups or payments without transactionId)
		await db.insert(tables.transaction).values({
			organizationId,
			type: "credit_topup",
			creditAmount: creditAmount ? creditAmount.toString() : null,
			amount: totalAmountInDollars.toString(),
			currency: paymentIntent.currency.toUpperCase(),
			status: "failed",
			stripePaymentIntentId: paymentIntent.id,
			description: `Credit top-up failed via Stripe: ${errorMessage}`,
		});
	}

	// Update payment failure tracking with exponential backoff
	// Calculate new failure count and check if we should send an email
	const previousFailureCount = organization.paymentFailureCount ?? 0;
	const previousFailureAt = organization.lastPaymentFailureAt;
	const newFailureCount = previousFailureCount + 1;

	// Update organization with new failure count and timestamp
	await db
		.update(tables.organization)
		.set({
			paymentFailureCount: newFailureCount,
			lastPaymentFailureAt: new Date(),
		})
		.where(eq(tables.organization.id, organizationId));

	// Determine if we should send an email based on exponential backoff
	// Email intervals: 1st failure immediately, then 1h, 2h, 4h, 8h, 16h, 24h (capped)
	let shouldSendEmail = false;
	if (previousFailureCount === 0) {
		// First failure - always send email
		shouldSendEmail = true;
	} else if (previousFailureAt) {
		// Calculate backoff period based on previous failure count
		const baseBackoffHours = 1;
		const maxBackoffHours = 24;
		const backoffHours = Math.min(
			baseBackoffHours * Math.pow(2, previousFailureCount - 1),
			maxBackoffHours,
		);
		const backoffMs = backoffHours * 60 * 60 * 1000;
		const nextEmailTime = new Date(previousFailureAt.getTime() + backoffMs);

		// Send email if we're past the backoff period
		shouldSendEmail = new Date() >= nextEmailTime;
	}

	// Send payment failure email if not in backoff period
	if (shouldSendEmail) {
		try {
			await sendTransactionalEmail({
				to: organization.billingEmail,
				subject: "Payment Failed - Action Required",
				html: generatePaymentFailureEmailHtml(organization.name, {
					errorMessage,
					errorCode,
					declineCode,
					amount: totalAmountInDollars,
					currency: paymentIntent.currency.toUpperCase(),
				}),
			});

			logger.warn("Payment failure email sent", {
				organizationId,
				billingEmail: organization.billingEmail,
				failureCount: newFailureCount,
			});
		} catch (emailError) {
			logger.error("Failed to send payment failure email", emailError as Error);
		}
	} else {
		logger.warn("Skipping payment failure email (in backoff period)", {
			organizationId,
			failureCount: newFailureCount,
		});
	}
}

async function handleChargeRefunded(event: Stripe.ChargeRefundedEvent) {
	const charge = event.data.object;
	const { payment_intent, amount_refunded } = charge;

	if (!payment_intent) {
		logger.error("No payment intent in charge.refunded event");
		return;
	}

	// Find the original transaction by stripePaymentIntentId
	const originalTransaction = await db.query.transaction.findFirst({
		where: {
			stripePaymentIntentId: { eq: payment_intent as string },
			type: { eq: "credit_topup" },
		},
	});

	if (!originalTransaction) {
		logger.error(
			`Original transaction not found for payment intent: ${payment_intent}`,
		);
		return;
	}

	// Get organization
	const organization = await db.query.organization.findFirst({
		where: {
			id: { eq: originalTransaction.organizationId },
		},
	});

	if (!organization) {
		logger.error(
			`Organization not found: ${originalTransaction.organizationId}`,
		);
		return;
	}

	// Fetch refunds for this charge since they're not expanded in webhook events
	const refundsResponse = await stripe.refunds.list({
		charge: charge.id,
		limit: 1,
	});

	const latestRefund = refundsResponse.data[0];
	if (!latestRefund) {
		logger.error(
			`No refund data found for charge ${charge.id} despite charge.refunded event`,
		);
		return;
	}

	// Calculate refund amounts
	const refundAmountInDollars = amount_refunded / 100;
	const originalAmount = Number.parseFloat(originalTransaction.amount || "0");
	const originalCreditAmount = Number.parseFloat(
		originalTransaction.creditAmount || "0",
	);

	// Calculate proportional credit refund
	const refundRatio =
		originalAmount > 0 ? refundAmountInDollars / originalAmount : 0;
	const creditRefundAmount = originalCreditAmount * refundRatio;

	// Check if refund already exists (prevent duplicates)
	const existingRefund = await db.query.transaction.findFirst({
		where: {
			relatedTransactionId: { eq: originalTransaction.id },
			type: { eq: "credit_refund" },
			amount: { eq: refundAmountInDollars.toString() },
		},
	});

	if (existingRefund) {
		logger.info(
			`Refund already processed for transaction ${originalTransaction.id}`,
		);
		return;
	}

	// Create refund transaction
	await db.insert(tables.transaction).values({
		organizationId: originalTransaction.organizationId,
		type: "credit_refund",
		amount: refundAmountInDollars.toString(),
		creditAmount: (-creditRefundAmount).toString(),
		currency: originalTransaction.currency,
		status: "completed",
		stripePaymentIntentId: payment_intent as string,
		relatedTransactionId: originalTransaction.id,
		refundReason: latestRefund.reason || null,
		description: `Credit refund: $${refundAmountInDollars.toFixed(2)} (${(refundRatio * 100).toFixed(1)}% of original purchase)`,
	});

	// Deduct credits from organization (allow negative)
	await db
		.update(tables.organization)
		.set({
			credits: sql`${tables.organization.credits} - ${creditRefundAmount}`,
		})
		.where(eq(tables.organization.id, originalTransaction.organizationId));

	// Track in PostHog
	posthog.groupIdentify({
		groupType: "organization",
		groupKey: originalTransaction.organizationId,
		properties: {
			name: organization.name,
		},
	});
	posthog.capture({
		distinctId: "organization",
		event: "credits_refunded",
		groups: {
			organization: originalTransaction.organizationId,
		},
		properties: {
			refundAmount: refundAmountInDollars,
			creditRefundAmount: creditRefundAmount,
			refundRatio: refundRatio,
			originalTransactionId: originalTransaction.id,
			organization: originalTransaction.organizationId,
			reason: latestRefund.reason,
		},
	});

	logger.info(
		`Processed refund for organization ${originalTransaction.organizationId}: ` +
			`refunded $${refundAmountInDollars} (${creditRefundAmount} credits deducted)`,
	);
}

async function handleSetupIntentSucceeded(
	event: Stripe.SetupIntentSucceededEvent,
) {
	const setupIntent = event.data.object;
	const { metadata, payment_method } = setupIntent;
	const organizationId = metadata?.organizationId;

	if (!organizationId || !payment_method) {
		logger.warn(
			`Missing organizationId or payment_method in setupIntent: ${event.id} ${setupIntent.id}`,
			{
				hasOrganizationId: !!organizationId,
				hasPaymentMethod: !!payment_method,
				metadata: setupIntent.metadata,
				paymentMethod: payment_method,
				setupIntentStatus: setupIntent.status,
				customer: setupIntent.customer,
			},
		);
		return;
	}

	let stripeCustomerId;
	try {
		stripeCustomerId = await ensureStripeCustomer(organizationId);
	} catch (error) {
		logger.error(`Error ensuring Stripe customer: ${error} ${organizationId}`);
		return;
	}

	const paymentMethodId =
		typeof payment_method === "string" ? payment_method : payment_method.id;

	await stripe.paymentMethods.attach(paymentMethodId, {
		customer: stripeCustomerId,
	});

	const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

	const existingPaymentMethods = await db.query.paymentMethod.findMany({
		where: {
			organizationId,
		},
	});

	const isDefault = existingPaymentMethods.length === 0;

	await db.insert(tables.paymentMethod).values({
		stripePaymentMethodId: paymentMethodId,
		organizationId,
		type: paymentMethod.type,
		isDefault,
	});
}

async function handleInvoicePaymentSucceeded(
	event: Stripe.InvoicePaymentSucceededEvent,
) {
	const invoice = event.data.object;
	const { customer, metadata } = invoice;
	const subscription = (invoice as any).subscription;

	// Extract subscription ID from line items if not directly available
	let subscriptionId =
		typeof subscription === "string" ? subscription : subscription?.id;
	if (
		!subscriptionId &&
		invoice.lines &&
		invoice.lines.data &&
		invoice.lines.data.length > 0
	) {
		const firstLineItem = invoice.lines.data[0];
		if (
			firstLineItem.parent &&
			firstLineItem.parent.subscription_item_details
		) {
			subscriptionId =
				firstLineItem.parent.subscription_item_details.subscription;
		}
	}

	logger.info(
		`Processing invoice payment succeeded for customer: ${customer}, subscription: ${subscriptionId}`,
	);

	if (!subscriptionId) {
		logger.info("Not a subscription invoice, skipping");
		return; // Not a subscription invoice
	}

	const result = await resolveOrganizationFromStripeEvent({
		metadata: metadata as { organizationId?: string } | undefined,
		customer: typeof customer === "string" ? customer : customer?.id,
		subscription: subscriptionId,
		lines: invoice.lines,
	});

	if (!result) {
		logger.error(
			`Organization not found for customer: ${customer}, subscription: ${subscriptionId}`,
		);
		return;
	}

	const { organizationId, organization } = result;

	// Check if this is a dev plan subscription renewal
	const isDevPlanRenewal =
		organization.devPlanStripeSubscriptionId === subscriptionId &&
		organization.devPlan !== "none";

	logger.info(
		`Found organization: ${organization.name} (${organization.id}), current plan: ${organization.plan}, isDevPlanRenewal: ${isDevPlanRenewal}`,
	);

	if (isDevPlanRenewal) {
		// Handle dev plan renewal - reset credits
		const creditsLimit = getDevPlanCreditsLimit(
			organization.devPlan as DevPlanTier,
		);

		// Create transaction record for dev plan renewal
		await db.insert(tables.transaction).values({
			organizationId,
			type: "dev_plan_renewal",
			amount: (invoice.amount_paid / 100).toString(),
			creditAmount: creditsLimit.toString(),
			currency: invoice.currency.toUpperCase(),
			status: "completed",
			stripePaymentIntentId: (invoice as any).payment_intent,
			stripeInvoiceId: invoice.id,
			description: `Dev Plan ${organization.devPlan?.toUpperCase()} renewed`,
		});

		// Reset credits used and update billing cycle start
		await db
			.update(tables.organization)
			.set({
				devPlanCreditsUsed: "0",
				devPlanBillingCycleStart: new Date(),
				devPlanCancelled: false,
			})
			.where(eq(tables.organization.id, organizationId));

		logger.info(
			`Dev plan ${organization.devPlan} renewed for organization ${organizationId}, credits reset to 0/${creditsLimit}`,
		);

		// Track dev plan renewal in PostHog
		posthog.capture({
			distinctId: "organization",
			event: "dev_plan_renewed",
			groups: {
				organization: organizationId,
			},
			properties: {
				devPlan: organization.devPlan,
				creditsLimit: creditsLimit,
				organization: organizationId,
				source: "stripe_invoice",
			},
		});
	} else {
		// Handle regular pro plan subscription
		// Create transaction record for subscription start
		const [transaction] = await db
			.insert(tables.transaction)
			.values({
				organizationId,
				type: "subscription_start",
				amount: (invoice.amount_paid / 100).toString(),
				currency: invoice.currency.toUpperCase(),
				status: "completed",
				stripePaymentIntentId: (invoice as any).payment_intent,
				stripeInvoiceId: invoice.id,
				description: "Pro subscription started",
			})
			.returning();

		// Update organization to pro plan and mark subscription as not cancelled
		try {
			const result = await db
				.update(tables.organization)
				.set({
					plan: "pro",
					subscriptionCancelled: false,
				})
				.where(eq(tables.organization.id, organizationId))
				.returning();

			logger.info(
				`Successfully upgraded organization ${organizationId} to pro plan. Updated rows: ${result.length}`,
			);

			logger.info(
				`Verification - organization plan is now: ${result && result[0]?.plan}`,
			);

			// Generate and email invoice
			await generateAndEmailInvoice({
				invoiceNumber: transaction.id,
				invoiceDate: new Date(),
				organizationName: organization.name,
				billingEmail: organization.billingEmail,
				billingCompany: organization.billingCompany,
				billingAddress: organization.billingAddress,
				billingNotes: organization.billingNotes,
				lineItems: [
					{
						description: "Pro Subscription",
						amount: invoice.amount_paid / 100,
					},
				],
				currency: invoice.currency.toUpperCase(),
			});

			// Track subscription creation in PostHog
			posthog.groupIdentify({
				groupType: "organization",
				groupKey: organizationId,
				properties: {
					name: organization.name,
				},
			});
			posthog.capture({
				distinctId: "organization",
				event: "subscription_created",
				groups: {
					organization: organizationId,
				},
				properties: {
					plan: "pro",
					organization: organizationId,
					subscriptionId: subscriptionId,
					source: "stripe_invoice",
				},
			});
		} catch (error) {
			logger.error(
				`Error updating organization ${organizationId} to pro plan:`,
				error as Error,
			);
			throw error;
		}
	}
}

async function handleSubscriptionUpdated(
	event: Stripe.CustomerSubscriptionUpdatedEvent,
) {
	const subscription = event.data.object;
	const { customer, metadata } = subscription;

	const currentPeriodEnd =
		subscription.items.data.length > 0
			? subscription.items.data[0].current_period_end
			: undefined;
	const cancelAtPeriodEnd = subscription.cancel_at_period_end;

	const result = await resolveOrganizationFromStripeEvent({
		metadata: metadata as { organizationId?: string } | undefined,
		customer: typeof customer === "string" ? customer : customer?.id,
		subscription: subscription.id,
	});

	if (!result) {
		logger.error(`Organization not found for customer: ${customer}`);
		return;
	}

	const { organizationId, organization } = result;

	// Check if this is a dev plan subscription
	const isDevPlan =
		metadata?.subscriptionType === "dev_plan" ||
		organization.devPlanStripeSubscriptionId === subscription.id;

	// Update plan expiration date
	const expiresAt = currentPeriodEnd
		? new Date(currentPeriodEnd * 1000)
		: undefined;

	// Check if subscription is active and organization was previously cancelled
	const isSubscriptionActive = !cancelAtPeriodEnd;

	if (isDevPlan) {
		// Handle dev plan subscription update
		const wasDevPlanCancelled = organization.devPlanCancelled;

		// Create transaction record for dev plan cancellation if it was cancelled
		if (!isSubscriptionActive && !wasDevPlanCancelled) {
			await db.insert(tables.transaction).values({
				organizationId,
				type: "dev_plan_cancel",
				currency: "USD",
				status: "completed",
				stripeInvoiceId: subscription.latest_invoice as string,
				description: `Dev Plan ${organization.devPlan?.toUpperCase()} cancelled`,
			});
		}

		await db
			.update(tables.organization)
			.set({
				devPlanExpiresAt: expiresAt,
				devPlanCancelled: !isSubscriptionActive,
			})
			.where(eq(tables.organization.id, organizationId));

		// Track dev plan reactivation if it was previously cancelled and is now active
		if (isSubscriptionActive && wasDevPlanCancelled) {
			posthog.capture({
				distinctId: "organization",
				event: "dev_plan_reactivated",
				groups: {
					organization: organizationId,
				},
				properties: {
					devPlan: organization.devPlan,
					organization: organizationId,
					source: "stripe_subscription_updated",
				},
			});
			logger.info(
				`Reactivated dev plan subscription for organization ${organizationId}`,
			);
		}

		logger.info(
			`Updated dev plan subscription for organization ${organizationId}, expires at: ${expiresAt}, cancelled: ${!isSubscriptionActive}`,
		);
	} else {
		// Handle regular pro plan subscription update
		const wasSubscriptionCancelled = organization.subscriptionCancelled;

		// Create transaction record for subscription cancellation if it was cancelled
		if (!isSubscriptionActive && !wasSubscriptionCancelled) {
			await db.insert(tables.transaction).values({
				organizationId,
				type: "subscription_cancel",
				currency: "USD",
				status: "completed",
				stripeInvoiceId: subscription.latest_invoice as string,
				description: "Pro subscription cancelled",
			});
		}

		await db
			.update(tables.organization)
			.set({
				planExpiresAt: expiresAt,
				subscriptionCancelled: !isSubscriptionActive,
			})
			.where(eq(tables.organization.id, organizationId));

		// Track subscription reactivation if it was previously cancelled and is now active
		if (isSubscriptionActive && wasSubscriptionCancelled) {
			posthog.groupIdentify({
				groupType: "organization",
				groupKey: organizationId,
				properties: {
					name: organization.name,
				},
			});
			posthog.capture({
				distinctId: "organization",
				event: "subscription_reactivated",
				groups: {
					organization: organizationId,
				},
				properties: {
					plan: "pro",
					organization: organizationId,
					source: "stripe_subscription_updated",
				},
			});
			logger.info(
				`Reactivated subscription for organization ${organizationId}`,
			);
		}

		logger.info(
			`Updated subscription for organization ${organizationId}, expires at: ${expiresAt}, cancelled: ${!isSubscriptionActive}`,
		);
	}
}

async function handleSubscriptionDeleted(
	event: Stripe.CustomerSubscriptionDeletedEvent,
) {
	const subscription = event.data.object;
	const { customer, metadata } = subscription;

	const result = await resolveOrganizationFromStripeEvent({
		metadata: metadata as { organizationId?: string } | undefined,
		customer: typeof customer === "string" ? customer : customer?.id,
	});

	if (!result) {
		logger.error(`Organization not found for customer: ${customer}`);
		return;
	}

	const { organizationId, organization } = result;

	// Check if this is a dev plan subscription
	const isDevPlan =
		metadata?.subscriptionType === "dev_plan" ||
		organization.devPlanStripeSubscriptionId === subscription.id;

	if (isDevPlan) {
		// Handle dev plan subscription deletion
		const previousDevPlan = organization.devPlan;

		// Create transaction record for dev plan end
		await db.insert(tables.transaction).values({
			organizationId,
			type: "dev_plan_end",
			currency: "USD",
			status: "completed",
			stripeInvoiceId: subscription.latest_invoice as string,
			description: `Dev Plan ${previousDevPlan?.toUpperCase()} ended`,
		});

		// Reset dev plan fields
		await db
			.update(tables.organization)
			.set({
				devPlan: "none",
				devPlanCreditsLimit: "0",
				devPlanCreditsUsed: "0",
				devPlanStripeSubscriptionId: null,
				devPlanExpiresAt: null,
				devPlanCancelled: false,
				devPlanBillingCycleStart: null,
			})
			.where(eq(tables.organization.id, organizationId));

		// Send dev plan cancelled email
		await sendTransactionalEmail({
			to: organization.billingEmail,
			subject: "Your LLMGateway Dev Plan Has Been Cancelled",
			html: generateSubscriptionCancelledEmailHtml(organization.name),
		});

		logger.info(
			`Sent dev plan cancelled email to ${organization.billingEmail} for organization ${organizationId}`,
		);

		// Track dev plan cancellation in PostHog
		posthog.capture({
			distinctId: "organization",
			event: "dev_plan_ended",
			groups: {
				organization: organizationId,
			},
			properties: {
				previousDevPlan: previousDevPlan,
				organization: organizationId,
				source: "stripe_subscription_deleted",
			},
		});

		logger.info(
			`Ended dev plan ${previousDevPlan} for organization ${organizationId}`,
		);
	} else {
		// Handle regular pro plan subscription deletion
		// Create transaction record for subscription end
		await db.insert(tables.transaction).values({
			organizationId,
			type: "subscription_end",
			currency: "USD",
			status: "completed",
			stripeInvoiceId: subscription.latest_invoice as string,
			description: "Pro subscription ended",
		});

		// Downgrade organization to free plan and mark subscription as cancelled
		await db
			.update(tables.organization)
			.set({
				plan: "free",
				stripeSubscriptionId: null,
				planExpiresAt: null,
				subscriptionCancelled: false,
			})
			.where(eq(tables.organization.id, organizationId));

		// Send subscription cancelled email
		await sendTransactionalEmail({
			to: organization.billingEmail,
			subject: "Your LLMGateway Subscription Has Been Cancelled",
			html: generateSubscriptionCancelledEmailHtml(organization.name),
		});

		logger.info(
			`Sent subscription cancelled email to ${organization.billingEmail} for organization ${organizationId}`,
		);

		// Track subscription cancellation in PostHog
		posthog.groupIdentify({
			groupType: "organization",
			groupKey: organizationId,
			properties: {
				name: organization.name,
			},
		});
		posthog.capture({
			distinctId: "organization",
			event: "subscription_cancelled",
			groups: {
				organization: organizationId,
			},
			properties: {
				previousPlan: "pro",
				newPlan: "free",
				organization: organizationId,
				source: "stripe_subscription_deleted",
			},
		});

		logger.info(`Downgraded organization ${organizationId} to free plan`);
	}
}

async function handleSubscriptionCreated(
	event: Stripe.CustomerSubscriptionCreatedEvent,
) {
	const subscription = event.data.object;
	const { customer, metadata } = subscription;

	logger.info(
		`Processing subscription created for customer: ${customer}, subscription: ${subscription.id}`,
	);

	const result = await resolveOrganizationFromStripeEvent({
		metadata: metadata as { organizationId?: string } | undefined,
		customer: typeof customer === "string" ? customer : customer?.id,
		subscription: subscription.id,
	});

	if (!result) {
		logger.error(
			`Organization not found for customer: ${customer}, subscription: ${subscription.id}`,
		);
		return;
	}

	const { organizationId, organization } = result;

	logger.info(
		`Found organization: ${organization.name} (${organization.id}) for subscription creation`,
	);

	try {
		await db
			.update(tables.organization)
			.set({
				plan: "pro",
				stripeSubscriptionId: subscription.id,
				subscriptionCancelled: false,
			})
			.where(eq(tables.organization.id, organizationId))
			.returning();

		logger.info(
			`Successfully updated organization ${organizationId} with subscription ${subscription.id}`,
		);

		// Track subscription creation in PostHog
		posthog.groupIdentify({
			groupType: "organization",
			groupKey: organizationId,
			properties: {
				name: organization.name,
			},
		});
		posthog.capture({
			distinctId: "organization",
			event: "subscription_created",
			groups: {
				organization: organizationId,
			},
			properties: {
				plan: "pro",
				organization: organizationId,
				subscriptionId: subscription.id,
				source: "stripe_subscription_created",
			},
		});
	} catch (error) {
		logger.error(
			`Error updating organization ${organizationId} with subscription ${subscription.id}:`,
			error as Error,
		);
		throw error;
	}
}
