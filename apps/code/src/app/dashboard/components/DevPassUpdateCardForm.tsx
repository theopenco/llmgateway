"use client";

import {
	CardElement,
	Elements,
	useElements,
	useStripe as useStripeElements,
} from "@stripe/react-stripe-js";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/fetch-client";
import { useStripe } from "@/lib/stripe";

import type React from "react";

// Loaded via next/dynamic from DevPassPaymentMethod so the Stripe React
// bindings stay out of the billing page chunk until the form is opened.
export default function UpdateCardForm({
	onCancel,
	onSuccess,
}: {
	onCancel: () => void;
	onSuccess: () => void;
}) {
	const { stripe, isLoading: stripeLoading } = useStripe();

	if (stripeLoading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				Loading payment form…
			</div>
		);
	}

	return (
		<Elements stripe={stripe}>
			<UpdateCardFormInner onCancel={onCancel} onSuccess={onSuccess} />
		</Elements>
	);
}

function UpdateCardFormInner({
	onCancel,
	onSuccess,
}: {
	onCancel: () => void;
	onSuccess: () => void;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const stripe = useStripeElements();
	const elements = useElements();
	const [loading, setLoading] = useState(false);

	const paymentMethodQueryKey = api.queryOptions(
		"get",
		"/dev-plans/payment-method",
	).queryKey;

	const { mutateAsync: createSetupIntent } = api.useMutation(
		"post",
		"/dev-plans/create-setup-intent",
	);
	const { mutateAsync: updatePaymentMethod } = api.useMutation(
		"post",
		"/dev-plans/update-payment-method",
	);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!stripe || !elements) {
			return;
		}

		const cardElement = elements.getElement(CardElement);
		if (!cardElement) {
			return;
		}

		setLoading(true);

		try {
			const { clientSecret } = await createSetupIntent({});

			const result = await stripe.confirmCardSetup(clientSecret, {
				payment_method: { card: cardElement },
			});

			if (result.error) {
				toast.error(result.error.message ?? "Failed to confirm card");
				return;
			}

			const newPmId =
				typeof result.setupIntent?.payment_method === "string"
					? result.setupIntent.payment_method
					: result.setupIntent?.payment_method?.id;

			if (!newPmId) {
				toast.error("Failed to confirm card");
				return;
			}

			const { renewalPayment } = await updatePaymentMethod({
				body: { paymentMethodId: newPmId },
			});

			await queryClient.invalidateQueries({ queryKey: paymentMethodQueryKey });

			if (renewalPayment.status === "failed") {
				toast.error("Card saved, but renewal payment failed", {
					description: renewalPayment.message,
				});
				return;
			}
			let renewalPaid = renewalPayment.status === "paid";
			if (renewalPayment.status === "requires_action") {
				const confirmation = await stripe.confirmCardPayment(
					renewalPayment.clientSecret,
				);
				if (confirmation.error) {
					toast.error("Card saved, but renewal payment needs confirmation", {
						description: confirmation.error.message,
					});
					return;
				}
				renewalPaid = confirmation.paymentIntent.status === "succeeded";
			}
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/dev-plans/status").queryKey,
			});
			toast.success(
				renewalPaid
					? "Card updated and renewal paid"
					: renewalPayment.status === "not_needed"
						? "Payment method updated"
						: "Card saved, renewal payment processing",
			);
			onSuccess();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to update card";
			// The update endpoint returns 409 for a card already linked to another
			// DevPass account — surface its message when present.
			const detail =
				typeof error === "object" &&
				error !== null &&
				"message" in error &&
				typeof (error as { message?: unknown }).message === "string"
					? (error as { message: string }).message
					: message;
			toast.error(detail);
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Saving your card also retries any failed renewal payment.
			</p>
			<div className="rounded-md border bg-background p-3">
				<CardElement
					options={{
						style: {
							base: {
								fontSize: "16px",
								color: "#424770",
								"::placeholder": { color: "#aab7c4" },
							},
							invalid: { color: "#9e2146" },
						},
					}}
				/>
			</div>
			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onCancel}
					disabled={loading}
				>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={!stripe || loading}>
					{loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
					Save card
				</Button>
			</div>
		</form>
	);
}
