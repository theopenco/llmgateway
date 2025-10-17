"use client";

import {
	CardElement,
	Elements,
	useElements,
	useStripe as useStripeElements,
} from "@stripe/react-stripe-js";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Trash2, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { useStripe } from "@/lib/stripe";

import type React from "react";

export function PaymentMethodsManagement() {
	const queryClient = useQueryClient();
	const api = useApi();

	// Use regular query instead of suspense query to prevent infinite re-rendering
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/payments/payment-methods",
	);

	// Generate query key once and reuse it
	const paymentMethodsQueryKey = api.queryOptions(
		"get",
		"/payments/payment-methods",
	).queryKey;

	const { mutate: setDefaultMutation, isPending: isDefaultMethodPending } =
		api.useMutation("post", "/payments/payment-methods/default");
	const { mutate: deleteMutation, isPending: isDeletePending } =
		api.useMutation("delete", "/payments/payment-methods/{id}");

	const paymentMethods = data?.paymentMethods || [];

	// Handle loading state
	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="text-center p-4">
					<p className="text-muted-foreground">Loading payment methods...</p>
				</div>
			</div>
		);
	}

	// Handle error state
	if (error) {
		return (
			<div className="space-y-4">
				<div className="text-center p-4">
					<p className="text-destructive">Failed to load payment methods</p>
				</div>
			</div>
		);
	}

	const handleSetDefault = async (paymentMethodId: string) => {
		setDefaultMutation(
			{ body: { paymentMethodId } },
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: paymentMethodsQueryKey });

					toast({
						title: "Success",
						description: "Default payment method updated",
					});
				},
				onError: (error: any) => {
					const errorMessage =
						error?.error?.message ||
						error?.message ||
						(error instanceof Error ? error.message : "An error occurred");
					toast({
						title: "Error",
						description: errorMessage,
						variant: "destructive",
					});
				},
			},
		);
	};

	const handleDelete = async (paymentMethodId: string) => {
		if (!confirm("Are you sure you want to delete this payment method?")) {
			return;
		}

		deleteMutation(
			{
				params: {
					path: {
						id: paymentMethodId,
					},
				},
			},
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: paymentMethodsQueryKey });

					toast({
						title: "Success",
						description: "Payment method deleted",
					});
				},
				onError: (error: any) => {
					const errorMessage =
						error?.error?.message ||
						error?.message ||
						(error instanceof Error ? error.message : "An error occurred");
					toast({
						title: "Error",
						description: errorMessage,
						variant: "destructive",
					});
				},
			},
		);
	};

	return (
		<div className="space-y-4">
			{paymentMethods.length === 0 ? (
				<div className="text-center p-4">
					<p className="text-muted-foreground">No payment methods added yet.</p>
				</div>
			) : (
				<div className="grid gap-4">
					{paymentMethods.map((method) => (
						<div
							key={method.id}
							className="flex items-center justify-between p-4 border rounded-lg"
						>
							<div className="flex items-center gap-3">
								<CreditCard className="h-5 w-5" />
								<div>
									<p>
										{method.cardBrand} •••• {method.cardLast4}
									</p>
									<p className="text-sm text-muted-foreground">
										Expires {method.expiryMonth}/{method.expiryYear}
									</p>
								</div>
								{method.isDefault && (
									<span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
										Default
									</span>
								)}
							</div>
							<div className="flex gap-2">
								{!method.isDefault && (
									<Button
										variant="outline"
										size="sm"
										onClick={() => handleSetDefault(method.id)}
										disabled={isDefaultMethodPending}
										type="button"
									>
										Set Default
									</Button>
								)}
								<Button
									variant="outline"
									size="sm"
									onClick={() => handleDelete(method.id)}
									disabled={isDeletePending}
									type="button"
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							</div>
						</div>
					))}
				</div>
			)}
			<AddPaymentMethodDialog />
		</div>
	);
}

function AddPaymentMethodDialog() {
	const [open, setOpen] = useState(false);
	const { stripe, isLoading: stripeLoading } = useStripe();

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<Plus className="mr-2 h-4 w-4" />
					Add Payment Method
				</Button>
			</DialogTrigger>
			<DialogContent>
				{stripeLoading ? (
					<div className="p-6 text-center">Loading payment form...</div>
				) : (
					<Elements stripe={stripe}>
						<AddPaymentMethodForm onSuccess={() => setOpen(false)} />
					</Elements>
				)}
			</DialogContent>
		</Dialog>
	);
}

function AddPaymentMethodForm({ onSuccess }: { onSuccess: () => void }) {
	const queryClient = useQueryClient();
	const stripe = useStripeElements();
	const elements = useElements();
	const [loading, setLoading] = useState(false);
	const api = useApi();

	// Generate query key once and reuse it
	const paymentMethodsQueryKey = api.queryOptions(
		"get",
		"/payments/payment-methods",
	).queryKey;

	const { mutateAsync: setupIntentMutation } = api.useMutation(
		"post",
		"/payments/create-setup-intent",
	);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!stripe || !elements) {
			return;
		}

		setLoading(true);

		try {
			const { clientSecret } = await setupIntentMutation({});

			const result = await stripe.confirmCardSetup(clientSecret, {
				payment_method: {
					card: elements.getElement(CardElement)!,
				},
			});

			if (result.error) {
				toast({
					title: "Error",
					description: result.error.message,
					variant: "destructive",
				});
			} else {
				await queryClient.invalidateQueries({
					queryKey: paymentMethodsQueryKey,
				});
				toast({
					title: "Success",
					description: "Payment method added successfully",
				});
				onSuccess();
			}
		} catch (error) {
			toast({
				title: "Error",
				description:
					error instanceof Error ? error.message : "An error occurred",
				variant: "destructive",
			});
		} finally {
			setLoading(false);
		}
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>Add Payment Method</DialogTitle>
				<DialogDescription>
					Add a new card to your account for faster checkout.
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={handleSubmit}>
				<div className="space-y-4 py-4">
					<div className="border rounded-md p-3">
						<CardElement
							options={{
								style: {
									base: {
										fontSize: "16px",
										color: "#424770",
										"::placeholder": {
											color: "#aab7c4",
										},
									},
									invalid: {
										color: "#9e2146",
									},
								},
							}}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button type="submit" disabled={!stripe || loading}>
						{loading ? "Adding..." : "Add Payment Method"}
					</Button>
				</DialogFooter>
			</form>
		</>
	);
}
