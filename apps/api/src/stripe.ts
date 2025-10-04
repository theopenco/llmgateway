import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db, eq, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { posthog } from "./posthog.js";
import { stripe } from "./routes/payments.js";

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
			case "customer.subscription.trial_will_end":
				await handleTrialWillEnd(event);
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

	logger.info(
		`Found organization: ${organization.name} (${organization.id}), current plan: ${organization.plan}`,
	);

	// Update organization with subscription ID and upgrade to pro plan
	try {
		const subscriptionId =
			typeof subscription === "string" ? subscription : subscription?.id;

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

		// Create transaction record for subscription start
		await db.insert(tables.transaction).values({
			organizationId,
			type: "subscription_start",
			amount: ((session.amount_total || 0) / 100).toString(),
			currency: (session.currency || "USD").toUpperCase(),
			status: "completed",
			stripeInvoiceId: session.invoice as string,
			description: "Pro subscription started via Stripe Checkout",
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
				source: "stripe_checkout",
			},
		});
	} catch (error) {
		logger.error(
			`Error updating organization ${organizationId} to pro plan via checkout:`,
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

	// Update organization credits with credit amount only (fees are not added as credits)
	await db
		.update(tables.organization)
		.set({
			credits: sql`${tables.organization.credits} + ${creditAmount}`,
		})
		.where(eq(tables.organization.id, organizationId));

	// Check if this is an auto top-up with an existing pending transaction
	const transactionId = metadata?.transactionId;
	if (transactionId) {
		// Update existing pending transaction
		const updatedTransaction = await db
			.update(tables.transaction)
			.set({
				status: "completed",
				description: "Auto top-up completed via Stripe webhook",
				creditAmount: creditAmount.toString(),
				amount: totalAmountInDollars.toString(),
			})
			.where(eq(tables.transaction.id, transactionId))
			.returning()
			.then((rows) => rows[0]);

		if (updatedTransaction) {
			logger.info(
				`Updated pending transaction ${transactionId} to completed for organization ${organizationId}`,
			);
		} else {
			logger.warn(
				`Could not find pending transaction ${transactionId} for organization ${organizationId}`,
			);
			// Fallback: create new transaction record
			await db.insert(tables.transaction).values({
				organizationId,
				type: "credit_topup",
				creditAmount: creditAmount.toString(),
				amount: totalAmountInDollars.toString(),
				currency: paymentIntent.currency.toUpperCase(),
				status: "completed",
				stripePaymentIntentId: paymentIntent.id,
				description: "Credit top-up via Stripe (fallback)",
			});
		}
	} else {
		// Create new transaction record (for manual top-ups or old auto top-ups)
		await db.insert(tables.transaction).values({
			organizationId,
			type: "credit_topup",
			creditAmount: creditAmount.toString(),
			amount: totalAmountInDollars.toString(),
			currency: paymentIntent.currency.toUpperCase(),
			status: "completed",
			stripePaymentIntentId: paymentIntent.id,
			description: "Credit top-up via Stripe",
		});
	}

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

	const { organizationId } = result;

	// Convert amount from cents to dollars
	const totalAmountInDollars = amount / 100;

	// Get the credit amount from metadata if available
	const creditAmount = metadata?.baseAmount
		? parseFloat(metadata.baseAmount)
		: null;

	// Check if this is an auto top-up with an existing pending transaction
	const transactionId = metadata?.transactionId;
	if (transactionId) {
		// Update existing pending transaction to failed
		const updatedTransaction = await db
			.update(tables.transaction)
			.set({
				status: "failed",
				description: `Auto top-up failed via Stripe webhook: ${paymentIntent.last_payment_error?.message || "Unknown error"}`,
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
				description: `Credit top-up failed via Stripe (fallback): ${paymentIntent.last_payment_error?.message || "Unknown error"}`,
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
			description: `Credit top-up failed via Stripe: ${paymentIntent.last_payment_error?.message || "Unknown error"}`,
		});
	}

	logger.info(
		`Payment intent failed for organization ${organizationId}: ${paymentIntent.last_payment_error?.message || "Unknown error"}`,
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

	logger.info(
		`Found organization: ${organization.name} (${organization.id}), current plan: ${organization.plan}`,
	);

	// Create transaction record for subscription start
	await db.insert(tables.transaction).values({
		organizationId,
		type: "subscription_start",
		amount: (invoice.amount_paid / 100).toString(),
		currency: invoice.currency.toUpperCase(),
		status: "completed",
		stripePaymentIntentId: (invoice as any).payment_intent,
		stripeInvoiceId: invoice.id,
		description: "Pro subscription started",
	});

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

	// Update plan expiration date
	const planExpiresAt = currentPeriodEnd
		? new Date(currentPeriodEnd * 1000)
		: undefined;

	// Check if subscription is active and organization was previously cancelled
	const isSubscriptionActive = !cancelAtPeriodEnd;
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
			planExpiresAt,
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
		logger.info(`Reactivated subscription for organization ${organizationId}`);
	}

	logger.info(
		`Updated subscription for organization ${organizationId}, expires at: ${planExpiresAt}, cancelled: ${!isSubscriptionActive}`,
	);
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

	const { organizationId } = result;

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

	// Track subscription cancellation in PostHog
	posthog.groupIdentify({
		groupType: "organization",
		groupKey: organizationId,
		properties: {
			name: result.organization.name,
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

async function handleSubscriptionCreated(
	event: Stripe.CustomerSubscriptionCreatedEvent,
) {
	const subscription = event.data.object;
	const { customer, metadata, trial_start, trial_end } = subscription;

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

	// Check if subscription has trial period
	const hasTrialPeriod = trial_start && trial_end;
	const trialStartDate = trial_start ? new Date(trial_start * 1000) : null;
	const trialEndDate = trial_end ? new Date(trial_end * 1000) : null;

	try {
		// Update organization with trial information
		const updateData: any = {
			plan: "pro",
			stripeSubscriptionId: subscription.id,
			subscriptionCancelled: false,
		};

		if (hasTrialPeriod) {
			updateData.trialStartDate = trialStartDate;
			updateData.trialEndDate = trialEndDate;
			updateData.isTrialActive = true;
		}

		await db
			.update(tables.organization)
			.set(updateData)
			.where(eq(tables.organization.id, organizationId))
			.returning();

		logger.info(
			`Successfully updated organization ${organizationId} with subscription ${subscription.id}. Trial active: ${hasTrialPeriod}`,
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
			event: hasTrialPeriod ? "trial_started" : "subscription_created",
			groups: {
				organization: organizationId,
			},
			properties: {
				plan: "pro",
				organization: organizationId,
				subscriptionId: subscription.id,
				source: "stripe_subscription_created",
				trialStartDate: trialStartDate?.toISOString(),
				trialEndDate: trialEndDate?.toISOString(),
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

async function handleTrialWillEnd(
	event: Stripe.CustomerSubscriptionTrialWillEndEvent,
) {
	const subscription = event.data.object;
	const { customer, metadata } = subscription;

	logger.info(
		`Processing trial will end for customer: ${customer}, subscription: ${subscription.id}`,
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
		`Found organization: ${organization.name} (${organization.id}) for trial ending`,
	);

	try {
		// Update organization to mark trial as ending
		await db
			.update(tables.organization)
			.set({
				isTrialActive: false,
			})
			.where(eq(tables.organization.id, organizationId));

		logger.info(
			`Successfully marked trial as ending for organization ${organizationId}`,
		);

		// Track trial ending in PostHog
		posthog.capture({
			distinctId: "organization",
			event: "trial_will_end",
			groups: {
				organization: organizationId,
			},
			properties: {
				plan: "pro",
				organization: organizationId,
				subscriptionId: subscription.id,
				source: "stripe_trial_will_end",
			},
		});
	} catch (error) {
		logger.error(
			`Error updating organization ${organizationId} trial status:`,
			error as Error,
		);
		throw error;
	}
}
