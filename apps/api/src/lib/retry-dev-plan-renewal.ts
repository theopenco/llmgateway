import { z } from "zod";

import { getStripeCardErrorMessage } from "@/lib/stripe-card-error.js";
import { getStripe } from "@/routes/payments.js";
import { getSubscriptionPaymentConfirmation } from "@/stripe.js";

import { logger } from "@llmgateway/logger";

import type Stripe from "stripe";

export const renewalPaymentResultSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("not_needed") }),
	z.object({ status: z.literal("paid") }),
	z.object({ status: z.literal("processing") }),
	z.object({
		status: z.literal("requires_action"),
		clientSecret: z.string(),
	}),
	z.object({ status: z.literal("failed"), message: z.string() }),
]);

export async function retryDevPlanRenewal(
	subscription: Stripe.Subscription,
	paymentMethodId: string,
): Promise<z.infer<typeof renewalPaymentResultSchema>> {
	if (
		!["active", "past_due", "unpaid"].includes(subscription.status) ||
		!subscription.latest_invoice
	) {
		return { status: "not_needed" };
	}

	const stripe = getStripe();
	const invoiceId =
		typeof subscription.latest_invoice === "string"
			? subscription.latest_invoice
			: subscription.latest_invoice.id;
	if (!invoiceId) {
		return { status: "not_needed" };
	}
	let invoice = await stripe.invoices.retrieve(invoiceId);
	if (
		invoice.status !== "open" ||
		!invoice.attempted ||
		invoice.billing_reason !== "subscription_cycle"
	) {
		return { status: "not_needed" };
	}

	let failureMessage: string | undefined;
	try {
		invoice = await stripe.invoices.pay(
			invoiceId,
			{ payment_method: paymentMethodId, off_session: false },
			{ idempotencyKey: `dev-plan-renewal:${invoice.id}:${paymentMethodId}` },
		);
	} catch (error) {
		failureMessage = getStripeCardErrorMessage(error);
		const alreadyPaid =
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "invoice_already_paid";
		if (!failureMessage && !alreadyPaid) {
			throw error;
		}
		invoice = await stripe.invoices.retrieve(invoiceId);
	}

	if (invoice.status === "paid") {
		return { status: "paid" };
	}

	const { paymentIntent, clientSecret } =
		await getSubscriptionPaymentConfirmation({
			...subscription,
			latest_invoice: invoice,
		});
	if (paymentIntent?.status === "requires_action" && clientSecret) {
		return { status: "requires_action", clientSecret };
	}
	if (failureMessage) {
		logger.warn("DevPass renewal retry declined after card update", {
			subscriptionId: subscription.id,
			invoiceId,
		});
		return { status: "failed", message: failureMessage };
	}
	return { status: "processing" };
}
