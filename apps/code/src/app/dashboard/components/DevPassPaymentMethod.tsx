"use client";

import {
	CardElement,
	Elements,
	useElements,
	useStripe as useStripeElements,
} from "@stripe/react-stripe-js";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/fetch-client";
import { useStripe } from "@/lib/stripe";

import type { paths } from "@/lib/api/v1";
import type React from "react";

type PaymentMethod =
	paths["/dev-plans/payment-method"]["get"]["responses"]["200"]["content"]["application/json"];

export default function DevPassPaymentMethod({
	initialData,
	allowAdd = true,
}: {
	initialData?: PaymentMethod | null;
	allowAdd?: boolean;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const removeMutation = api.useMutation("delete", "/dev-plans/payment-method");
	const paymentMethodQueryKey = api.queryOptions(
		"get",
		"/dev-plans/payment-method",
	).queryKey;

	const { data, isLoading } = api.useQuery(
		"get",
		"/dev-plans/payment-method",
		{},
		{ initialData: initialData ?? undefined },
	);
	const card = data?.card ?? null;
	const canRemove = data?.canRemove ?? false;

	const handleRemove = async () => {
		try {
			await removeMutation.mutateAsync({});
			await queryClient.invalidateQueries({ queryKey: paymentMethodQueryKey });
			toast.success("Payment method removed", {
				description: "Your card details were removed from Stripe.",
			});
		} catch (error) {
			const description =
				typeof error === "object" &&
				error !== null &&
				"message" in error &&
				typeof (error as { message?: unknown }).message === "string"
					? (error as { message: string }).message
					: "Try again or contact support if the problem continues.";
			toast.error("Could not remove payment method", { description });
		}
	};

	if (!isLoading && !card && !allowAdd) {
		return null;
	}

	return (
		<div className="rounded-xl border bg-card p-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 className="font-semibold">Payment method</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						The card used for your DevPass subscription.
					</p>
				</div>
				{!editing ? (
					<div className="flex flex-wrap items-center gap-2">
						{card && canRemove ? (
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										className="text-destructive hover:text-destructive"
										disabled={removeMutation.isPending}
									>
										{removeMutation.isPending ? (
											<Loader2 className="animate-spin" />
										) : (
											<Trash2 />
										)}
										Remove card
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Remove payment method?</AlertDialogTitle>
										<AlertDialogDescription>
											The card details will be removed from Stripe. Your plan
											stays available until its scheduled end, but it cannot
											renew and card-funded purchases will be unavailable. The
											card fingerprint stays linked to this account to prevent
											duplicate DevPass claims.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Keep card</AlertDialogCancel>
										<AlertDialogAction
											onClick={handleRemove}
											className={buttonVariants({ variant: "destructive" })}
										>
											Remove card
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						) : null}
						{allowAdd ? (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setEditing(true)}
								disabled={removeMutation.isPending}
							>
								{card ? "Update card" : "Add card"}
							</Button>
						) : null}
					</div>
				) : null}
			</div>

			<div className="mt-5">
				{isLoading ? (
					<div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3.5">
						<Skeleton className="h-5 w-5 rounded" />
						<div className="space-y-1.5">
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-3 w-24" />
						</div>
					</div>
				) : editing ? (
					<UpdateCardForm
						onCancel={() => setEditing(false)}
						onSuccess={() => setEditing(false)}
					/>
				) : card ? (
					<div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3.5">
						<CreditCard className="h-5 w-5 text-muted-foreground" />
						<div>
							<p className="text-sm font-medium capitalize">
								{card.brand} •••• {card.last4}
							</p>
							<p className="text-xs text-muted-foreground">
								Expires {String(card.expiryMonth).padStart(2, "0")}/
								{card.expiryYear}
							</p>
						</div>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						No card on file for this subscription.
					</p>
				)}
			</div>
		</div>
	);
}

function UpdateCardForm({
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
