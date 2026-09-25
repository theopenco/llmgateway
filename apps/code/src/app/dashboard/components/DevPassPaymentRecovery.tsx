"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/fetch-client";

export default function DevPassPaymentRecovery({
	cardUpdated = false,
}: {
	cardUpdated?: boolean;
}) {
	const api = useApi();
	const { data, isError, refetch, isFetching } = api.useQuery(
		"get",
		"/dev-plans/outstanding-invoice",
		{},
		{
			staleTime: 60_000,
			refetchInterval: 60_000,
			refetchOnWindowFocus: "always",
		},
	);

	if (!data?.invoice && !isError) {
		return null;
	}

	return (
		<div
			role="status"
			className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
		>
			<div className="flex min-w-0 gap-3">
				<AlertCircle
					aria-hidden="true"
					className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
				/>
				<div>
					<p className="font-semibold">
						{data?.invoice
							? "Payment overdue"
							: "Could not check payment status"}
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{data?.invoice
							? `${cardUpdated ? "Your card is saved, but payment is still outstanding. " : "Your renewal payment is outstanding. "}Complete payment to refresh your allowance.`
							: "Refresh payment status before assuming your renewal is paid."}
					</p>
					{data?.invoice && !data.invoice.url && (
						<p className="mt-1 text-sm text-muted-foreground">
							The payment link is unavailable. Update your card to retry, or
							contact support.
						</p>
					)}
				</div>
			</div>
			{data?.invoice?.url ? (
				<Button asChild size="sm">
					<a href={data.invoice.url} target="_blank" rel="noopener noreferrer">
						Complete payment
						<span className="sr-only"> (opens in a new tab)</span>
					</a>
				</Button>
			) : isError ? (
				<Button
					variant="outline"
					size="sm"
					disabled={isFetching}
					onClick={() => void refetch()}
				>
					Retry
				</Button>
			) : null}
		</div>
	);
}
