import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	and,
	db,
	enqueueWebhookDeliveries,
	eq,
	inArray,
	isNull,
	sql,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getChatPlanCreditsLimit,
	getDevPlanCreditsLimit,
	type ChatPlanCycle,
	type ChatPlanTier,
	type DevPlanCycle,
	type DevPlanTier,
} from "@llmgateway/shared";

import { computeReferralBonus } from "./lib/referral-bonus.js";
import { posthog } from "./posthog.js";
import { getStripe, type StripeMode } from "./routes/payments.js";
import {
	notifyChatPlanCancelled,
	notifyChatPlanRenewed,
	notifyChatPlanSubscribed,
	notifyCreditsPurchased,
	notifyDevPlanCancelled,
	notifyDevPlanRenewed,
	notifyDevPlanSubscribed,
} from "./utils/discord.js";
import {
	generateDevPlanCancellationFeedbackEmailHtml,
	generateDevPlanDuplicateCardEmailHtml,
	generatePaymentFailureEmailHtml,
	generateSubscriptionCancelledEmailHtml,
	sendTransactionalEmail,
} from "./utils/email.js";
import { generateAndEmailInvoice } from "./utils/invoice.js";
import {
	resolveChatPlanBillingDetails,
	resolveDevPassBillingDetails,
} from "./utils/plan-billing.js";

import type { ServerTypes } from "./vars.js";
import type Stripe from "stripe";

export async function ensureStripeCustomer(
	organizationId: string,
): Promise<string> {
	// Claim the row under a lock so two concurrent callers (e.g. the
	// setup_intent.succeeded webhook racing a payment-intent request) can't
	// each create a Stripe customer. Losing that race orphans one customer
	// and strands any payment method attached to it, which later breaks
	// off-session charges with "PaymentMethod does not belong to the
	// Customer". The second caller blocks until the first commits, then
	// sees the persisted id.
	const { stripeCustomerId, created, billingEmail } = await db.transaction(
		async (tx) => {
			const [organization] = await tx
				.select()
				.from(tables.organization)
				.where(eq(tables.organization.id, organizationId))
				.for("update")
				.limit(1);

			if (!organization) {
				throw new Error(`Organization not found: ${organizationId}`);
			}

			if (organization.stripeCustomerId) {
				return {
					stripeCustomerId: organization.stripeCustomerId,
					created: false,
					billingEmail: organization.billingEmail,
				};
			}

			// Deterministic idempotency key: if Stripe creates the customer but
			// the surrounding DB transaction fails to commit, the retry returns
			// the already-created customer instead of minting a duplicate.
			const customer = await getStripe().customers.create(
				{
					email: organization.billingEmail,
					metadata: {
						organizationId,
					},
				},
				{
					idempotencyKey: `ensure-stripe-customer:${organizationId}`,
				},
			);

			await tx
				.update(tables.organization)
				.set({
					stripeCustomerId: customer.id,
				})
				.where(eq(tables.organization.id, organizationId));

			return {
				stripeCustomerId: customer.id,
				created: true,
				billingEmail: organization.billingEmail,
			};
		},
	);

	if (!created) {
		// Update existing customer email if billingEmail has changed
		await getStripe().customers.update(stripeCustomerId, {
			email: billingEmail,
		});
	}

	return stripeCustomerId;
}

/**
 * LLM SDK: ensure the end-customer has its own Stripe customer, separate
 * from the developer's org customer, so cards and receipts are per-end-user.
 */
