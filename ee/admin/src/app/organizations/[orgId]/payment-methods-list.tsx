"use client";

import { CreditCard, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

export interface AdminPaymentMethod {
	id: string;
	type: string;
	createdAt: string;
	card: {
		brand: string;
		last4: string;
		expiryMonth: number;
		expiryYear: number;
	} | null;
}

interface DeletePaymentMethodDialogProps {
	paymentMethod: AdminPaymentMethod;
	onDelete: (
		paymentMethodId: string,
	) => Promise<{ success: boolean; error?: string }>;
}

function formatBrand(brand: string) {
	return brand
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function paymentMethodLabel(paymentMethod: AdminPaymentMethod) {
	if (!paymentMethod.card) {
		return paymentMethod.type.replaceAll("_", " ");
	}
	return `${formatBrand(paymentMethod.card.brand)} ending in ${paymentMethod.card.last4}`;
}

function DeletePaymentMethodDialog({
	paymentMethod,
	onDelete,
}: DeletePaymentMethodDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const label = paymentMethodLabel(paymentMethod);

	const handleDelete = async () => {
		setLoading(true);
		setError(null);

		try {
			const result = await onDelete(paymentMethod.id);
			if (!result.success) {
				setError(result.error ?? "Failed to delete payment method");
				return;
			}

			setOpen(false);
			router.refresh();
		} catch (deleteError) {
			setError(
				deleteError instanceof Error
					? deleteError.message
					: "Failed to delete payment method",
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (loading) {
					return;
				}
				setOpen(nextOpen);
				if (!nextOpen) {
					setError(null);
				}
			}}
		>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="text-destructive hover:text-destructive"
					aria-label={`Delete ${label}`}
				>
					<Trash2 className="h-4 w-4" />
					Delete
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete {label}?</DialogTitle>
					<DialogDescription>
						This detaches the payment method from the Stripe customer and
						removes its local saved-method reference. Charges, renewals, and
						automatic top-ups using this method will fail until another method
						is selected. This action cannot be undone.
					</DialogDescription>
				</DialogHeader>

				{error ? (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				) : null}

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => setOpen(false)}
						disabled={loading}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={handleDelete}
						disabled={loading}
					>
						{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
						Delete payment method
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function PaymentMethodsList({
	paymentMethods,
	loadError,
	onDelete,
}: {
	paymentMethods: AdminPaymentMethod[] | null;
	loadError: boolean;
	onDelete: (
		paymentMethodId: string,
	) => Promise<{ success: boolean; error?: string }>;
}) {
	const router = useRouter();

	return (
		<section className="space-y-3 border-t pt-6 md:col-span-2">
			<div>
				<h3 className="text-sm font-medium">Payment methods</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					Cards attached to the Stripe customer. Card details live in Stripe;
					standard top-up links are also tracked locally.
				</p>
			</div>

			{loadError ? (
				<div className="flex flex-col items-start gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-destructive" role="alert">
						Payment methods could not be loaded from Stripe.
					</p>
					<Button variant="outline" size="sm" onClick={() => router.refresh()}>
						<RefreshCw className="h-4 w-4" />
						Try again
					</Button>
				</div>
			) : paymentMethods?.length ? (
				<div className="divide-y border-y">
					{paymentMethods.map((paymentMethod) => {
						const label = paymentMethodLabel(paymentMethod);
						return (
							<div
								key={paymentMethod.id}
								className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"
							>
								<CreditCard className="h-5 w-5 shrink-0 text-muted-foreground" />
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium">{label}</p>
									<p className="mt-1 break-all font-mono text-xs text-muted-foreground">
										{paymentMethod.card
											? `Expires ${String(paymentMethod.card.expiryMonth).padStart(2, "0")}/${String(paymentMethod.card.expiryYear).slice(-2)} · `
											: ""}
										{paymentMethod.id}
									</p>
								</div>
								<DeletePaymentMethodDialog
									paymentMethod={paymentMethod}
									onDelete={onDelete}
								/>
							</div>
						);
					})}
				</div>
			) : (
				<p className="py-3 text-sm text-muted-foreground">
					No payment methods are attached to this Stripe customer.
				</p>
			)}
		</section>
	);
}
