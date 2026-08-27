"use client";

import {
	AlertTriangle,
	CreditCard,
	Loader2,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export interface AdminPaymentMethod {
	id: string;
	type: string;
	createdAt: string;
	isDefault: boolean;
	canReleaseDevPlanCardFingerprint: boolean;
	card: {
		brand: string;
		last4: string;
		expiryMonth: number;
		expiryYear: number;
	} | null;
}

interface DeletePaymentMethodDialogProps {
	paymentMethod: AdminPaymentMethod;
	paymentMethods: AdminPaymentMethod[];
	autoTopUpEnabled: boolean;
	onDelete: (
		paymentMethodId: string,
		replacementPaymentMethodId?: string,
		releaseDevPlanCardFingerprint?: boolean,
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
	paymentMethods,
	autoTopUpEnabled,
	onDelete,
}: DeletePaymentMethodDialogProps) {
	const router = useRouter();
	const replacementOptions = paymentMethods.filter(
		(candidate) => candidate.id !== paymentMethod.id,
	);
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [replacementPaymentMethodId, setReplacementPaymentMethodId] = useState(
		replacementOptions[0]?.id ?? "",
	);
	const [releaseDevPlanCardFingerprint, setReleaseDevPlanCardFingerprint] =
		useState(false);
	const label = paymentMethodLabel(paymentMethod);
	const requiresReplacement =
		paymentMethod.isDefault && replacementOptions.length > 0;

	const handleDelete = async () => {
		setLoading(true);
		setError(null);

		try {
			const result = await onDelete(
				paymentMethod.id,
				requiresReplacement ? replacementPaymentMethodId : undefined,
				releaseDevPlanCardFingerprint,
			);
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
				if (nextOpen) {
					setError(null);
					setReplacementPaymentMethodId(replacementOptions[0]?.id ?? "");
					setReleaseDevPlanCardFingerprint(false);
				}
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
						removes its local saved-method reference. This action cannot be
						undone.
					</DialogDescription>
				</DialogHeader>

				{requiresReplacement ? (
					<div className="space-y-2">
						<Label htmlFor={`replacement-${paymentMethod.id}`}>
							Replacement default
						</Label>
						<p className="text-sm text-muted-foreground">
							This method is currently a default. Choose another attached
							payment method for Stripe and future charges before deleting it.
						</p>
						<Select
							value={replacementPaymentMethodId}
							onValueChange={setReplacementPaymentMethodId}
							disabled={loading}
						>
							<SelectTrigger
								id={`replacement-${paymentMethod.id}`}
								className="w-full"
							>
								<SelectValue placeholder="Select a replacement" />
							</SelectTrigger>
							<SelectContent>
								{replacementOptions.map((replacement) => (
									<SelectItem key={replacement.id} value={replacement.id}>
										{paymentMethodLabel(replacement)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : paymentMethod.isDefault ? (
					<p className="text-sm text-muted-foreground">
						No replacement remains. Stripe customer and subscription defaults
						will be cleared, so renewals may fail until another payment method
						is added.
					</p>
				) : null}

				{autoTopUpEnabled ? (
					<div
						className="flex gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:bg-amber-950/50 dark:text-amber-100"
						role="note"
					>
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<p>
							{replacementOptions.length === 0
								? "Auto top-up is enabled and will be disabled because no payment method remains."
								: paymentMethod.isDefault
									? "Auto top-up is enabled. Future automatic top-ups will use the selected replacement."
									: "Auto top-up is enabled. This payment method is not currently a default, so automatic top-ups will keep using the existing default."}
						</p>
					</div>
				) : null}

				{paymentMethod.canReleaseDevPlanCardFingerprint ? (
					<div className="flex items-start gap-3 rounded-md border px-3 py-3">
						<Checkbox
							id={`release-devpass-fingerprint-${paymentMethod.id}`}
							checked={releaseDevPlanCardFingerprint}
							onCheckedChange={(checked) =>
								setReleaseDevPlanCardFingerprint(checked === true)
							}
							disabled={loading}
						/>
						<div className="space-y-1">
							<Label
								htmlFor={`release-devpass-fingerprint-${paymentMethod.id}`}
							>
								Release DevPass card fingerprint
							</Label>
							<p className="text-xs text-muted-foreground">
								Allow this card to be used on another DevPass account. Use only
								for a verified account transfer; this bypasses the
								one-card-per-account safeguard.
							</p>
						</div>
					</div>
				) : null}

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
						disabled={
							loading || (requiresReplacement && !replacementPaymentMethodId)
						}
					>
						{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
						{releaseDevPlanCardFingerprint
							? "Delete and release card"
							: "Delete payment method"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function PaymentMethodsList({
	paymentMethods,
	loadError,
	autoTopUpEnabled,
	onDelete,
}: {
	paymentMethods: AdminPaymentMethod[] | null;
	loadError: boolean;
	autoTopUpEnabled: boolean;
	onDelete: (
		paymentMethodId: string,
		replacementPaymentMethodId?: string,
		releaseDevPlanCardFingerprint?: boolean,
	) => Promise<{ success: boolean; error?: string }>;
}) {
	const router = useRouter();

	return (
		<section className="space-y-3 border-t pt-6 md:col-span-2">
			<div>
				<h3 className="text-sm font-medium">Payment methods</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					Methods attached to the Stripe customer. Their details live in Stripe;
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
									<div className="flex flex-wrap items-center gap-2">
										<p className="text-sm font-medium">{label}</p>
										{paymentMethod.isDefault ? (
											<Badge variant="secondary">Default</Badge>
										) : null}
									</div>
									<p className="mt-1 break-all font-mono text-xs text-muted-foreground">
										{paymentMethod.card
											? `Expires ${String(paymentMethod.card.expiryMonth).padStart(2, "0")}/${String(paymentMethod.card.expiryYear).slice(-2)} · `
											: ""}
										{paymentMethod.id}
									</p>
								</div>
								<DeletePaymentMethodDialog
									paymentMethod={paymentMethod}
									paymentMethods={paymentMethods}
									autoTopUpEnabled={autoTopUpEnabled}
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