export async function ensureEndCustomerStripeCustomer(
	endCustomerId: string,
	mode: StripeMode = "live",
): Promise<string> {
	// Claim the row under a lock so two concurrent top-ups for the same customer
	// can't each create a Stripe customer (orphaning one). The second caller
	// blocks until the first commits, then sees the persisted id.
	return await db.transaction(async (tx) => {
		const [endCustomer] = await tx
			.select()
			.from(tables.endCustomer)
			.where(eq(tables.endCustomer.id, endCustomerId))
			.for("update")
			.limit(1);

		if (!endCustomer) {
			throw new Error(`End customer not found: ${endCustomerId}`);
		}

		if (endCustomer.stripeCustomerId) {
			return endCustomer.stripeCustomerId;
		}

		// Deterministic idempotency key: if Stripe creates the customer but
		// the surrounding DB transaction fails to commit, the retry returns
		// the already-created customer instead of minting a duplicate.
		const customer = await getStripe(mode).customers.create(
			{
				email: endCustomer.email ?? undefined,
				name: endCustomer.name ?? undefined,
				metadata: {
					endCustomerId,
					projectId: endCustomer.projectId,
					organizationId: endCustomer.organizationId,
				},
			},
			{
				idempotencyKey: `ensure-end-customer-stripe-customer:${endCustomerId}`,
			},
		);

		await tx
			.update(tables.endCustomer)
			.set({ stripeCustomerId: customer.id })
			.where(eq(tables.endCustomer.id, endCustomerId));

		return customer.id;
	});
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
			const stripeSubscription = await getStripe().subscriptions.retrieve(
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
			lineItemsCount: eventData.lines?.data?.length ?? 0,
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

/**
 * Verify a Stripe webhook signature against the live secret, then the sandbox
 * secret. Whichever verifies wins; if both are configured and neither matches,
 * the last error is rethrown so the handler returns 400.
 */
function constructWebhookEvent(
	body: string,
	sig: string,
): { event: Stripe.Event; mode: StripeMode } {
	const secrets: ReadonlyArray<[StripeMode, string | undefined]> = [
		["live", process.env.STRIPE_WEBHOOK_SECRET],
		["test", process.env.STRIPE_WEBHOOK_SECRET_TEST],
	];
	let lastError: Error | undefined;
	for (const [mode, secret] of secrets) {
		if (!secret) {
			continue;
		}
		try {
			return {
				event: getStripe(mode).webhooks.constructEvent(body, sig, secret),
				mode,
			};
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
		}
	}
	throw lastError ?? new Error("No Stripe webhook secret configured");
}

/**
 * Test-mode (sandbox) webhook events are only ever legitimate for LLM SDK
 * end-user wallet top-ups. Route them to the SDK handlers only — never the live
 * org billing handlers (credit top-ups, subscriptions, invoices) — even if the
 * test webhook endpoint is configured to forward broader event types. The
 * `payment_intent.*` handlers already gate on `kind === "end_user_topup"`, and
 * `charge.refunded` is restricted to end-user top-up refunds here.
 */
async function handleTestModeWebhookEvent(event: Stripe.Event): Promise<void> {
	switch (event.type) {
		case "payment_intent.succeeded": {
			const pi = event.data.object;
			if (pi.metadata?.kind === "end_user_topup") {
				await handleEndUserTopUpSucceeded(pi);
			} else {
				logger.warn("Ignoring non-SDK test-mode payment_intent.succeeded", {
					paymentIntentId: pi.id,
				});
			}
			break;
		}
		case "payment_intent.payment_failed": {
			const pi = event.data.object;
			logger.info("Test-mode payment intent failed", {
				paymentIntentId: pi.id,
				kind: pi.metadata?.kind,
			});
			break;
		}
		case "charge.refunded":
			await handleChargeRefunded(event, { endUserOnly: true });
			break;
		default:
			logger.info(`Ignoring test-mode event: ${event.type}`);
	}
}

stripeRoutes.openapi(webhookHandler, async (c) => {
	const sig = c.req.header("stripe-signature");

	if (!sig) {
		throw new HTTPException(400, {
			message: "Missing stripe-signature header",
		});
	}

	try {
		const body = await c.req.raw.text();

		// Verify against the live secret first, then the sandbox secret. Stripe
		// signs test-mode events (from LLM SDK test secret keys topping up via the
		// sandbox) with STRIPE_WEBHOOK_SECRET_TEST, delivered to the same endpoint.
		const { event, mode } = constructWebhookEvent(body, sig);

		logger.info("Stripe webhook received", {
			eventId: event.id,
			eventType: event.type,
			mode,
		});

		// Sandbox events must never reach the live org billing handlers — only the
		// SDK end-user wallet flow operates in test mode.
		if (mode === "test") {
			await handleTestModeWebhookEvent(event);
			return c.json({ received: true });
		}

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
			case "invoice.paid":
				await handleInvoicePaymentSucceeded(event);
				break;
			case "invoice.payment_failed":
				await handleInvoicePaymentFailed(event);
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

/**
 * Resolve the card fingerprint used for a Stripe subscription. Returns null
 * when the subscription is paid by a non-card payment method (SEPA, etc.) or
 * when the payment method is missing for any reason.
 */
async function getSubscriptionCardFingerprint(
	subscriptionId: string,
): Promise<string | null> {
	try {
		const subscription = await getStripe().subscriptions.retrieve(
			subscriptionId,
			{ expand: ["default_payment_method"] },
		);

		const defaultPaymentMethod = subscription.default_payment_method;
		let paymentMethod: Stripe.PaymentMethod | null = null;

		if (defaultPaymentMethod) {
			paymentMethod =
				typeof defaultPaymentMethod === "string"
					? await getStripe().paymentMethods.retrieve(defaultPaymentMethod)
					: defaultPaymentMethod;
		} else if (subscription.latest_invoice) {
			const invoiceId =
				typeof subscription.latest_invoice === "string"
					? subscription.latest_invoice
					: subscription.latest_invoice.id;
			if (invoiceId) {
				const invoice = await getStripe().invoices.retrieve(invoiceId, {
					expand: ["payment_intent"],
				});
				const paymentIntent = (invoice as any).payment_intent as
					| Stripe.PaymentIntent
					| string
					| null
					| undefined;
				const pi =
					typeof paymentIntent === "string"
						? await getStripe().paymentIntents.retrieve(paymentIntent)
						: paymentIntent;
				const pm = pi?.payment_method;
				if (pm) {
					paymentMethod =
						typeof pm === "string"
							? await getStripe().paymentMethods.retrieve(pm)
							: pm;
				}
			}
		}

		if (!paymentMethod || paymentMethod.type !== "card") {
			return null;
		}
		return paymentMethod.card?.fingerprint ?? null;
	} catch (error) {
		logger.error(
			`Failed to resolve card fingerprint for subscription ${subscriptionId}`,
			error instanceof Error ? error : new Error(String(error)),
		);
		return null;
	}
}

export type FinalizeDevPlanResult =
	| { status: "ok"; subscriptionId: string }
	| {
			status: "requires_action";
			subscriptionId: string;
			clientSecret: string;
			paymentMethodId?: string;
	  }
	| {
			status: "payment_pending";
			subscriptionId: string;
			subscriptionStatus?: string;
			invoiceId?: string;
			invoiceStatus?: string | null;
			paymentIntentStatus?: string;
			hasClientSecret?: boolean;
	  }
	| { status: "duplicate_card"; conflictingOrgId: string }
	| { status: "already_processed"; subscriptionId: string | null }
	| { status: "no_payment_method" }
	| { status: "invalid_session"; reason: string };

// The current billing period end is the authoritative renewal date. It lives on
// the subscription item (not the subscription) in current Stripe API versions.
// Returns null when the subscription has no items yet (e.g. mid-creation).
function getSubscriptionPeriodEnd(
	subscription: Stripe.Subscription,
): Date | null {
	const periodEnd = subscription.items.data[0]?.current_period_end;
	return periodEnd ? new Date(periodEnd * 1000) : null;
}

function isStripePaymentIntent(value: unknown): value is Stripe.PaymentIntent {
	if (!value || typeof value !== "object") {
		return false;
	}
	return (value as { object?: unknown }).object === "payment_intent";
}

function getSubscriptionPaymentIntent(
	subscription: Stripe.Subscription,
): Stripe.PaymentIntent | null {
	const latestInvoice = subscription.latest_invoice;
	if (
		!latestInvoice ||
		typeof latestInvoice === "string" ||
		!("payment_intent" in latestInvoice)
	) {
		return null;
	}

	const { payment_intent: paymentIntent } = latestInvoice as {
		payment_intent?: unknown;
	};
	if (!paymentIntent || typeof paymentIntent === "string") {
		return null;
	}

	return isStripePaymentIntent(paymentIntent) ? paymentIntent : null;
}

function getInvoiceConfirmationClientSecret(
	invoice: Stripe.Invoice,
): string | null {
	const confirmationSecret = invoice.confirmation_secret;
	return confirmationSecret?.client_secret ?? null;
}

async function getPaymentIntentFromInvoicePayments(
	invoice: Stripe.Invoice,
): Promise<Stripe.PaymentIntent | null> {
	let invoicePayments = invoice.payments?.data ?? [];
	if (invoicePayments.length === 0) {
		const listedPayments = await getStripe().invoicePayments.list({
			invoice: invoice.id,
			limit: 10,
		});
		invoicePayments = listedPayments.data;
	}

	for (const invoicePayment of invoicePayments) {
		const paymentIntent = invoicePayment.payment.payment_intent;
		if (!paymentIntent) {
			continue;
		}
		if (typeof paymentIntent !== "string") {
			if (isStripePaymentIntent(paymentIntent)) {
				return paymentIntent;
			}
			continue;
		}
		const retrieved = await getStripe().paymentIntents.retrieve(paymentIntent);
		return isStripePaymentIntent(retrieved) ? retrieved : null;
	}

	return null;
}

async function getSubscriptionInvoice(
	subscription: Stripe.Subscription,
): Promise<Stripe.Invoice | null> {
	const latestInvoice = subscription.latest_invoice;
	if (!latestInvoice) {
		return null;
	}
	if (typeof latestInvoice !== "string") {
		return latestInvoice;
	}

	return await getStripe().invoices.retrieve(latestInvoice, {
		expand: ["payment_intent"],
	});
}

async function getSubscriptionPaymentConfirmation(
	subscription: Stripe.Subscription,
): Promise<{
	paymentIntent: Stripe.PaymentIntent | null;
	clientSecret: string | null;
	invoice: Stripe.Invoice | null;
}> {
	const invoice = await getSubscriptionInvoice(subscription);
	if (!invoice) {
		return { paymentIntent: null, clientSecret: null, invoice: null };
	}

	let paymentIntent = getSubscriptionPaymentIntent(subscription);
	if (!paymentIntent) {
		const { payment_intent: invoicePaymentIntent } = invoice as {
			payment_intent?: unknown;
		};
		if (
			invoicePaymentIntent &&
			typeof invoicePaymentIntent !== "string" &&
			isStripePaymentIntent(invoicePaymentIntent)
		) {
			paymentIntent = invoicePaymentIntent;
		}
	}
	paymentIntent ??= await getPaymentIntentFromInvoicePayments(invoice);

	return {
		paymentIntent,
		clientSecret:
			paymentIntent?.client_secret ??
			getInvoiceConfirmationClientSecret(invoice),
		invoice,
	};
}

function getPaymentPendingResult({
	subscription,
	invoice,
	paymentIntent,
	clientSecret,
}: {
	subscription: Stripe.Subscription;
	invoice: Stripe.Invoice | null;
	paymentIntent: Stripe.PaymentIntent | null;
	clientSecret: string | null;
}): FinalizeDevPlanResult {
	logger.info("Dev plan subscription payment is pending", {
		subscriptionId: subscription.id,
		subscriptionStatus: subscription.status,
		invoiceId: invoice?.id,
		invoiceStatus: invoice?.status,
		paymentIntentId: paymentIntent?.id,
		paymentIntentStatus: paymentIntent?.status,
		hasClientSecret: Boolean(clientSecret),
	});

	return {
		status: "payment_pending",
		subscriptionId: subscription.id,
		subscriptionStatus: subscription.status,
		invoiceId: invoice?.id,
		invoiceStatus: invoice?.status,
		paymentIntentStatus: paymentIntent?.status,
		hasClientSecret: Boolean(clientSecret),
	};
}

async function findDevPlanSubscriptionForSetupSession(
	customerId: string,
	sessionId: string,
): Promise<Stripe.Subscription | null> {
	const subscriptions = await getStripe().subscriptions.list({
		customer: customerId,
		status: "all",
		limit: 100,
	});
	const existing = subscriptions.data.find(
		(subscription) => subscription.metadata?.setupSessionId === sessionId,
	);
	if (!existing) {
		return null;
	}

	return await getStripe().subscriptions.retrieve(existing.id, {
		expand: ["latest_invoice.payment_intent"],
	});
}

/**
 * Cancel stale DevPass subscriptions left on the customer by an earlier checkout
 * attempt. A setup-mode checkout creates one subscription per setup session, so
 * a first attempt whose payment never completes leaves a dangling `incomplete`
 * subscription that later flips to `incomplete_expired` — emitting events for a
 * plan the org never activated and, before the id-gating fix, freezing the
 * active plan's credits. Before activating the current session's subscription we
 * cancel those dangling attempts so the customer is never left with duplicate
 * DevPass subscriptions. The current session's own subscription is matched by
 * `setupSessionId` and never cancelled — which also keeps this safe under the
 * finalize/webhook race (both runs share the same session id).
 */
async function cancelStaleDevPlanSubscriptions(
	customerId: string,
	currentSessionId: string,
): Promise<void> {
	const subscriptions = await getStripe().subscriptions.list({
		customer: customerId,
		status: "all",
		limit: 100,
	});
	const stale = subscriptions.data.filter(
		(s) =>
			s.metadata?.subscriptionType === "dev_plan" &&
			s.metadata?.setupSessionId !== currentSessionId &&
			(s.status === "incomplete" || s.status === "past_due"),
	);
	for (const s of stale) {
		try {
			await getStripe().subscriptions.cancel(s.id);
			logger.info(
				`Cancelled stale DevPass subscription ${s.id} (status ${s.status}) for customer ${customerId}`,
			);
		} catch (err) {
			logger.warn(`Failed to cancel stale DevPass subscription ${s.id}`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}

/**
 * Collapse duplicate copies of a card down to a single payment method. Each
 * setup session saves the card as a fresh PaymentMethod object, so a retried
 * checkout would otherwise leave several PaymentMethods for the same physical
 * card on the customer. Keeps `keepPaymentMethodId` and detaches every other
 * payment method that shares its fingerprint.
 */
async function detachDuplicateCardPaymentMethods(
	customerId: string,
	keepPaymentMethodId: string,
	fingerprint: string | null,
): Promise<void> {
	if (!fingerprint) {
		return;
	}
	const paymentMethods = await getStripe().paymentMethods.list({
		customer: customerId,
		type: "card",
		limit: 100,
	});
	const duplicates = paymentMethods.data.filter(
		(pm) =>
			pm.id !== keepPaymentMethodId && pm.card?.fingerprint === fingerprint,
	);
	for (const pm of duplicates) {
		try {
			await getStripe().paymentMethods.detach(pm.id);
			logger.info(
				`Detached duplicate card ${pm.id} (fingerprint ${fingerprint}) from customer ${customerId}`,
			);
		} catch (err) {
			logger.warn(`Failed to detach duplicate card ${pm.id}`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}

function shouldForceDevPlan3dsChallenge(): boolean {
	return process.env.STRIPE_DEV_PLAN_FORCE_3DS === "true";
}

async function resolvePaymentMethodFromSetupSession(
	session: Stripe.Checkout.Session,
): Promise<Stripe.PaymentMethod | null> {
	let setupIntent: Stripe.SetupIntent | null = null;
	const rawSetupIntent = session.setup_intent;
	if (typeof rawSetupIntent === "string") {
		setupIntent = await getStripe().setupIntents.retrieve(rawSetupIntent);
	} else if (rawSetupIntent) {
		setupIntent = rawSetupIntent;
	}

	if (!setupIntent?.payment_method) {
		return null;
	}

	const pm = setupIntent.payment_method;
	if (typeof pm === "string") {
		return await getStripe().paymentMethods.retrieve(pm);
	}
	return pm;
}

/**
 * Finalize a DevPass setup-mode checkout session: verify the card fingerprint
 * is not already in use by another organization, then create the Stripe
 * subscription server-side. Idempotent: safe to call from both the
 * /dev-plans/finalize endpoint (user-triggered after redirect) and the
 * checkout.session.completed webhook (fallback if the user closes the tab).
 *
 * Critically, no Stripe subscription is created — and no charge is issued —
 * when the card is a duplicate. The duplicate payment method is detached
 * from the customer so it isn't accidentally reused later.
 */
export async function finalizeDevPlanSetupSession(
	sessionId: string,
): Promise<FinalizeDevPlanResult> {
	const session = await getStripe().checkout.sessions.retrieve(sessionId);

	if (session.mode !== "setup") {
		return { status: "invalid_session", reason: "not_setup_mode" };
	}

	const metadata = session.metadata ?? {};
	if (metadata.subscriptionType !== "dev_plan") {
		return { status: "invalid_session", reason: "not_dev_plan" };
	}

	const organizationId = metadata.organizationId;
	const devPlanTier = metadata.devPlan as DevPlanTier | undefined;
	const devPlanCycle: DevPlanCycle =
		metadata.devPlanCycle === "annual" ? "annual" : "monthly";
	const priceId = metadata.priceId;
	const userEmail = metadata.userEmail;

	if (!organizationId || !devPlanTier || !priceId) {
		return { status: "invalid_session", reason: "missing_metadata" };
	}

	const organization = await db.query.organization.findFirst({
		where: { id: organizationId },
	});
	if (!organization) {
		return { status: "invalid_session", reason: "org_not_found" };
	}

	if (
		organization.devPlan !== "none" &&
		organization.devPlanStripeSubscriptionId
	) {
		return {
			status: "already_processed",
			subscriptionId: organization.devPlanStripeSubscriptionId,
		};
	}

	const paymentMethod = await resolvePaymentMethodFromSetupSession(session);
	if (!paymentMethod) {
		return { status: "no_payment_method" };
	}

	const fingerprint =
		paymentMethod.type === "card"
			? (paymentMethod.card?.fingerprint ?? null)
			: null;

	if (fingerprint) {
		const conflictingOrg = await db.query.organization.findFirst({
			where: {
				devPlanCardFingerprint: { eq: fingerprint },
				id: { ne: organizationId },
			},
		});
		if (conflictingOrg) {
			try {
				await getStripe().paymentMethods.detach(paymentMethod.id);
			} catch (err) {
				logger.warn(
					`Failed to detach duplicate dev plan card ${paymentMethod.id}`,
					{
						error: err instanceof Error ? err.message : String(err),
					},
				);
			}

			logger.warn(
				`Rejecting dev plan setup ${sessionId} for org ${organizationId}: card fingerprint already used by org ${conflictingOrg.id}`,
			);

			posthog.capture({
				distinctId: "organization",
				event: "dev_plan_blocked_duplicate_card",
				groups: { organization: organizationId },
				properties: {
					organization: organizationId,
					conflictingOrganization: conflictingOrg.id,
					sessionId,
				},
			});

			const notifyEmail = userEmail ?? organization.billingEmail;
			if (notifyEmail) {
				try {
					await sendTransactionalEmail({
						to: notifyEmail,
						organizationId: organization.id,
						subject: "DevPass activation failed — card already in use",
						html: generateDevPlanDuplicateCardEmailHtml(organization.name),
					});
				} catch (err) {
					logger.error(
						"Failed to send dev plan duplicate-card email",
						err instanceof Error ? err : new Error(String(err)),
					);
				}
			}

			return {
				status: "duplicate_card",
				conflictingOrgId: conflictingOrg.id,
			};
		}
	}

	const stripeCustomerId = await ensureStripeCustomer(organizationId);

	await getStripe().customers.update(stripeCustomerId, {
		invoice_settings: { default_payment_method: paymentMethod.id },
	});

	// Prevent duplicate DevPass subscriptions/cards from a retried checkout. A
	// failed first attempt leaves a dangling `incomplete` subscription and a
	// duplicate copy of the card on the customer; cancel the former and detach the
	// latter before creating/activating this session's subscription. Cancel stale
	// subscriptions before detaching cards so we never detach a card still
	// referenced by a live subscription.
	await cancelStaleDevPlanSubscriptions(stripeCustomerId, sessionId);
	await detachDuplicateCardPaymentMethods(
		stripeCustomerId,
		paymentMethod.id,
		fingerprint,
	);

	// The /finalize endpoint and the checkout.session.completed webhook can
	// race for the same setup session. We guard against duplicate subscription
	// creation on two levels: (1) a deterministic Stripe idempotency key
	// derived from org+session so a second `subscriptions.create()` call
	// returns the same subscription instead of a new one; (2) an atomic
	// conditional UPDATE that only writes the dev plan state if no other
	// writer has filled in devPlanStripeSubscriptionId yet — the loser then
	// reports already_processed so it doesn't double-insert the transaction
	// row or re-send notifications.
	const existingSubscription = await findDevPlanSubscriptionForSetupSession(
		stripeCustomerId,
		sessionId,
	);
	const stripeIdempotencyKey = `devpass-sub:${organizationId}:${sessionId}`;
	const subscription =
		existingSubscription ??
		(await getStripe().subscriptions.create(
			{
				customer: stripeCustomerId,
				items: [{ price: priceId }],
				default_payment_method: paymentMethod.id,
				payment_behavior: "default_incomplete",
				...(shouldForceDevPlan3dsChallenge()
					? {
							payment_settings: {
								payment_method_options: {
									card: {
										request_three_d_secure: "challenge" as const,
									},
								},
							},
						}
					: {}),
				metadata: {
					organizationId,
					subscriptionType: "dev_plan",
					devPlan: devPlanTier,
					devPlanCycle,
					setupSessionId: sessionId,
					userEmail: userEmail ?? "",
				},
				expand: ["latest_invoice.payment_intent"],
			},
			{ idempotencyKey: stripeIdempotencyKey },
		));

	const { paymentIntent, clientSecret, invoice } =
		await getSubscriptionPaymentConfirmation(subscription);
	if (
		clientSecret &&
		((paymentIntent &&
			(paymentIntent.status === "requires_action" ||
				paymentIntent.status === "requires_confirmation" ||
				paymentIntent.status === "requires_payment_method")) ||
			(!paymentIntent &&
				(subscription.status === "incomplete" ||
					subscription.status === "past_due")))
	) {
		return {
			status: "requires_action",
			subscriptionId: subscription.id,
			clientSecret,
			paymentMethodId: paymentMethod.id,
		};
	}
	if (paymentIntent && paymentIntent.status !== "succeeded") {
		return getPaymentPendingResult({
			subscription,
			invoice,
			paymentIntent,
			clientSecret,
		});
	}
	if (
		!paymentIntent &&
		(subscription.status === "incomplete" || subscription.status === "past_due")
	) {
		return getPaymentPendingResult({
			subscription,
			invoice,
			paymentIntent,
			clientSecret,
		});
	}

	const creditsLimit = getDevPlanCreditsLimit(devPlanTier);

	const claimed = await db
		.update(tables.organization)
		.set({
			devPlan: devPlanTier,
			devPlanCreditsLimit: creditsLimit.toString(),
			devPlanCreditsUsed: "0",
			devPlanBillingCycleStart: new Date(),
			devPlanExpiresAt: getSubscriptionPeriodEnd(subscription),
			devPlanStripeSubscriptionId: subscription.id,
			devPlanCancelled: false,
			devPlanCycle,
			devPlanCardFingerprint: fingerprint,
		})
		.where(
			and(
				eq(tables.organization.id, organizationId),
				isNull(tables.organization.devPlanStripeSubscriptionId),
			),
		)
		.returning({ id: tables.organization.id });

	if (claimed.length === 0) {
		logger.info(
			`Dev plan finalize lost the race for org ${organizationId} session ${sessionId}; another path already activated subscription ${subscription.id}`,
		);
		return { status: "already_processed", subscriptionId: subscription.id };
	}

	logger.info(
		`Successfully activated dev plan ${devPlanTier} for organization ${organizationId} with ${creditsLimit} credits via setup-mode checkout`,
	);

	const latestInvoice = subscription.latest_invoice;
	const stripeInvoiceId =
		typeof latestInvoice === "string"
			? latestInvoice
			: (latestInvoice?.id ?? undefined);
	const invoiceAmount =
		typeof latestInvoice === "object" && latestInvoice
			? (latestInvoice.amount_paid / 100).toString()
			: "0";
	const invoiceCurrency = (
		typeof latestInvoice === "object" && latestInvoice
			? latestInvoice.currency
			: "usd"
	).toUpperCase();

	const existing = stripeInvoiceId
		? await db.query.transaction.findFirst({
				where: { stripeInvoiceId: { eq: stripeInvoiceId } },
			})
		: null;

	if (!existing) {
		const [transaction] = await db
			.insert(tables.transaction)
			.values({
				organizationId,
				type: "dev_plan_start",
				amount: invoiceAmount,
				creditAmount: creditsLimit.toString(),
				currency: invoiceCurrency,
				status: "completed",
				stripeInvoiceId,
				description: `Dev Plan ${devPlanTier.toUpperCase()} started via Stripe Checkout`,
			})
			.returning();

		try {
			const billingDetails = await resolveDevPassBillingDetails(organization);
			await generateAndEmailInvoice({
				organizationId: organization.id,
				invoiceNumber: transaction.id,
				invoiceDate: new Date(),
				organizationName: organization.name,
				...billingDetails,
				lineItems: [
					{
						description: `Dev Plan ${devPlanTier.toUpperCase()} ($${creditsLimit} credits included)`,
						amount: parseFloat(invoiceAmount),
					},
				],
				currency: invoiceCurrency,
			});
		} catch (e) {
			logger.error(
				"Invoice email failed (dev plan finalize); suppressing failure",
				e as Error,
			);
		}
	}

	posthog.groupIdentify({
		groupType: "organization",
		groupKey: organizationId,
		properties: { name: organization.name },
	});
	posthog.capture({
		distinctId: "organization",
		event: "dev_plan_started",
		groups: { organization: organizationId },
		properties: {
			devPlan: devPlanTier,
			creditsLimit,
			organization: organizationId,
			subscriptionId: subscription.id,
			source: "stripe_checkout_setup",
		},
	});

	const subscribedEmail = userEmail ?? organization.billingEmail;
	if (subscribedEmail) {
		const subscribedUser = await db.query.user.findFirst({
			where: { email: { eq: subscribedEmail } },
		});
		await notifyDevPlanSubscribed(
			subscribedEmail,
			subscribedUser?.name,
			devPlanTier,
			devPlanCycle,
		);
	}

	return { status: "ok", subscriptionId: subscription.id };
}

/**
 * Same one-card-one-org policy as DevPass — cancels a chat plan subscription
 * that was rejected because the card already activated a chat plan on another
 * organization.
 */
async function rejectDuplicateChatPlanSubscription(
	subscriptionId: string,
	reason: string,
) {
	try {
		await getStripe().subscriptions.cancel(subscriptionId, {
			invoice_now: false,
			prorate: false,
		});
	} catch (error) {
		logger.error(
			`Failed to cancel duplicate chat plan subscription ${subscriptionId}: ${reason}`,
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

async function handleCheckoutSessionCompleted(
	event: Stripe.CheckoutSessionCompletedEvent,
) {
	const session = event.data.object;
	const { customer, metadata, subscription } = session;

	logger.info(
		`Processing checkout session completed for customer: ${customer}, subscription: ${subscription}, mode: ${session.mode}`,
	);

	// DevPass uses setup-mode checkout so the card is collected without
	// charging. We verify the card fingerprint and create the subscription
	// server-side via finalizeDevPlanSetupSession. The /dev-plans/finalize
	// endpoint also calls the same helper when the user lands back on the
	// dashboard; this webhook is the fallback if the user closes the tab.
	if (session.mode === "setup" && metadata?.subscriptionType === "dev_plan") {
		try {
			const result = await finalizeDevPlanSetupSession(session.id);
			logger.info(
				`Dev plan setup-mode finalize result for session ${session.id}: ${result.status}`,
			);
		} catch (error) {
			logger.error(
				`Error finalizing dev plan setup session ${session.id}`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
		return;
	}

	if (!subscription && metadata?.type === "credit_topup") {
		await handleCreditTopUpCheckout(session);
		return;
	}

	if (!subscription && metadata?.type === "provider_listing") {
		await handleProviderListingCheckout(session);
		return;
	}

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
	const devPlanCycle: DevPlanCycle =
		metadata?.devPlanCycle === "annual" ? "annual" : "monthly";

	// Check if this is a chat plan subscription
	const isChatPlan = metadata?.subscriptionType === "chat_plan";
	const chatPlanTier = metadata?.chatPlan as ChatPlanTier | undefined;
	// Chat plans are monthly only.
	const chatPlanCycle: ChatPlanCycle = "monthly";

	logger.info(
		`Found organization: ${organization.name} (${organization.id}), current plan: ${organization.plan}, isDevPlan: ${isDevPlan}, isChatPlan: ${isChatPlan}`,
	);

	try {
		if (isChatPlan && chatPlanTier) {
			// Same card-fingerprint dedupe as dev plans — prevents a single card
			// from claiming the included chat plan allowance across multiple orgs.
			const fingerprint = subscriptionId
				? await getSubscriptionCardFingerprint(subscriptionId)
				: null;

			if (fingerprint) {
				const conflictingOrg = await db.query.organization.findFirst({
					where: {
						chatPlanCardFingerprint: { eq: fingerprint },
						id: { ne: organizationId },
					},
				});

				if (conflictingOrg) {
					logger.warn(
						`Rejecting duplicate chat plan subscription ${subscriptionId} for organization ${organizationId}: card fingerprint already claimed by organization ${conflictingOrg.id}`,
					);
					await rejectDuplicateChatPlanSubscription(
						subscriptionId!,
						"duplicate_card_fingerprint",
					);
					posthog.capture({
						distinctId: "organization",
						event: "chat_plan_blocked_duplicate_card",
						groups: {
							organization: organizationId,
						},
						properties: {
							organization: organizationId,
							conflictingOrganization: conflictingOrg.id,
							subscriptionId,
						},
					});
					return;
				}
			}

			const creditsLimit = getChatPlanCreditsLimit(chatPlanTier);

			await db
				.update(tables.organization)
				.set({
					chatPlan: chatPlanTier,
					chatPlanCreditsLimit: creditsLimit.toString(),
					chatPlanCreditsUsed: "0",
					chatPlanBillingCycleStart: new Date(),
					chatPlanStripeSubscriptionId: subscriptionId,
					chatPlanCancelled: false,
					chatPlanCycle,
					chatPlanCardFingerprint: fingerprint,
				})
				.where(eq(tables.organization.id, organizationId));

			logger.info(
				`Successfully activated chat plan ${chatPlanTier} for organization ${organizationId} with ${creditsLimit} credits`,
			);

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
						type: "chat_plan_start",
						amount: ((session.amount_total ?? 0) / 100).toString(),
						creditAmount: creditsLimit.toString(),
						currency: (session.currency ?? "USD").toUpperCase(),
						status: "completed",
						stripeInvoiceId: stripeInvoiceId,
						description: `Chat Plan ${chatPlanTier.toUpperCase()} started via Stripe Checkout`,
					})
					.returning();

				try {
					const billingDetails =
						await resolveChatPlanBillingDetails(organization);
					await generateAndEmailInvoice({
						organizationId: organization.id,
						invoiceNumber: transaction.id,
						invoiceDate: new Date(),
						organizationName: organization.name,
						...billingDetails,
						lineItems: [
							{
								description: `Chat Plan ${chatPlanTier.toUpperCase()} ($${creditsLimit} credits included)`,
								amount: (session.amount_total ?? 0) / 100,
							},
						],
						currency: (session.currency ?? "USD").toUpperCase(),
					});
				} catch (e) {
					logger.error(
						"Invoice email failed (chat plan checkout); suppressing webhook failure",
						e as Error,
					);
				}
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
				event: "chat_plan_started",
				groups: {
					organization: organizationId,
				},
				properties: {
					chatPlan: chatPlanTier,
					creditsLimit: creditsLimit,
					organization: organizationId,
					subscriptionId: subscriptionId,
					source: "stripe_checkout",
				},
			});

			const subscribedEmail =
				(metadata?.userEmail as string | undefined) ??
				organization.billingEmail;
			if (subscribedEmail) {
				const subscribedUser = await db.query.user.findFirst({
					where: { email: { eq: subscribedEmail } },
				});
				await notifyChatPlanSubscribed(
					subscribedEmail,
					subscribedUser?.name,
					chatPlanTier,
					chatPlanCycle,
				);
			}
		} else if (isDevPlan && devPlanTier) {
			// DevPass activations are now finalized via the setup-mode branch
			// above (see finalizeDevPlanSetupSession). This subscription-mode
			// branch only runs for legacy in-flight sessions created before
			// that switch landed and is kept as a safety net.
			const fingerprint = subscriptionId
				? await getSubscriptionCardFingerprint(subscriptionId)
				: null;

			const creditsLimit = getDevPlanCreditsLimit(devPlanTier);

			await db
				.update(tables.organization)
				.set({
					devPlan: devPlanTier,
					devPlanCreditsLimit: creditsLimit.toString(),
					devPlanCreditsUsed: "0",
					devPlanPremiumCreditsUsed: "0",
					devPlanPremiumWeekStart: new Date(),
					devPlanBillingCycleStart: new Date(),
					devPlanStripeSubscriptionId: subscriptionId,
					devPlanCancelled: false,
					devPlanCycle,
					devPlanCardFingerprint: fingerprint,
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
						amount: ((session.amount_total ?? 0) / 100).toString(),
						creditAmount: creditsLimit.toString(),
						currency: (session.currency ?? "USD").toUpperCase(),
						status: "completed",
						stripeInvoiceId: stripeInvoiceId,
						description: `Dev Plan ${devPlanTier.toUpperCase()} started via Stripe Checkout`,
					})
					.returning();

				// Generate and email invoice
				try {
					const billingDetails =
						await resolveDevPassBillingDetails(organization);
					await generateAndEmailInvoice({
						organizationId: organization.id,
						invoiceNumber: transaction.id,
						invoiceDate: new Date(),
						organizationName: organization.name,
						...billingDetails,
						lineItems: [
							{
								description: `Dev Plan ${devPlanTier.toUpperCase()} ($${creditsLimit} credits included)`,
								amount: (session.amount_total ?? 0) / 100,
							},
						],
						currency: (session.currency ?? "USD").toUpperCase(),
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

			const subscribedEmail =
				(metadata?.userEmail as string | undefined) ??
				organization.billingEmail;
			if (subscribedEmail) {
				const subscribedUser = await db.query.user.findFirst({
					where: { email: { eq: subscribedEmail } },
				});
				await notifyDevPlanSubscribed(
					subscribedEmail,
					subscribedUser?.name,
					devPlanTier,
					devPlanCycle,
				);
			}
		} else {
			// Handle regular pro subscription
			// Skip setting plan to "pro" for non-default orgs - devpass orgs use the
			// devPlan field and chat orgs use the chatPlan field instead.
			if (organization.kind !== "default") {
				logger.warn(
					`Skipping plan: "pro" for ${organization.kind} org ${organizationId} - non-default orgs use product-specific plan fields`,
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
				`Successfully upgraded organization ${organizationId} to pro tier via checkout. Updated rows: ${result.length}`,
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
						amount: ((session.amount_total ?? 0) / 100).toString(),
						currency: (session.currency ?? "USD").toUpperCase(),
						status: "completed",
						stripeInvoiceId: stripeInvoiceId,
						description: "Pro subscription started via Stripe Checkout",
					})
					.returning();

				// Generate and email invoice
				try {
					await generateAndEmailInvoice({
						organizationId: organization.id,
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
								amount: (session.amount_total ?? 0) / 100,
							},
						],
						currency: (session.currency ?? "USD").toUpperCase(),
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

type BonusType = "first_purchase" | "referral";

function getBonusLabel(bonusType: BonusType | null): string {
	switch (bonusType) {
		case "referral":
			return "referral bonus";
		default:
			return "first-time bonus";
	}
}

async function applyFirstTimeBonus({
	organizationId,
	creditAmount,
	isEmailVerified,
}: {
	organizationId: string;
	creditAmount: number;
	isEmailVerified: boolean;
}): Promise<{
	finalCreditAmount: number;
	bonusAmount: number;
	bonusType: BonusType | null;
}> {
	let bonusAmount = 0;
	let finalCreditAmount = creditAmount;
	let bonusType: BonusType | null = null;

	if (!isEmailVerified) {
		return { finalCreditAmount, bonusAmount, bonusType };
	}

	const previousPurchases = await db.query.transaction.findMany({
		where: {
			organizationId: { eq: organizationId },
			type: { eq: "credit_topup" },
			status: { eq: "completed" },
		},
		orderBy: { createdAt: "asc" },
		limit: 2,
	});

	// On the first top-up, a referral signup bonus takes precedence over the
	// generic first-time bonus (they do not stack).
	if (previousPurchases.length === 0) {
		const referralBonus = await computeReferralBonus(
			organizationId,
			creditAmount,
		);
		if (referralBonus > 0) {
			bonusAmount = referralBonus;
			finalCreditAmount = creditAmount + bonusAmount;
			bonusType = "referral";

			logger.info(
				`Applied referral signup bonus of $${bonusAmount} to organization ${organizationId}`,
			);

			return { finalCreditAmount, bonusAmount, bonusType };
		}
	}

	const firstBonusMultiplier = process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER
		? parseFloat(process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER)
		: 0;

	if (firstBonusMultiplier <= 1) {
		return { finalCreditAmount, bonusAmount, bonusType };
	}

	if (previousPurchases.length === 0) {
		const potentialBonus = creditAmount * (firstBonusMultiplier - 1);
		const maxBonus = 50;
		bonusAmount = Math.min(potentialBonus, maxBonus);
		finalCreditAmount = creditAmount + bonusAmount;
		bonusType = "first_purchase";

		logger.info(
			`Applied first-time bonus of $${bonusAmount} to organization ${organizationId} (${firstBonusMultiplier}x multiplier, max $${maxBonus})`,
		);
	}

	return { finalCreditAmount, bonusAmount, bonusType };
}

async function recordCreditTopUp({
	organizationId,
	finalCreditAmount,
	bonusAmount,
	creditAmount,
	totalAmountInDollars,
	currency,
	stripePaymentIntentId,
	description,
	organization,
	source,
	bonusType,
}: {
	organizationId: string;
	finalCreditAmount: number;
	bonusAmount: number;
	creditAmount: number;
	totalAmountInDollars: number;
	currency: string;
	stripePaymentIntentId: string | null;
	description: string;
	organization: {
		name: string;
		billingEmail: string | null;
		billingCompany: string | null;
		billingAddress: string | null;
		billingTaxId: string | null;
		billingNotes: string | null;
	};
	source: string;
	bonusType?: BonusType | null;
}) {
	await db
		.update(tables.organization)
		.set({
			credits: sql`${tables.organization.credits} + ${finalCreditAmount}`,
			paymentFailureCount: 0,
			lastPaymentFailureAt: null,
			paymentFailureStartedAt: null,
			lastTopUpAmount: creditAmount.toString(),
		})
		.where(eq(tables.organization.id, organizationId));

	// Reset low-balance email dedup so alerts can fire again on next cycle
	await db
		.delete(tables.followUpEmail)
		.where(
			and(
				eq(tables.followUpEmail.organizationId, organizationId),
				inArray(tables.followUpEmail.emailType, [
					"low_balance_20",
					"low_balance_5",
				]),
			),
		);

	const [completedTransaction] = await db
		.insert(tables.transaction)
		.values({
			organizationId,
			type: "credit_topup",
			creditAmount: finalCreditAmount.toString(),
			amount: totalAmountInDollars.toString(),
			currency,
			status: "completed",
			stripePaymentIntentId,
			description,
		})
		.returning();

	const lineItems = [
		{
			description: `Credit Top-up ($${creditAmount})`,
			amount: totalAmountInDollars,
		},
	];

	if (bonusAmount > 0) {
		const label = getBonusLabel(bonusType ?? null);
		const bonusLabel = label.charAt(0).toUpperCase() + label.slice(1);
		lineItems.push({
			description: `${bonusLabel} (+$${bonusAmount.toFixed(2)})`,
			amount: 0,
		});
	}

	try {
		await generateAndEmailInvoice({
			organizationId,
			invoiceNumber: completedTransaction.id,
			invoiceDate: new Date(),
			organizationName: organization.name,
			billingEmail: organization.billingEmail ?? "",
			billingCompany: organization.billingCompany,
			billingAddress: organization.billingAddress,
			billingTaxId: organization.billingTaxId,
			billingNotes: organization.billingNotes,
			lineItems,
			currency,
		});
	} catch (e) {
		logger.error(
			"Invoice email failed (credit top-up); suppressing webhook failure",
			e as Error,
		);
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
			source,
			organization: organizationId,
		},
	});
}

async function handleProviderListingCheckout(session: Stripe.Checkout.Session) {
	if (session.payment_status !== "paid") {
		logger.info(
			`Provider listing checkout session payment not yet settled (status: ${session.payment_status}), skipping`,
		);
		return;
	}

	const requestId = session.metadata?.submissionId;
	if (!requestId) {
		logger.error("Provider listing checkout session missing submissionId");
		return;
	}

	await db
		.update(tables.providerListingRequest)
		.set({
			paymentStatus: "paid",
			stripeCheckoutSessionId: session.id,
			paidAt: new Date(),
		})
		.where(eq(tables.providerListingRequest.id, requestId));

	logger.info(`Marked provider listing request ${requestId} as paid`);
}

async function handleCreditTopUpCheckout(session: Stripe.Checkout.Session) {
	const { customer, metadata } = session;

	if (session.payment_status !== "paid") {
		logger.info(
			`Credit top-up checkout session payment not yet settled (status: ${session.payment_status}), skipping`,
		);
		return;
	}

	const creditAmount = Number(metadata?.baseAmount);
	if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
		logger.error("Invalid baseAmount in credit top-up checkout metadata", {
			baseAmount: metadata?.baseAmount,
		});
		return;
	}

	const result = await resolveOrganizationFromStripeEvent({
		metadata: metadata as { organizationId?: string } | undefined,
		customer: typeof customer === "string" ? customer : customer?.id,
	});

	if (!result) {
		logger.error(
			"Could not resolve organization from credit top-up checkout session",
		);
		return;
	}

	const { organizationId, organization } = result;
	const totalAmountInDollars = (session.amount_total ?? 0) / 100;

	const stripePaymentIntentId =
		typeof session.payment_intent === "string"
			? session.payment_intent
			: (session.payment_intent?.id ?? null);

	if (!stripePaymentIntentId) {
		logger.error(
			"Credit top-up checkout session has no payment intent, skipping",
		);
		return;
	}

	const existingTransaction = await db.query.transaction.findFirst({
		where: {
			organizationId: { eq: organizationId },
			stripePaymentIntentId: { eq: stripePaymentIntentId },
			type: { eq: "credit_topup" },
			status: { eq: "completed" },
		},
	});

	if (existingTransaction) {
		logger.info(
			`Skipping duplicate credit top-up checkout for organization ${organizationId} (transaction ${existingTransaction.id} already exists)`,
		);
		return;
	}

	const userEmail = metadata?.userEmail;
	const resolvedUser = userEmail
		? await db.query.user.findFirst({
				where: {
					email: { eq: userEmail },
				},
			})
		: null;

	const { finalCreditAmount, bonusAmount, bonusType } =
		await applyFirstTimeBonus({
			organizationId,
			creditAmount,
			isEmailVerified: resolvedUser?.emailVerified ?? false,
		});

	const bonusLabel = getBonusLabel(bonusType);

	await recordCreditTopUp({
		organizationId,
		finalCreditAmount,
		bonusAmount,
		creditAmount,
		totalAmountInDollars,
		currency: (session.currency ?? "USD").toUpperCase(),
		stripePaymentIntentId,
		description:
			bonusAmount > 0
				? `Credit top-up via Stripe Checkout (+$${bonusAmount.toFixed(2)} ${bonusLabel})`
				: "Credit top-up via Stripe Checkout",
		organization,
		source: "stripe_checkout",
		bonusType,
	});

	if (userEmail) {
		await notifyCreditsPurchased(userEmail, resolvedUser?.name, creditAmount);
	}

	logger.info(
		`Added ${finalCreditAmount} credits to organization ${organizationId} via Stripe Checkout (paid $${totalAmountInDollars} including fees)`,
	);
}

/**
 * LLM SDK: credit an end-user wallet after a successful top-up payment.
 * Idempotent on wallet_ledger.stripePaymentIntentId. Splits the charge into the
 * net credited to the wallet, the developer's margin (accrued to the developer
 * org), and the platform fee — all carried in the PaymentIntent metadata that
 * /v1/wallet/top-up set.
 */
export async function handleEndUserTopUpSucceeded(
	paymentIntent: Stripe.PaymentIntent,
) {
	const md = paymentIntent.metadata;
	const walletId = md.walletId;
	const netCredited = Number(md.netCredited);
	const developerMargin = Number(md.developerMargin ?? "0");
	const platformFee = Number(md.platformFee ?? "0");
	const bonusCredited = Number(md.bonusCredited ?? "0");
	const grossPaid = paymentIntent.amount / 100;

	if (!walletId || !Number.isFinite(netCredited) || netCredited <= 0) {
		logger.error("Invalid end_user_topup metadata", {
			paymentIntentId: paymentIntent.id,
			metadata: md,
		});
		return;
	}

	// Fast-path idempotency: a topup ledger row for this payment intent means we
	// already processed it (webhook re-delivery). The authoritative guard is the
	// unique partial index on wallet_ledger(stripePaymentIntentId) WHERE
	// type='topup', enforced inside the transaction below to close the race
	// between concurrent deliveries.
	const existing = await db.query.walletLedger.findFirst({
		where: {
			stripePaymentIntentId: { eq: paymentIntent.id },
			type: { eq: "topup" },
		},
	});
	if (existing) {
		logger.info(
			`Skipping duplicate end-user top-up for wallet ${walletId} (ledger ${existing.id} already processed)`,
		);
		return;
	}

	const wallet = await db.query.wallet.findFirst({
		where: { id: { eq: walletId } },
	});
	if (!wallet) {
		logger.error(`Wallet not found for end-user top-up: ${walletId}`);
		return;
	}

	// Test-mode top-ups are Stripe-sandbox payments: never accrue real, payable
	// developer margin. Persist zero on the ledger row too, so a later refund
	// (which claws back the ledger's developerMargin) can't erase live earnings.
	const accruedMargin = wallet.mode === "test" ? 0 : developerMargin;

	// Credit the wallet, write the ledger row, and accrue the developer margin
	// atomically. The ledger insert hits the unique index first, so a concurrent
	// duplicate delivery rolls the whole transaction back instead of double-
	// crediting.
	let txResult: { balance: string; bonusApplied: number };
	try {
		txResult = await db.transaction(async (tx) => {
			// Developer-funded bonus: resolve and reserve it FIRST, locking the org
			// row (SELECT … FOR UPDATE) and debiting its credits before we touch the
			// wallet. The worker debits org credits before wallet balance
			// (worker.ts), so acquiring the org lock ahead of the wallet here keeps a
			// consistent org→wallet lock order and avoids deadlocking a concurrent
			// usage-debit batch. Live wallets only (test-mode top-ups are Stripe
			// sandbox and must never spend real org credits), and capped with
			// `Math.floor` at the org's available credits so `credits` can never go
			// negative.
			let bonusApplied = 0;
			if (bonusCredited > 0 && wallet.mode !== "test") {
				const [org] = await tx
					.select({ credits: tables.organization.credits })
					.from(tables.organization)
					.where(eq(tables.organization.id, wallet.organizationId))
					.for("update")
					.limit(1);

				const availableCredits = Math.max(0, Number(org?.credits ?? "0"));
				bonusApplied =
					Math.floor(Math.min(bonusCredited, availableCredits) * 1e6) / 1e6;

				if (bonusApplied > 0) {
					await tx
						.update(tables.organization)
						.set({
							credits: sql`${tables.organization.credits} - ${bonusApplied}`,
						})
						.where(eq(tables.organization.id, wallet.organizationId));

					await tx.insert(tables.transaction).values({
						organizationId: wallet.organizationId,
						type: "end_user_bonus",
						amount: String(bonusApplied),
						creditAmount: String(-bonusApplied),
						status: "completed",
						stripePaymentIntentId: paymentIntent.id,
						description: `End-user top-up bonus (wallet ${walletId})`,
					});
				} else {
					logger.warn(
						`Skipping end-user top-up bonus for wallet ${walletId}: developer org ${wallet.organizationId} has insufficient credits (${availableCredits} available, ${bonusCredited} needed)`,
					);
				}
			}

			// Credit the paid amount + write the topup ledger row. The ledger insert
			// hits the unique index, so a concurrent duplicate delivery blocks on the
			// wallet row above, then rolls the whole transaction back here.
			const [updated] = await tx
				.update(tables.wallet)
				.set({ balance: sql`${tables.wallet.balance} + ${netCredited}` })
				.where(eq(tables.wallet.id, walletId))
				.returning();

			await tx.insert(tables.walletLedger).values({
				walletId,
				endCustomerId: wallet.endCustomerId,
				organizationId: wallet.organizationId,
				type: "topup",
				amount: String(netCredited),
				balanceAfter: updated.balance,
				grossPaid: String(grossPaid),
				platformFee: String(platformFee),
				developerMargin: String(accruedMargin),
				netCredited: String(netCredited),
				stripePaymentIntentId: paymentIntent.id,
				description: "End-user credit top-up",
			});

			// Record the end-user top-up as LLM Gateway revenue, mirroring an org
			// credit purchase: `amount` = gross Stripe charge, `creditAmount` = net
			// credit value (Stripe fees excluded; the developer's markup margin is
			// tracked separately as a liability, not revenue). Live wallets only —
			// sandbox top-ups are not real money. Reversed on refund below.
			if (wallet.mode !== "test") {
				await tx.insert(tables.transaction).values({
					organizationId: wallet.organizationId,
					type: "end_user_topup",
					amount: String(grossPaid),
					creditAmount: String(netCredited),
					status: "completed",
					stripePaymentIntentId: paymentIntent.id,
					description: `End-user credit top-up (wallet ${walletId})`,
				});
			}

			// Accrue the developer's margin to their org (settled out-of-band / via
			// Stripe Connect) and record it in the org's transaction history.
			if (accruedMargin > 0) {
				await tx
					.update(tables.organization)
					.set({
						endUserMarginBalance: sql`${tables.organization.endUserMarginBalance} + ${accruedMargin}`,
					})
					.where(eq(tables.organization.id, wallet.organizationId));

				await tx.insert(tables.transaction).values({
					organizationId: wallet.organizationId,
					type: "end_user_margin_accrual",
					amount: String(accruedMargin),
					creditAmount: String(accruedMargin),
					status: "completed",
					stripePaymentIntentId: paymentIntent.id,
					description: `End-user top-up margin (wallet ${walletId})`,
				});
			}

			// Credit the reserved bonus on top of the paid amount, in its own ledger
			// row so the economic split stays legible.
			let finalBalance = updated.balance;
			if (bonusApplied > 0) {
				const [bonusUpdated] = await tx
					.update(tables.wallet)
					.set({ balance: sql`${tables.wallet.balance} + ${bonusApplied}` })
					.where(eq(tables.wallet.id, walletId))
					.returning();
				finalBalance = bonusUpdated.balance;

				await tx.insert(tables.walletLedger).values({
					walletId,
					endCustomerId: wallet.endCustomerId,
					organizationId: wallet.organizationId,
					type: "bonus",
					amount: String(bonusApplied),
					balanceAfter: bonusUpdated.balance,
					stripePaymentIntentId: paymentIntent.id,
					description: "End-user top-up bonus",
				});
			}

			return { balance: finalBalance, bonusApplied };
		});
	} catch (err) {
		const code =
			(err as { code?: string; cause?: { code?: string } })?.code ??
			(err as { cause?: { code?: string } })?.cause?.code;
		if (code === "23505") {
			logger.info(
				`Skipping duplicate end-user top-up for wallet ${walletId} (concurrent delivery for ${paymentIntent.id})`,
			);
			return;
		}
		throw err;
	}

	const { balance: newBalance, bonusApplied } = txResult;

	logger.info(
		`Credited ${netCredited} to end-user wallet ${walletId} (margin ${developerMargin}, platform fee ${platformFee}, bonus ${bonusApplied}, balance now ${newBalance})`,
	);

	// Notify the developer's webhook endpoints (best-effort). Skip for test-mode
	// wallets: webhook endpoints are live-only (test keys can't manage them), so
	// delivering sandbox top-up events to the developer's real consumers would
	// be misleading.
	if (wallet.mode !== "test") {
		try {
			await enqueueWebhookDeliveries({
				projectId: wallet.projectId,
				eventType: "wallet.credited",
				data: {
					walletId,
					endCustomerId: wallet.endCustomerId,
					netCredited,
					// Developer-funded bonus actually applied (post-cap), and the total
					// spend power added, so consumers don't have to infer it from the
					// balance delta.
					bonusCredited: bonusApplied,
					totalCredited: netCredited + bonusApplied,
					grossPaid,
					balance: newBalance,
					currency: wallet.currency,
				},
			});
		} catch (err) {
			logger.warn("Failed to enqueue wallet.credited webhook", {
				walletId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}

/**
 * LLM SDK: reverse an end-user wallet top-up on refund. Idempotent on a
 * reversal ledger row. The wallet debit is clamped to the current balance (the
 * end-user may have already spent some), and the developer's accrued margin is
 * clawed back (clamped at zero).
 */
export async function handleEndUserTopUpRefunded(
	topUp: typeof tables.walletLedger.$inferSelect,
) {
	if (!topUp.stripePaymentIntentId) {
		return;
	}

	const alreadyReversed = await db.query.walletLedger.findFirst({
		where: {
			stripePaymentIntentId: { eq: topUp.stripePaymentIntentId },
			type: { eq: "reversal" },
		},
	});
	if (alreadyReversed) {
		logger.info(
			`Skipping duplicate end-user refund for wallet ${topUp.walletId}`,
		);
		return;
	}

	const credited = Number(topUp.netCredited ?? "0");
	const developerMargin = Number(topUp.developerMargin ?? "0");

	// The developer-funded bonus (if any) shares this PaymentIntent. Reverse it
	// too so a refunded top-up can't leave gifted, developer-funded spend power in
	// the wallet (top up → get bonus → refund → keep bonus).
	const bonusRow = await db.query.walletLedger.findFirst({
		where: {
			stripePaymentIntentId: { eq: topUp.stripePaymentIntentId },
			type: { eq: "bonus" },
		},
	});
	const bonusOriginal = Number(bonusRow?.amount ?? "0");

	// Debit the wallet, write the reversal ledger row, and claw back the margin
	// atomically. The ledger insert hits the unique partial index
	// (wallet_ledger_reversal_payment_intent_unique), so a concurrent / re-
	// delivered charge.refunded rolls the whole transaction back instead of
	// double-reversing. The wallet is locked + re-read inside the transaction so
	// the balance clamp can't go stale against a concurrent debit.
	let reversal: number;
	try {
		reversal = await db.transaction(async (tx) => {
			// When restoring org credits for a bonus claw-back, lock the org row
			// before the wallet to match the worker's org→wallet lock order and the
			// top-up path above, avoiding a deadlock with a concurrent usage-debit.
			if (bonusOriginal > 0) {
				await tx
					.select({ id: tables.organization.id })
					.from(tables.organization)
					.where(eq(tables.organization.id, topUp.organizationId))
					.for("update")
					.limit(1);
			}

			const [wallet] = await tx
				.select()
				.from(tables.wallet)
				.where(eq(tables.wallet.id, topUp.walletId))
				.for("update")
				.limit(1);
			if (!wallet) {
				logger.error(`Wallet not found for end-user refund: ${topUp.walletId}`);
				return 0;
			}

			// Reverse the paid top-up first, then the bonus, each clamped to the
			// balance still in the wallet (the end-user may have already spent some).
			const currentBalance = Math.max(Number(wallet.balance ?? "0"), 0);
			const topupReversed = Math.min(credited, currentBalance);
			const bonusReversed =
				Math.floor(
					Math.min(bonusOriginal, currentBalance - topupReversed) * 1e6,
				) / 1e6;
			const amount = Math.round((topupReversed + bonusReversed) * 1e6) / 1e6;

			const [updated] = await tx
				.update(tables.wallet)
				.set({ balance: sql`${tables.wallet.balance} - ${amount}` })
				.where(eq(tables.wallet.id, topUp.walletId))
				.returning();

			await tx.insert(tables.walletLedger).values({
				walletId: topUp.walletId,
				endCustomerId: topUp.endCustomerId,
				organizationId: topUp.organizationId,
				type: "reversal",
				amount: String(-amount),
				balanceAfter: updated.balance,
				stripePaymentIntentId: topUp.stripePaymentIntentId,
				description:
					bonusReversed > 0
						? "End-user top-up refund (incl. bonus claw-back)"
						: "End-user top-up refund",
			});

			// Reverse the top-up revenue booked at top-up time. The Stripe refund
			// returns the whole payment, so reverse the full net/gross (independent
			// of how much of the wallet balance was already spent). Live wallets
			// only, matching the `end_user_topup` grant above.
			const revenueReversed = Number(topUp.netCredited ?? "0");
			const grossReversed = Number(topUp.grossPaid ?? "0");
			if (
				wallet.mode !== "test" &&
				(revenueReversed > 0 || grossReversed > 0)
			) {
				await tx.insert(tables.transaction).values({
					organizationId: topUp.organizationId,
					type: "end_user_topup",
					amount: String(-grossReversed),
					creditAmount: String(-revenueReversed),
					status: "completed",
					stripePaymentIntentId: topUp.stripePaymentIntentId,
					description: `End-user top-up refund reversal (wallet ${topUp.walletId})`,
				});
			}

			if (developerMargin > 0) {
				await tx
					.update(tables.organization)
					.set({
						endUserMarginBalance: sql`GREATEST(${tables.organization.endUserMarginBalance} - ${developerMargin}, 0)`,
					})
					.where(eq(tables.organization.id, topUp.organizationId));

				await tx.insert(tables.transaction).values({
					organizationId: topUp.organizationId,
					type: "end_user_refund",
					amount: String(developerMargin),
					creditAmount: String(developerMargin),
					status: "completed",
					stripePaymentIntentId: topUp.stripePaymentIntentId,
					description: `End-user top-up refund margin claw-back (wallet ${topUp.walletId})`,
				});
			}

			// Return the clawed-back bonus to the developer org's credit balance.
			if (bonusReversed > 0) {
				await tx
					.update(tables.organization)
					.set({
						credits: sql`${tables.organization.credits} + ${bonusReversed}`,
					})
					.where(eq(tables.organization.id, topUp.organizationId));

				await tx.insert(tables.transaction).values({
					organizationId: topUp.organizationId,
					type: "end_user_bonus",
					amount: String(bonusReversed),
					creditAmount: String(bonusReversed),
					status: "completed",
					stripePaymentIntentId: topUp.stripePaymentIntentId,
					description: `End-user top-up bonus claw-back on refund (wallet ${topUp.walletId})`,
				});
			}

			return amount;
		});
	} catch (err) {
		const code =
			(err as { code?: string; cause?: { code?: string } })?.code ??
			(err as { cause?: { code?: string } })?.cause?.code;
		if (code === "23505") {
			logger.info(
				`Skipping duplicate end-user refund for wallet ${topUp.walletId} (concurrent delivery for ${topUp.stripePaymentIntentId})`,
			);
			return;
		}
		throw err;
	}

	logger.info(
		`Reversed ${reversal} from end-user wallet ${topUp.walletId} on refund`,
	);
}

async function handlePaymentIntentSucceeded(
	event: Stripe.PaymentIntentSucceededEvent,
) {
	const paymentIntent = event.data.object;
	const { metadata, amount } = paymentIntent;

	// LLM SDK end-user wallet top-ups are handled separately and bill an
	// end-user wallet, not the developer's org credits.
	if (paymentIntent.metadata.kind === "end_user_topup") {
		await handleEndUserTopUpSucceeded(paymentIntent);
		return;
	}

	// payment_intent.succeeded also fires for subscription invoice payments;
	// only credit top-up payment intents set baseAmount in metadata.
	if (paymentIntent.metadata.baseAmount === undefined) {
		return;
	}

	const creditAmount = Number(paymentIntent.metadata.baseAmount);
	if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
		logger.error("Invalid baseAmount in payment intent metadata", {
			baseAmount: paymentIntent.metadata.baseAmount,
			paymentIntentId: paymentIntent.id,
		});
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

	const existingTransaction = await db.query.transaction.findFirst({
		where: {
			stripePaymentIntentId: { eq: paymentIntent.id },
			type: { eq: "credit_topup" },
			status: { eq: "completed" },
		},
	});

	if (existingTransaction) {
		logger.info(
			`Skipping duplicate payment_intent.succeeded for organization ${organizationId} (transaction ${existingTransaction.id} already processed)`,
		);
		return;
	}

	const totalAmountInDollars = amount / 100;

	const userEmail = metadata?.userEmail;
	const resolvedUser = userEmail
		? await db.query.user.findFirst({
				where: {
					email: { eq: userEmail },
				},
			})
		: null;

	const { finalCreditAmount, bonusAmount, bonusType } =
		await applyFirstTimeBonus({
			organizationId,
			creditAmount,
			isEmailVerified: resolvedUser?.emailVerified ?? false,
		});

	// Check if this is an auto top-up with an existing pending transaction
	const transactionId = metadata?.transactionId;

	const bonusLabel = getBonusLabel(bonusType);
	const transactionDescription =
		bonusAmount > 0
			? `Credit top-up via Stripe (+$${bonusAmount.toFixed(2)} ${bonusLabel})`
			: "Credit top-up via Stripe";

	if (transactionId) {
		await db
			.update(tables.organization)
			.set({
				credits: sql`${tables.organization.credits} + ${finalCreditAmount}`,
				paymentFailureCount: 0,
				lastPaymentFailureAt: null,
				paymentFailureStartedAt: null,
				lastTopUpAmount: creditAmount.toString(),
			})
			.where(eq(tables.organization.id, organizationId));

		// Reset low-balance email dedup so alerts can fire again on next cycle
		await db
			.delete(tables.followUpEmail)
			.where(
				and(
					eq(tables.followUpEmail.organizationId, organizationId),
					inArray(tables.followUpEmail.emailType, [
						"low_balance_20",
						"low_balance_5",
					]),
				),
			);

		const updatedTransaction = await db
			.update(tables.transaction)
			.set({
				status: "completed",
				stripePaymentIntentId: paymentIntent.id,
				description:
					bonusAmount > 0
						? `Auto top-up completed via Stripe webhook (+$${bonusAmount.toFixed(2)} ${bonusLabel})`
						: "Auto top-up completed via Stripe webhook",
				creditAmount: finalCreditAmount.toString(),
				amount: totalAmountInDollars.toString(),
			})
			.where(eq(tables.transaction.id, transactionId))
			.returning()
			.then((rows) => rows[0]);

		let completedTransactionId: string;

		if (!updatedTransaction) {
			logger.warn(
				`Could not find pending transaction ${transactionId} for organization ${organizationId}, creating new record`,
			);
			const [fallbackTransaction] = await db
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
			completedTransactionId = fallbackTransaction.id;
		} else {
			completedTransactionId = updatedTransaction.id;
		}

		const lineItems = [
			{
				description: `Credit Top-up ($${creditAmount})`,
				amount: totalAmountInDollars,
			},
		];

		if (bonusAmount > 0) {
			const autoBonusLabel =
				bonusLabel.charAt(0).toUpperCase() + bonusLabel.slice(1);
			lineItems.push({
				description: `${autoBonusLabel} (+$${bonusAmount.toFixed(2)})`,
				amount: 0,
			});
		}

		try {
			await generateAndEmailInvoice({
				organizationId: organization.id,
				invoiceNumber: completedTransactionId,
				invoiceDate: new Date(),
				organizationName: organization.name,
				billingEmail: organization.billingEmail ?? "",
				billingCompany: organization.billingCompany,
				billingAddress: organization.billingAddress,
				billingTaxId: organization.billingTaxId,
				billingNotes: organization.billingNotes,
				lineItems,
				currency: paymentIntent.currency.toUpperCase(),
			});
		} catch (e) {
			logger.error(
				"Invoice email failed (auto top-up); suppressing webhook failure",
				e as Error,
			);
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
	} else {
		await recordCreditTopUp({
			organizationId,
			finalCreditAmount,
			bonusAmount,
			creditAmount,
			totalAmountInDollars,
			currency: paymentIntent.currency.toUpperCase(),
			stripePaymentIntentId: paymentIntent.id,
			description: transactionDescription,
			organization,
			source: "payment_intent",
			bonusType,
		});
	}

	if (userEmail) {
		await notifyCreditsPurchased(userEmail, resolvedUser?.name, creditAmount);
	}

	logger.info(
		`Added credits to organization ${organizationId} (paid ${totalAmountInDollars} including fees)`,
	);
}

export async function handlePaymentIntentFailed(
	event: Stripe.PaymentIntentPaymentFailedEvent,
) {
	const paymentIntent = event.data.object;
	const { metadata, amount } = paymentIntent;

	// LLM SDK end-user wallet top-ups are not org credit purchases. A failed one
	// (e.g. a Stripe sandbox decline-test card during development) must not mutate
	// the developer org's billing state — payment-failure rows, failure counts,
	// or dunning emails. Just log it and stop.
	if (metadata?.kind === "end_user_topup") {
		logger.info("End-user top-up payment failed", {
			walletId: metadata.walletId,
			paymentIntentId: paymentIntent.id,
		});
		return;
	}

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
	const errorMessage = lastPaymentError?.message ?? "Unknown error";
	const errorCode = lastPaymentError?.code;
	const declineCode = lastPaymentError?.decline_code;

	// Record payment failure for admin dashboard (idempotent — no-op on duplicate)
	await db
		.insert(tables.paymentFailure)
		.values({
			organizationId,
			userEmail: metadata?.userEmail ?? null,
			amount: totalAmountInDollars.toString(),
			currency: paymentIntent.currency.toUpperCase(),
			declineCode: declineCode ?? null,
			errorCode: errorCode ?? null,
			failureMessage: errorMessage,
			stripePaymentIntentId: paymentIntent.id,
			source: metadata?.autoTopUp === "true" ? "auto_topup" : "manual",
		})
		.onConflictDoNothing();

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

	// Only credit top-up payment intents may be recorded as a `credit_topup`
	// transaction. Subscription invoice payments (Pro / DevPass / chat plan) also
	// emit `payment_intent.payment_failed`, but recording them here produced a
	// phantom "Credit top-up failed" row on the customer's billing history (and
	// the credit-purchase paths never create such a charge). Mirror the
	// `baseAmount` guard in handlePaymentIntentSucceeded: actual top-ups always
	// set `baseAmount` (manual + auto) or carry a pending `transactionId`;
	// subscription invoice intents carry neither. Failure tracking above
	// (paymentFailure row + dunning email) still runs for subscription invoices,
	// and dev/chat plan credit freezes are handled in handleInvoicePaymentFailed.
	const transactionId = metadata?.transactionId;
	const isCreditTopup =
		metadata?.baseAmount !== undefined || transactionId !== undefined;
	if (isCreditTopup) {
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
	}

	// Update payment failure tracking with exponential backoff
	// Calculate new failure count and check if we should send an email
	const previousFailureCount = organization.paymentFailureCount ?? 0;
	const previousFailureAt = organization.lastPaymentFailureAt;
	const failureStartedAt = organization.paymentFailureStartedAt ?? new Date();
	const newFailureCount = previousFailureCount + 1;

	// Update organization with new failure count and timestamp
	await db
		.update(tables.organization)
		.set({
			paymentFailureCount: newFailureCount,
			lastPaymentFailureAt: new Date(),
			paymentFailureStartedAt: failureStartedAt,
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
				organizationId: organization.id,
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

// Current Stripe API versions no longer expose the invoice link on the Charge or
// PaymentIntent objects, so a `charge.refunded` event for a subscription invoice
// can't be mapped back to its invoice directly. DevPass transactions
// (`dev_plan_start` from setup-mode checkout, and invoice renewals) store the
// invoice id rather than the payment intent, so to record the refund we resolve
// the paid invoice from the invoice payment that this payment intent settled.
// Filtering the invoice_payments list by the payment intent is an exact,
// unbounded lookup — it works even for refunds of arbitrarily old invoices.
async function resolveRefundInvoiceId(
	paymentIntentId: string,
): Promise<string | undefined> {
	const payments = await getStripe().invoicePayments.list({
		payment: { type: "payment_intent", payment_intent: paymentIntentId },
		limit: 1,
	});
	const invoice = payments.data[0]?.invoice;
	if (!invoice) {
		return undefined;
	}
	return typeof invoice === "string" ? invoice : (invoice.id ?? undefined);
}

export async function handleChargeRefunded(
	event: Stripe.ChargeRefundedEvent,
	options: { endUserOnly?: boolean } = {},
) {
	const charge = event.data.object;
	const { payment_intent } = charge;

	if (!payment_intent) {
		logger.error("No payment intent in charge.refunded event");
		return;
	}

	// LLM SDK: end-user wallet top-up refund. Reverse the credited amount
	// (clamped to the wallet's current balance) and write a reversal ledger row.
	const walletTopUp = await db.query.walletLedger.findFirst({
		where: {
			stripePaymentIntentId: { eq: payment_intent as string },
			type: { eq: "topup" },
		},
	});
	if (walletTopUp) {
		await handleEndUserTopUpRefunded(walletTopUp);
		return;
	}

	// In test (sandbox) mode only end-user top-up refunds are valid; never touch
	// live org refund state for a non-SDK sandbox charge.
	if (options.endUserOnly) {
		logger.info("Ignoring non-SDK test-mode charge.refunded", {
			paymentIntentId: payment_intent as string,
		});
		return;
	}

	const refundableTypes: (
		| "credit_topup"
		| "dev_plan_start"
		| "dev_plan_renewal"
		| "dev_plan_upgrade"
		| "chat_plan_start"
		| "chat_plan_renewal"
		| "chat_plan_upgrade"
		| "subscription_start"
	)[] = [
		"credit_topup",
		"dev_plan_start",
		"dev_plan_renewal",
		"dev_plan_upgrade",
		"chat_plan_start",
		"chat_plan_renewal",
		"chat_plan_upgrade",
		"subscription_start",
	];

	// Find the original transaction by stripePaymentIntentId first (covers
	// credit_topup and any row that recorded the payment intent).
	let originalTransaction = await db.query.transaction.findFirst({
		where: {
			stripePaymentIntentId: { eq: payment_intent as string },
			type: { in: refundableTypes },
		},
	});

	// Otherwise fall back to the invoice id: dev_plan_start (initial DevPass
	// setup-mode checkout) and invoice renewals record only the invoice id, not
	// the payment intent. Prefer the invoice link on the charge (present on older
	// API versions); current versions drop it, so resolve it from Stripe by
	// finding which of the customer's invoices this payment intent paid.
	let invoiceId: string | undefined;
	if (!originalTransaction) {
		const chargeInvoice = (
			charge as unknown as { invoice?: string | { id?: string } | null }
		).invoice;
		invoiceId =
			typeof chargeInvoice === "string"
				? chargeInvoice
				: (chargeInvoice?.id ?? undefined);
		if (!invoiceId) {
			invoiceId = await resolveRefundInvoiceId(payment_intent as string);
		}
		if (invoiceId) {
			originalTransaction = await db.query.transaction.findFirst({
				where: {
					stripeInvoiceId: { eq: invoiceId },
					type: { in: refundableTypes },
				},
			});
		}
	}

	if (!originalTransaction) {
		logger.error(
			`Original transaction not found for payment intent: ${payment_intent}${
				invoiceId ? ` (invoice: ${invoiceId})` : ""
			}`,
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
	const refundsResponse = await getStripe().refunds.list({
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

	// Use the latest refund's amount, not charge.amount_refunded, which is the
	// cumulative total refunded on the charge and over-counts on every refund
	// after the first.
	const refundAmountInDollars = latestRefund.amount / 100;
	const originalAmount = Number.parseFloat(originalTransaction.amount ?? "0");
	const originalCreditAmount = Number.parseFloat(
		originalTransaction.creditAmount ?? "0",
	);

	// Only credit_topup purchases add to organization.credits, so only those
	// refunds should deduct credits back. Dev plan, chat plan, and subscription
	// refunds are recorded for revenue reporting only — those plans use virtual
	// plan credits, and the subscription cancel/end webhooks handle the plan
	// state changes separately.
	const isCreditTopup = originalTransaction.type === "credit_topup";

	// Calculate proportional credit refund
	const refundRatio =
		originalAmount > 0 ? refundAmountInDollars / originalAmount : 0;
	const creditRefundAmount = isCreditTopup
		? originalCreditAmount * refundRatio
		: 0;

	// Dedupe by the Stripe refund id (unique per individual refund). Earlier
	// we keyed on amount, but charge.refunded retries on the same refund carry
	// the same amount as legitimate subsequent partial refunds, so amount is
	// not a reliable key.
	const existingRefund = await db.query.transaction.findFirst({
		where: {
			stripeRefundId: { eq: latestRefund.id },
			type: { eq: "credit_refund" },
		},
	});

	if (existingRefund) {
		logger.info(
			`Refund already processed for transaction ${originalTransaction.id} (refund ${latestRefund.id})`,
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
		stripeRefundId: latestRefund.id,
		relatedTransactionId: originalTransaction.id,
		refundReason: latestRefund.reason ?? null,
		description: `Credit refund: $${refundAmountInDollars.toFixed(2)} (${(refundRatio * 100).toFixed(1)}% of original purchase)`,
	});

	// Deduct credits from organization (allow negative) — only for credit_topup
	// refunds, since dev plan / subscription purchases don't add to credits.
	if (isCreditTopup && creditRefundAmount !== 0) {
		await db
			.update(tables.organization)
			.set({
				credits: sql`${tables.organization.credits} - ${creditRefundAmount}`,
			})
			.where(eq(tables.organization.id, originalTransaction.organizationId));
	}

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
		`Processed refund for organization ${originalTransaction.organizationId} ` +
			`(${originalTransaction.type}): refunded $${refundAmountInDollars}` +
			(isCreditTopup ? ` (${creditRefundAmount} credits deducted)` : ""),
	);
}

async function handleSetupIntentSucceeded(
	event: Stripe.SetupIntentSucceededEvent,
) {
	const setupIntent = event.data.object;
	const { metadata, payment_method } = setupIntent;
	const organizationId = metadata?.organizationId;

	// DevPass setup intents are finalized via finalizeDevPlanSetupSession (initial
	// activation) or /dev-plans/update-payment-method (card change) and must NOT
	// be saved into the org's payment_method table (which is for the regular
	// billing UI flow). Skip both ("dev_plan" and "dev_plan_update") here.
	if (metadata?.subscriptionType?.startsWith("dev_plan")) {
		return;
	}

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

	// Idempotent: skip if already saved (e.g. by confirm-setup endpoint)
	const alreadySaved = await db.query.paymentMethod.findFirst({
		where: { stripePaymentMethodId: paymentMethodId, organizationId },
	});
	if (alreadySaved) {
		return;
	}

	await getStripe().paymentMethods.attach(paymentMethodId, {
		customer: stripeCustomerId,
	});

	const paymentMethod =
		await getStripe().paymentMethods.retrieve(paymentMethodId);

	// Check for duplicate card by fingerprint
	if (paymentMethod.type === "card" && paymentMethod.card?.fingerprint) {
		const existingMethods = await db.query.paymentMethod.findMany({
			where: { organizationId },
		});

		for (const existing of existingMethods) {
			const stripeMethod = await getStripe().paymentMethods.retrieve(
				existing.stripePaymentMethodId,
			);
			if (stripeMethod.card?.fingerprint === paymentMethod.card.fingerprint) {
				logger.warn(
					`Duplicate card detected for organization ${organizationId}, detaching`,
				);
				await getStripe().paymentMethods.detach(paymentMethodId);
				return;
			}
		}
	}

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

export async function handleInvoicePaymentSucceeded(event: {
	data: { object: Stripe.Invoice };
}) {
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

	// Stripe fires both `checkout.session.completed` and
	// `invoice.payment_succeeded` for the FIRST invoice of every new
	// subscription. The checkout handler already inserts the
	// `dev_plan_start` (or `subscription_start`) row and does the
	// idempotent state setup, so re-running this handler for the same
	// invoice would double-insert (and inflate admin revenue reporting)
	// and also reset the just-set billing cycle. Bail out if a row for
	// this invoice already exists, regardless of type.
	if (invoice.id) {
		const existingForInvoice = await db.query.transaction.findFirst({
			where: { stripeInvoiceId: { eq: invoice.id } },
		});
		if (existingForInvoice) {
			logger.info(
				`Skipping invoice.payment_succeeded for ${invoice.id}: transaction ${existingForInvoice.id} (type=${existingForInvoice.type}) already recorded`,
			);
			return;
		}
	}

	const isChatPlanSubscription =
		organization.chatPlanStripeSubscriptionId === subscriptionId &&
		organization.chatPlan !== "none";

	const isDevPlanSubscription =
		organization.devPlanStripeSubscriptionId === subscriptionId &&
		organization.devPlan !== "none";
	let subscriptionMetadata: Stripe.Metadata | undefined;
	if (
		organization.devPlan === "none" &&
		organization.devPlanStripeSubscriptionId !== subscriptionId
	) {
		const stripeSubscription =
			await getStripe().subscriptions.retrieve(subscriptionId);
		subscriptionMetadata = stripeSubscription.metadata;
	}
	subscriptionMetadata ??= {};
	const initialDevPlanTier = subscriptionMetadata.devPlan as
		| DevPlanTier
		| undefined;
	const initialDevPlanCycle: DevPlanCycle =
		subscriptionMetadata.devPlanCycle === "annual" ? "annual" : "monthly";
	const isInitialDevPlanSubscription =
		subscriptionMetadata.subscriptionType === "dev_plan" &&
		!!initialDevPlanTier &&
		organization.devPlan === "none" &&
		organization.devPlanStripeSubscriptionId !== subscriptionId;

	// Stripe fires `invoice.payment_succeeded` both for true period renewals
	// (`subscription_cycle`) and for one-off invoices generated when a user
	// changes tier mid-cycle. Only a real cycle renewal should reset the credit
	// allotment. Treating an upgrade invoice as a renewal lets a user downgrade
	// then upgrade to repeatedly refresh a full fresh credit balance — so we
	// gate the credit reset on the billing reason.
	const isDevPlanRenewal =
		isDevPlanSubscription && invoice.billing_reason === "subscription_cycle";
	// A tier upgrade resets the billing cycle (`billing_cycle_anchor: "now"`) and
	// charges the full new-tier price, so Stripe emits its immediate invoice with
	// `billing_reason: "subscription_update"`.
	const isDevPlanUpgradeInvoice =
		isDevPlanSubscription && invoice.billing_reason === "subscription_update";

	// Same billing-reason gate as dev plans: only reset chat plan credits on a
	// true cycle renewal, not on mid-cycle tier-change proration invoices.
	const isChatPlanRenewal =
		isChatPlanSubscription && invoice.billing_reason === "subscription_cycle";
	// Mid-cycle chat plan tier change: the change-tier endpoint charges the
	// prorated upgrade with `always_invoice`, which Stripe bills as a
	// `subscription_update` invoice.
	const isChatPlanUpgradeInvoice =
		isChatPlanSubscription && invoice.billing_reason === "subscription_update";

	logger.info(
		`Found organization: ${organization.name} (${organization.id}), current plan: ${organization.plan}, billingReason: ${invoice.billing_reason}, isDevPlanRenewal: ${isDevPlanRenewal}, isChatPlanRenewal: ${isChatPlanRenewal}`,
	);

	if (isInitialDevPlanSubscription && initialDevPlanTier) {
		const creditsLimit = getDevPlanCreditsLimit(initialDevPlanTier);
		const fingerprint = await getSubscriptionCardFingerprint(subscriptionId);

		// First invoice line covers the initial period, so its end is the real
		// `current_period_end` (= first renewal date).
		const initialPeriodEnd = invoice.lines.data.reduce(
			(max, line) => Math.max(max, line.period?.end ?? 0),
			0,
		);

		const claimed = await db
			.update(tables.organization)
			.set({
				devPlan: initialDevPlanTier,
				devPlanCreditsLimit: creditsLimit.toString(),
				devPlanCreditsUsed: "0",
				devPlanBillingCycleStart: new Date(),
				devPlanExpiresAt: initialPeriodEnd
					? new Date(initialPeriodEnd * 1000)
					: undefined,
				devPlanStripeSubscriptionId: subscriptionId,
				devPlanCancelled: false,
				devPlanCycle: initialDevPlanCycle,
				devPlanCardFingerprint: fingerprint,
			})
			.where(
				and(
					eq(tables.organization.id, organizationId),
					isNull(tables.organization.devPlanStripeSubscriptionId),
				),
			)
			.returning({ id: tables.organization.id });

		if (claimed.length === 0) {
			logger.info(
				`Skipping initial DevPass invoice ${invoice.id}: subscription ${subscriptionId} was already activated`,
			);
			return;
		}

		const [transaction] = await db
			.insert(tables.transaction)
			.values({
				organizationId,
				type: "dev_plan_start",
				amount: (invoice.amount_paid / 100).toString(),
				creditAmount: creditsLimit.toString(),
				currency: invoice.currency.toUpperCase(),
				status: "completed",
				stripePaymentIntentId: (invoice as { payment_intent?: string | null })
					.payment_intent,
				stripeInvoiceId: invoice.id,
				description: `Dev Plan ${initialDevPlanTier.toUpperCase()} started via Stripe Checkout`,
			})
			.returning();

		try {
			const billingDetails = await resolveDevPassBillingDetails(organization);
			await generateAndEmailInvoice({
				organizationId: organization.id,
				invoiceNumber: transaction.id,
				invoiceDate: new Date(),
				organizationName: organization.name,
				...billingDetails,
				lineItems: [
					{
						description: `Dev Plan ${initialDevPlanTier.toUpperCase()} ($${creditsLimit} credits included)`,
						amount: invoice.amount_paid / 100,
					},
				],
				currency: invoice.currency.toUpperCase(),
			});
		} catch (e) {
			logger.error(
				"Invoice email failed (initial DevPass invoice); suppressing failure",
				e as Error,
			);
		}

		posthog.groupIdentify({
			groupType: "organization",
			groupKey: organizationId,
			properties: { name: organization.name },
		});
		posthog.capture({
			distinctId: "organization",
			event: "dev_plan_started",
			groups: { organization: organizationId },
			properties: {
				devPlan: initialDevPlanTier,
				creditsLimit,
				organization: organizationId,
				subscriptionId,
				source: "stripe_invoice",
			},
		});

		const subscribedEmail =
			subscriptionMetadata.userEmail || organization.billingEmail;
		if (subscribedEmail) {
			const subscribedUser = await db.query.user.findFirst({
				where: { email: { eq: subscribedEmail } },
			});
			await notifyDevPlanSubscribed(
				subscribedEmail,
				subscribedUser?.name,
				initialDevPlanTier,
				initialDevPlanCycle,
			);
		}

		logger.info(
			`Activated initial DevPass subscription ${subscriptionId} for organization ${organizationId} from invoice ${invoice.id}`,
		);
	} else if (isChatPlanRenewal) {
		const creditsLimit = getChatPlanCreditsLimit(
			organization.chatPlan as ChatPlanTier,
		);

		const [renewalTransaction] = await db
			.insert(tables.transaction)
			.values({
				organizationId,
				type: "chat_plan_renewal",
				amount: (invoice.amount_paid / 100).toString(),
				creditAmount: creditsLimit.toString(),
				currency: invoice.currency.toUpperCase(),
				status: "completed",
				stripePaymentIntentId: (invoice as any).payment_intent,
				stripeInvoiceId: invoice.id,
				description: `Chat Plan ${organization.chatPlan?.toUpperCase()} renewed`,
			})
			.returning();

		await db
			.update(tables.organization)
			.set({
				chatPlanCreditsUsed: "0",
				chatPlanBillingCycleStart: new Date(),
				chatPlanCancelled: false,
			})
			.where(eq(tables.organization.id, organizationId));

		logger.info(
			`Chat plan ${organization.chatPlan} renewed for organization ${organizationId}, credits reset to 0/${creditsLimit}`,
		);

		try {
			const billingDetails = await resolveChatPlanBillingDetails(organization);
			await generateAndEmailInvoice({
				organizationId: organization.id,
				invoiceNumber: renewalTransaction.id,
				invoiceDate: new Date(),
				organizationName: organization.name,
				...billingDetails,
				lineItems: [
					{
						description: `Chat Plan ${organization.chatPlan?.toUpperCase()} renewal ($${creditsLimit} credits included)`,
						amount: invoice.amount_paid / 100,
					},
				],
				currency: invoice.currency.toUpperCase(),
			});
		} catch (e) {
			logger.error(
				"Invoice email failed (chat plan renewal invoice); suppressing failure",
				e as Error,
			);
		}

		posthog.capture({
			distinctId: "organization",
			event: "chat_plan_renewed",
			groups: {
				organization: organizationId,
			},
			properties: {
				chatPlan: organization.chatPlan,
				creditsLimit: creditsLimit,
				organization: organizationId,
				source: "stripe_invoice",
			},
		});

		if (organization.billingEmail) {
			const renewedUser = await db.query.user.findFirst({
				where: { email: { eq: organization.billingEmail } },
			});
			await notifyChatPlanRenewed(
				organization.billingEmail,
				renewedUser?.name,
				organization.chatPlan ?? "unknown",
			);
		}
	} else if (isDevPlanRenewal) {
		// A scheduled downgrade takes effect now, at the renewal boundary: the
		// lower tier the user selected mid-cycle becomes the active plan for the
		// new period. When there's no pending downgrade this is just the current
		// tier. The credit allotment and the tier we persist below both follow
		// this effective tier.
		const effectiveTier = (organization.devPlanPendingTier ??
			organization.devPlan) as DevPlanTier;
		const creditsLimit = getDevPlanCreditsLimit(effectiveTier);

		// Create transaction record for dev plan renewal
		const [renewalTransaction] = await db
			.insert(tables.transaction)
			.values({
				organizationId,
				type: "dev_plan_renewal",
				amount: (invoice.amount_paid / 100).toString(),
				creditAmount: creditsLimit.toString(),
				currency: invoice.currency.toUpperCase(),
				status: "completed",
				stripePaymentIntentId: (invoice as any).payment_intent,
				stripeInvoiceId: invoice.id,
				description: `Dev Plan ${effectiveTier.toUpperCase()} renewed`,
			})
			.returning();

		try {
			const billingDetails = await resolveDevPassBillingDetails(organization);
			await generateAndEmailInvoice({
				organizationId: organization.id,
				invoiceNumber: renewalTransaction.id,
				invoiceDate: new Date(),
				organizationName: organization.name,
				...billingDetails,
				lineItems: [
					{
						description: `Dev Plan ${effectiveTier.toUpperCase()} renewal ($${creditsLimit} credits included)`,
						amount: invoice.amount_paid / 100,
					},
				],
				currency: invoice.currency.toUpperCase(),
			});
		} catch (e) {
			logger.error(
				"Invoice email failed (DevPass renewal invoice); suppressing failure",
				e as Error,
			);
		}

		// The renewal invoice's line items cover the upcoming period, so the
		// latest line period end is the new `current_period_end` (= next renewal
		// date). Record it alongside the cycle reset so the dashboard reflects the
		// new schedule immediately rather than waiting for the follow-up
		// `customer.subscription.updated` event.
		const renewedPeriodEnd = invoice.lines.data.reduce(
			(max, line) => Math.max(max, line.period?.end ?? 0),
			0,
		);

		// Reset credits used and update billing cycle start. Also reset the
		// limit to the full tier allotment: mid-cycle tier changes leave the
		// limit at a prorated value, and a fresh cycle should grant the tier's
		// full credits. Persist the effective tier and clear the pending
		// downgrade so a scheduled downgrade becomes the active plan now. Clear
		// any dunning freeze state since the limit is now authoritative again.
		await db
			.update(tables.organization)
			.set({
				devPlan: effectiveTier,
				devPlanPendingTier: null,
				devPlanCreditsLimit: creditsLimit.toString(),
				devPlanCreditsUsed: "0",
				devPlanPremiumCreditsUsed: "0",
				devPlanPremiumWeekStart: new Date(),
				devPlanCreditsFrozen: false,
				devPlanCreditsLimitBeforeFreeze: null,
				devPlanBillingCycleStart: new Date(),
				devPlanExpiresAt: renewedPeriodEnd
					? new Date(renewedPeriodEnd * 1000)
					: undefined,
				devPlanCancelled: false,
			})
			.where(eq(tables.organization.id, organizationId));

		logger.info(
			`Dev plan ${effectiveTier} renewed for organization ${organizationId}, credits reset to 0/${creditsLimit}`,
		);

		// Track dev plan renewal in PostHog
		posthog.capture({
			distinctId: "organization",
			event: "dev_plan_renewed",
			groups: {
				organization: organizationId,
			},
			properties: {
				devPlan: effectiveTier,
				creditsLimit: creditsLimit,
				organization: organizationId,
				source: "stripe_invoice",
			},
		});

		if (organization.billingEmail) {
			const renewedUser = await db.query.user.findFirst({
				where: { email: { eq: organization.billingEmail } },
			});
			await notifyDevPlanRenewed(
				organization.billingEmail,
				renewedUser?.name,
				effectiveTier,
			);
		}
	} else if (isDevPlanUpgradeInvoice) {
		// Immediate invoice from a tier upgrade. An upgrade resets the billing
		// cycle (`billing_cycle_anchor: "now"`) and charges the full new-tier
		// price, so Stripe emits this with `billing_reason: "subscription_update"`.
		// The change-tier endpoint normally resets org state, records the
		// transaction and emails the invoice synchronously (and the early-return
		// guard above then short-circuits this handler). This path is the fallback
		// if that process exited after Stripe collected payment but before the
		// local insert. It reproduces the same fresh-cycle reset, idempotently via
		// onConflictDoNothing on the unique stripeInvoiceId, reading the target
		// tier from the subscription metadata the update set.
		const upgradeSubscription =
			await getStripe().subscriptions.retrieve(subscriptionId);
		const toTier = (upgradeSubscription.metadata?.devPlan ??
			organization.devPlan) as DevPlanTier;
		const creditsLimit = getDevPlanCreditsLimit(toTier);

		// The invoice lines cover the new period, so the latest line end is the new
		// current_period_end (= next renewal date).
		const newPeriodEnd = invoice.lines.data.reduce(
			(max, line) => Math.max(max, line.period?.end ?? 0),
			0,
		);

		const upgradeTransaction = await db.transaction(async (tx) => {
			const [created] = await tx
				.insert(tables.transaction)
				.values({
					organizationId,
					type: "dev_plan_upgrade",
					amount: (invoice.amount_paid / 100).toString(),
					creditAmount: creditsLimit.toString(),
					currency: invoice.currency.toUpperCase(),
					status: "completed",
					stripePaymentIntentId: (invoice as any).payment_intent,
					stripeInvoiceId: invoice.id,
					description: `Dev Plan ${toTier.toUpperCase()} upgrade`,
				})
				.onConflictDoNothing()
				.returning();

			if (created) {
				// Fresh billing cycle: reset the limit to the new tier's full
				// allowance, zero out usage (including the premium weekly window),
				// advance the cycle start, clear any pending downgrade and dunning
				// freeze state, and persist the new period end as the renewal date.
				await tx
					.update(tables.organization)
					.set({
						devPlan: toTier,
						devPlanCreditsLimit: creditsLimit.toString(),
						devPlanCreditsUsed: "0",
						devPlanPremiumCreditsUsed: "0",
						devPlanPremiumWeekStart: new Date(),
						devPlanCreditsFrozen: false,
						devPlanCreditsLimitBeforeFreeze: null,
						devPlanBillingCycleStart: new Date(),
						devPlanExpiresAt: newPeriodEnd
							? new Date(newPeriodEnd * 1000)
							: undefined,
						devPlanPendingTier: null,
					})
					.where(eq(tables.organization.id, organizationId));
			}

			return created;
		});

		if (upgradeTransaction) {
			try {
				const billingDetails = await resolveDevPassBillingDetails(organization);
				await generateAndEmailInvoice({
					organizationId: organization.id,
					invoiceNumber: upgradeTransaction.id,
					invoiceDate: new Date(),
					organizationName: organization.name,
					...billingDetails,
					lineItems: [
						{
							description: `Dev Plan upgrade to ${toTier.toUpperCase()} ($${creditsLimit} credits included)`,
							amount: invoice.amount_paid / 100,
						},
					],
					currency: invoice.currency.toUpperCase(),
				});
			} catch (e) {
				logger.error(
					"Invoice email failed (DevPass upgrade invoice); suppressing failure",
					e as Error,
				);
			}

			logger.info(
				`Recorded dev plan upgrade invoice for organization ${organizationId}; reset to fresh ${toTier} cycle`,
			);
		} else {
			logger.info(
				`Dev plan upgrade transaction already exists for invoice ${invoice.id}; skipping duplicate insert/email`,
			);
		}
	} else if (isDevPlanSubscription) {
		// Any other dev-plan invoice (e.g. `manual`, or a `subscription_create`
		// that somehow wasn't deduped above). Leave credits untouched and do not
		// fall through to the Pro-subscription handler, which would wrongly flip
		// the org to the Pro plan.
		logger.info(
			`Skipping non-renewal dev plan invoice for organization ${organizationId} (billingReason: ${invoice.billing_reason})`,
		);
	} else if (isChatPlanUpgradeInvoice) {
		// Invoice from a mid-cycle chat plan upgrade. The change-tier endpoint
		// already applied the new tier/limit synchronously; this webhook records
		// the charge and emails the invoice. onConflictDoNothing on the unique
		// stripeInvoiceId index keeps it idempotent against Stripe retries, so the
		// row and email are produced at most once. Credits are left untouched — an
		// upgrade must not reset the cycle's usage.
		const creditsLimit = getChatPlanCreditsLimit(
			organization.chatPlan as ChatPlanTier,
		);
		const [upgradeTransaction] = await db
			.insert(tables.transaction)
			.values({
				organizationId,
				type: "chat_plan_upgrade",
				amount: (invoice.amount_paid / 100).toString(),
				creditAmount: creditsLimit.toString(),
				currency: invoice.currency.toUpperCase(),
				status: "completed",
				stripePaymentIntentId: (invoice as any).payment_intent,
				stripeInvoiceId: invoice.id,
				description: `Chat Plan ${organization.chatPlan?.toUpperCase()} upgrade`,
			})
			.onConflictDoNothing()
			.returning();

		if (upgradeTransaction) {
			try {
				const billingDetails =
					await resolveChatPlanBillingDetails(organization);
				await generateAndEmailInvoice({
					organizationId: organization.id,
					invoiceNumber: upgradeTransaction.id,
					invoiceDate: new Date(),
					organizationName: organization.name,
					...billingDetails,
					lineItems: [
						{
							description: `Chat Plan ${organization.chatPlan?.toUpperCase()} upgrade`,
							amount: invoice.amount_paid / 100,
						},
					],
					currency: invoice.currency.toUpperCase(),
				});
			} catch (e) {
				logger.error(
					"Invoice email failed (chat plan upgrade invoice); suppressing failure",
					e as Error,
				);
			}
			logger.info(
				`Recorded chat plan upgrade invoice for organization ${organizationId}; credits used left unchanged`,
			);
		} else {
			logger.info(
				`Chat plan upgrade transaction already exists for invoice ${invoice.id}; skipping duplicate insert/email`,
			);
		}
	} else if (isChatPlanSubscription) {
		// Any other chat-plan invoice (e.g. `manual`). Do not fall through to the
		// Pro-subscription handler, which would wrongly flip the org to the Pro
		// plan and email a Pro invoice.
		logger.info(
			`Skipping non-renewal chat plan invoice for organization ${organizationId} (billingReason: ${invoice.billing_reason})`,
		);
	} else {
		// Handle regular pro subscription
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

		// Update organization to pro tier and mark subscription as not cancelled
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
				`Successfully upgraded organization ${organizationId} to pro tier. Updated rows: ${result.length}`,
			);

			logger.info(
				`Verification - organization plan is now: ${result && result[0]?.plan}`,
			);

			// Generate and email invoice
			await generateAndEmailInvoice({
				organizationId: organization.id,
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
				`Error updating organization ${organizationId} to pro tier:`,
				error as Error,
			);
			throw error;
		}
	}
}

async function freezeDevPlanCredits(
	organizationId: string,
	organization: {
		devPlanCreditsUsed: string | null;
		devPlanCreditsLimit: string | null;
		devPlanCreditsFrozen: boolean | null;
	},
	reason: string,
) {
	// Cap the devPlan credit limit at what's already been used so the gateway's
	// `limit - used` balance check returns 0. Stops further dev-plan spend
	// without revoking the tier (so we don't lose the tier metadata before
	// dunning resolves one way or the other).
	//
	// Preserve the pre-freeze limit (only on the first freeze, so repeated
	// dunning events don't overwrite it with the frozen value) so recovery can
	// restore the exact limit — which may be a prorated mid-cycle amount rather
	// than the tier's full cap.
	if (organization.devPlanCreditsFrozen) {
		return;
	}
	const used = organization.devPlanCreditsUsed ?? "0";
	await db
		.update(tables.organization)
		.set({
			devPlanCreditsLimit: used,
			devPlanCreditsFrozen: true,
			devPlanCreditsLimitBeforeFreeze: organization.devPlanCreditsLimit ?? "0",
		})
		.where(eq(tables.organization.id, organizationId));

	logger.warn(
		`Froze dev plan credits for organization ${organizationId} (reason: ${reason}); credits limit set to ${used}`,
	);
}

async function restoreDevPlanCredits(
	organizationId: string,
	organization: {
		devPlan: DevPlanTier | "none" | null;
		devPlanCreditsFrozen: boolean | null;
		devPlanCreditsLimitBeforeFreeze: string | null;
	},
	reason: string,
) {
	// Counterpart to freezeDevPlanCredits: when the subscription returns to a
	// healthy state, restore the exact pre-freeze limit. Only acts on an
	// actually-frozen org — otherwise a routine `subscription.updated` (e.g.
	// the one Stripe emits for a mid-cycle tier change) would clobber an
	// intentional prorated limit with the tier's full cap and reopen the
	// credit-refresh loophole.
	if (!organization.devPlanCreditsFrozen) {
		return;
	}
	const restoredLimit =
		organization.devPlanCreditsLimitBeforeFreeze ??
		(organization.devPlan && organization.devPlan !== "none"
			? getDevPlanCreditsLimit(organization.devPlan).toString()
			: "0");
	await db
		.update(tables.organization)
		.set({
			devPlanCreditsLimit: restoredLimit,
			devPlanCreditsFrozen: false,
			devPlanCreditsLimitBeforeFreeze: null,
		})
		.where(eq(tables.organization.id, organizationId));

	logger.info(
		`Restored dev plan credits for organization ${organizationId} (reason: ${reason}); credits limit set to ${restoredLimit}`,
	);
}

async function freezeChatPlanCredits(
	organizationId: string,
	organization: { chatPlanCreditsUsed: string | null },
	reason: string,
) {
	// Mirror of freezeDevPlanCredits — caps the chat plan credit limit at
	// what's already been used so the gateway's `limit - used` balance check
	// returns 0 during dunning, without revoking the tier metadata.
	const used = organization.chatPlanCreditsUsed ?? "0";
	await db
		.update(tables.organization)
		.set({
			chatPlanCreditsLimit: used,
		})
		.where(eq(tables.organization.id, organizationId));

	logger.warn(
		`Froze chat plan credits for organization ${organizationId} (reason: ${reason}); credits limit set to ${used}`,
	);
}

async function restoreChatPlanCredits(
	organizationId: string,
	organization: {
		chatPlan: ChatPlanTier | "none" | null;
		chatPlanCreditsLimit: string | null;
	},
	reason: string,
) {
	if (!organization.chatPlan || organization.chatPlan === "none") {
		return;
	}
	const expectedLimit = getChatPlanCreditsLimit(organization.chatPlan);
	const currentLimit = parseFloat(organization.chatPlanCreditsLimit ?? "0");
	if (currentLimit >= expectedLimit) {
		return;
	}
	await db
		.update(tables.organization)
		.set({
			chatPlanCreditsLimit: expectedLimit.toString(),
		})
		.where(eq(tables.organization.id, organizationId));

	logger.info(
		`Restored chat plan credits for organization ${organizationId} (reason: ${reason}); credits limit raised from ${currentLimit} to ${expectedLimit}`,
	);
}

async function handleInvoicePaymentFailed(
	event: Stripe.InvoicePaymentFailedEvent,
) {
	const invoice = event.data.object;
	const { customer, metadata } = invoice;
	// Stripe v18 removed the top-level `Invoice.subscription` from the typed
	// surface. The subscription that produced this invoice now lives under
	// `invoice.parent.subscription_details`. Fall back to the per-line item
	// pointer for invoices created before this restructuring landed.
	const parentSubscription =
		invoice.parent?.subscription_details?.subscription ?? null;

	let subscriptionId: string | null | undefined =
		typeof parentSubscription === "string"
			? parentSubscription
			: parentSubscription?.id;
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

	if (!subscriptionId) {
		logger.info("Invoice payment failed but not for a subscription, skipping");
		return;
	}

	const result = await resolveOrganizationFromStripeEvent({
		metadata: metadata as { organizationId?: string } | undefined,
		customer: typeof customer === "string" ? customer : customer?.id,
		subscription: subscriptionId,
		lines: invoice.lines,
	});

	if (!result) {
		logger.error(
			`Organization not found for failed invoice (customer: ${customer}, subscription: ${subscriptionId})`,
		);
		return;
	}

	const { organizationId, organization } = result;

	const isChatPlan =
		organization.chatPlanStripeSubscriptionId === subscriptionId &&
		organization.chatPlan !== "none";
	const isDevPlan =
		organization.devPlanStripeSubscriptionId === subscriptionId &&
		organization.devPlan !== "none";

	if (!isDevPlan && !isChatPlan) {
		// Pro subscription failures are tracked via payment_intent.payment_failed
		// (with email throttling). Nothing extra to do here.
		return;
	}

	// Webhook delivery isn't guaranteed in order. Smart Retries can have
	// recovered the invoice (or the customer paid out-of-band) before this
	// event reaches us — in which case the subscription is already back to
	// active/trialing and we'd freeze a healthy account. Fetch the live
	// subscription state and only freeze on a confirmed failure status.
	let liveSubscription: Stripe.Subscription;
	try {
		liveSubscription = await getStripe().subscriptions.retrieve(subscriptionId);
	} catch (error) {
		logger.error(
			`Failed to retrieve subscription ${subscriptionId} for failed invoice ${invoice.id}`,
			error instanceof Error ? error : new Error(String(error)),
		);
		return;
	}

	const failureStatuses: Stripe.Subscription.Status[] = [
		"past_due",
		"unpaid",
		"incomplete",
		"incomplete_expired",
	];
	if (!failureStatuses.includes(liveSubscription.status)) {
		logger.info(
			`Skipping freeze for organization ${organizationId}: subscription ${subscriptionId} is ${liveSubscription.status} (invoice ${invoice.id})`,
		);
		return;
	}

	if (isChatPlan) {
		await freezeChatPlanCredits(
			organizationId,
			organization,
			`invoice.payment_failed (invoice ${invoice.id}, status ${liveSubscription.status})`,
		);
	} else {
		await freezeDevPlanCredits(
			organizationId,
			organization,
			`invoice.payment_failed (invoice ${invoice.id}, status ${liveSubscription.status})`,
		);
	}
}

export async function handleSubscriptionUpdated(
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

	// Check if this is a chat plan subscription
	const isChatPlan =
		metadata?.subscriptionType === "chat_plan" ||
		organization.chatPlanStripeSubscriptionId === subscription.id;

	// Check if this is a dev plan subscription
	const isDevPlan =
		metadata?.subscriptionType === "dev_plan" ||
		organization.devPlanStripeSubscriptionId === subscription.id;

	// A subscription event can target a *superseded* subscription — e.g. an
	// abandoned first checkout attempt whose payment never completed and that
	// Stripe later marks `incomplete_expired`. Its metadata still carries
	// `subscriptionType: dev_plan`/`chat_plan`, so the metadata-based detection
	// above would let that stale event mutate billing state (expiry/cancel flags)
	// and — far worse — `freezeDevPlanCredits` would pin the *active* plan's
	// credit limit to current usage, silently throttling a healthy subscriber.
	// Once the org has activated a specific subscription, only that subscription
	// may drive these changes. (handleInvoicePaymentFailed already gates isDevPlan
	// on this matching id; this mirrors it for subscription.updated.)
	if (
		isDevPlan &&
		organization.devPlanStripeSubscriptionId &&
		organization.devPlanStripeSubscriptionId !== subscription.id
	) {
		logger.info(
			`Ignoring stale dev-plan subscription.updated ${subscription.id} for org ${organizationId} (active sub: ${organization.devPlanStripeSubscriptionId}, status: ${subscription.status})`,
		);
		return;
	}
	if (
		isChatPlan &&
		organization.chatPlanStripeSubscriptionId &&
		organization.chatPlanStripeSubscriptionId !== subscription.id
	) {
		logger.info(
			`Ignoring stale chat-plan subscription.updated ${subscription.id} for org ${organizationId} (active sub: ${organization.chatPlanStripeSubscriptionId}, status: ${subscription.status})`,
		);
		return;
	}

	// Update plan expiration date
	const expiresAt = currentPeriodEnd
		? new Date(currentPeriodEnd * 1000)
		: undefined;

	// Check if subscription is active and organization was previously cancelled
	const isSubscriptionActive = !cancelAtPeriodEnd;

	if (isChatPlan) {
		const wasChatPlanCancelled = organization.chatPlanCancelled;

		if (!isSubscriptionActive && !wasChatPlanCancelled) {
			await db.insert(tables.transaction).values({
				organizationId,
				type: "chat_plan_cancel",
				currency: "USD",
				status: "completed",
				description: `Chat Plan ${organization.chatPlan?.toUpperCase()} cancelled`,
			});

			const cancelEmail =
				(metadata?.userEmail as string | undefined) ??
				organization.billingEmail;
			if (cancelEmail) {
				const cancelUser = await db.query.user.findFirst({
					where: { email: { eq: cancelEmail } },
				});
				await notifyChatPlanCancelled(
					cancelEmail,
					cancelUser?.name,
					organization.chatPlan ?? "unknown",
				);
			}
		}

		await db
			.update(tables.organization)
			.set({
				chatPlanExpiresAt: expiresAt,
				chatPlanCancelled: !isSubscriptionActive,
			})
			.where(eq(tables.organization.id, organizationId));

		const nonActiveStatuses: Stripe.Subscription.Status[] = [
			"past_due",
			"unpaid",
			"incomplete",
			"incomplete_expired",
		];
		if (nonActiveStatuses.includes(subscription.status)) {
			await freezeChatPlanCredits(
				organizationId,
				organization,
				`subscription.updated status=${subscription.status}`,
			);
		} else if (
			subscription.status === "active" ||
			subscription.status === "trialing"
		) {
			await restoreChatPlanCredits(
				organizationId,
				organization,
				`subscription.updated status=${subscription.status}`,
			);
		}

		if (isSubscriptionActive && wasChatPlanCancelled) {
			posthog.capture({
				distinctId: "organization",
				event: "chat_plan_reactivated",
				groups: {
					organization: organizationId,
				},
				properties: {
					chatPlan: organization.chatPlan,
					organization: organizationId,
					source: "stripe_subscription_updated",
				},
			});
			logger.info(
				`Reactivated chat plan subscription for organization ${organizationId}`,
			);
		}

		logger.info(
			`Updated chat plan subscription for organization ${organizationId}, expires at: ${expiresAt}, cancelled: ${!isSubscriptionActive}`,
		);
	} else if (isDevPlan) {
		// Handle dev plan subscription update
		const wasDevPlanCancelled = organization.devPlanCancelled;

		// Create transaction record for dev plan cancellation if it was cancelled
		if (!isSubscriptionActive && !wasDevPlanCancelled) {
			await db.insert(tables.transaction).values({
				organizationId,
				type: "dev_plan_cancel",
				currency: "USD",
				status: "completed",
				description: `Dev Plan ${organization.devPlan?.toUpperCase()} cancelled`,
			});

			if (organization.billingEmail) {
				await sendTransactionalEmail({
					to: organization.billingEmail,
					organizationId: organization.id,
					subject: "Before you go — could we get your feedback?",
					html: generateDevPlanCancellationFeedbackEmailHtml(),
				});

				logger.info(
					`Sent dev plan cancellation feedback email to ${organization.billingEmail} for organization ${organizationId}`,
				);
			}

			const cancelEmail =
				(metadata?.userEmail as string | undefined) ??
				organization.billingEmail;
			if (cancelEmail) {
				const cancelUser = await db.query.user.findFirst({
					where: { email: { eq: cancelEmail } },
				});
				await notifyDevPlanCancelled(
					cancelEmail,
					cancelUser?.name,
					organization.devPlan ?? "unknown",
				);
			}
		}

		await db
			.update(tables.organization)
			.set({
				devPlanExpiresAt: expiresAt,
				devPlanCancelled: !isSubscriptionActive,
			})
			.where(eq(tables.organization.id, organizationId));

		// If Stripe is reporting the subscription as past_due / unpaid /
		// incomplete, freeze further dev-plan spend. Without this, customers
		// keep burning credits during dunning (or after a failed mid-cycle
		// upgrade) while we never collect the invoice.
		const nonActiveStatuses: Stripe.Subscription.Status[] = [
			"past_due",
			"unpaid",
			"incomplete",
			"incomplete_expired",
		];
		if (nonActiveStatuses.includes(subscription.status)) {
			await freezeDevPlanCredits(
				organizationId,
				organization,
				`subscription.updated status=${subscription.status}`,
			);
		} else if (
			subscription.status === "active" ||
			subscription.status === "trialing"
		) {
			// Recover from a previous freeze (e.g. dunning resolved). No-op when
			// the limit is already at or above the tier's expected cap.
			await restoreDevPlanCredits(
				organizationId,
				organization,
				`subscription.updated status=${subscription.status}`,
			);
		}

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
		// Handle regular pro subscription update
		const wasSubscriptionCancelled = organization.subscriptionCancelled;

		// Create transaction record for subscription cancellation if it was cancelled
		if (!isSubscriptionActive && !wasSubscriptionCancelled) {
			await db.insert(tables.transaction).values({
				organizationId,
				type: "subscription_cancel",
				currency: "USD",
				status: "completed",
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

export async function handleSubscriptionDeleted(
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

	// Check if this is a chat plan subscription
	const isChatPlan =
		metadata?.subscriptionType === "chat_plan" ||
		organization.chatPlanStripeSubscriptionId === subscription.id;

	// Check if this is a dev plan subscription
	const isDevPlan =
		metadata?.subscriptionType === "dev_plan" ||
		organization.devPlanStripeSubscriptionId === subscription.id;

	// A deletion event can target a *superseded* subscription — e.g. the user
	// cancelled at period end, then started a NEW plan before the old one's
	// period actually elapsed. The old subscription's metadata still carries
	// `subscriptionType: dev_plan`/`chat_plan`, so the metadata-based detection
	// above would let its deletion wipe the org's fresh plan (tier, credits,
	// subscription id) hours after the new checkout completed. Once the org has
	// activated a different subscription, its deletion events must be ignored.
	// (handleSubscriptionUpdated applies the same guard.)
	if (
		isDevPlan &&
		organization.devPlanStripeSubscriptionId &&
		organization.devPlanStripeSubscriptionId !== subscription.id
	) {
		logger.info(
			`Ignoring stale dev-plan subscription.deleted ${subscription.id} for org ${organizationId} (active sub: ${organization.devPlanStripeSubscriptionId})`,
		);
		return;
	}
	if (
		isChatPlan &&
		organization.chatPlanStripeSubscriptionId &&
		organization.chatPlanStripeSubscriptionId !== subscription.id
	) {
		logger.info(
			`Ignoring stale chat-plan subscription.deleted ${subscription.id} for org ${organizationId} (active sub: ${organization.chatPlanStripeSubscriptionId})`,
		);
		return;
	}
	if (
		!isDevPlan &&
		!isChatPlan &&
		organization.stripeSubscriptionId &&
		organization.stripeSubscriptionId !== subscription.id
	) {
		logger.info(
			`Ignoring stale subscription.deleted ${subscription.id} for org ${organizationId} (active sub: ${organization.stripeSubscriptionId})`,
		);
		return;
	}

	if (isChatPlan) {
		const previousChatPlan = organization.chatPlan;

		await db.insert(tables.transaction).values({
			organizationId,
			type: "chat_plan_end",
			currency: "USD",
			status: "completed",
			description: `Chat Plan ${previousChatPlan?.toUpperCase()} ended`,
		});

		await db
			.update(tables.organization)
			.set({
				chatPlan: "none",
				chatPlanCreditsLimit: "0",
				chatPlanCreditsUsed: "0",
				chatPlanStripeSubscriptionId: null,
				chatPlanExpiresAt: null,
				chatPlanCancelled: false,
				chatPlanBillingCycleStart: null,
				// Release the card so the dedupe query no longer matches this
				// ended org and the same card can claim a new chat plan.
				chatPlanCardFingerprint: null,
			})
			.where(eq(tables.organization.id, organizationId));

		await sendTransactionalEmail({
			to: organization.billingEmail,
			organizationId: organization.id,
			subject: "Your LLMGateway Chat Plan Has Been Cancelled",
			html: generateSubscriptionCancelledEmailHtml(organization.name),
		});

		logger.info(
			`Sent chat plan cancelled email to ${organization.billingEmail} for organization ${organizationId}`,
		);

		posthog.capture({
			distinctId: "organization",
			event: "chat_plan_ended",
			groups: {
				organization: organizationId,
			},
			properties: {
				previousChatPlan: previousChatPlan,
				organization: organizationId,
				source: "stripe_subscription_deleted",
			},
		});

		logger.info(
			`Ended chat plan ${previousChatPlan} for organization ${organizationId}`,
		);
	} else if (isDevPlan) {
		// Handle dev plan subscription deletion
		const previousDevPlan = organization.devPlan;

		// Create transaction record for dev plan end
		await db.insert(tables.transaction).values({
			organizationId,
			type: "dev_plan_end",
			currency: "USD",
			status: "completed",
			description: `Dev Plan ${previousDevPlan?.toUpperCase()} ended`,
		});

		// Reset dev plan fields
		await db
			.update(tables.organization)
			.set({
				devPlan: "none",
				devPlanPendingTier: null,
				devPlanCreditsLimit: "0",
				devPlanCreditsUsed: "0",
				devPlanPremiumCreditsUsed: "0",
				devPlanPremiumWeekStart: null,
				devPlanCreditsFrozen: false,
				devPlanCreditsLimitBeforeFreeze: null,
				devPlanStripeSubscriptionId: null,
				devPlanExpiresAt: null,
				devPlanCancelled: false,
				devPlanBillingCycleStart: null,
			})
			.where(eq(tables.organization.id, organizationId));

		// Send dev plan cancelled email
		await sendTransactionalEmail({
			to: organization.billingEmail,
			organizationId: organization.id,
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
		// Handle regular pro subscription deletion
		// Create transaction record for subscription end
		await db.insert(tables.transaction).values({
			organizationId,
			type: "subscription_end",
			currency: "USD",
			status: "completed",
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
			organizationId: organization.id,
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

	// DevPass/Chat subscriptions use the devPlan/chatPlan fields — they must
	// not be coerced to plan="pro" or have stripeSubscriptionId set, which is
	// reserved for regular Pro subscriptions on team orgs.
	if (
		metadata?.subscriptionType === "dev_plan" ||
		metadata?.subscriptionType === "chat_plan" ||
		organization.kind !== "default"
	) {
		logger.info(
			`Skipping plan: "pro" for dev/chat plan or ${organization.kind} org ${organizationId}`,
		);
		return;
	}

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
