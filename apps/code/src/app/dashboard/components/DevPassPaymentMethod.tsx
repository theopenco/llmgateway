"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
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

import type { paths } from "@/lib/api/v1";

type PaymentMethod =
	paths["/dev-plans/payment-method"]["get"]["responses"]["200"]["content"]["application/json"];

// The Stripe React bindings only matter once the user opens the card form, so
// keep them out of the billing page chunk.
const UpdateCardForm = dynamic(() => import("./DevPassUpdateCardForm"), {
	ssr: false,
	loading: () => (
		<div className="flex items-center gap-2 text-sm text-muted-foreground">
			<Loader2 className="h-4 w-4 animate-spin" />
			Loading payment form…
		</div>
	),
});

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
