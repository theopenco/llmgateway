"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useApi, useFetchClient } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type Transaction =
	paths["/orgs/{id}/transactions"]["get"]["responses"]["200"]["content"]["application/json"]["transactions"][number];

const TYPE_LABELS: Partial<Record<Transaction["type"], string>> = {
	chat_plan_start: "Chat plan started",
	chat_plan_renewal: "Chat plan renewal",
	chat_plan_upgrade: "Chat plan upgrade",
	chat_plan_downgrade: "Chat plan downgrade",
	chat_plan_cancel: "Chat plan cancelled",
	chat_plan_end: "Chat plan ended",
	credit_topup: "Credit top-up",
	credit_refund: "Credit refund",
	credit_gift: "Credit gift",
	end_user_topup: "Credit top-up",
	end_user_refund: "Credit refund",
};

function typeLabel(type: Transaction["type"]): string {
	return TYPE_LABELS[type] ?? type;
}

// A transaction has a downloadable document when it is a completed, positive
// amount — a charge (invoice) or a refund (credit note). Mirrors
// isInvoiceableTransaction on the API.
function isInvoiceable(transaction: Transaction): boolean {
	return (
		transaction.status === "completed" &&
		transaction.amount !== null &&
		Number(transaction.amount) > 0
	);
}

function isRefund(type: Transaction["type"]): boolean {
	return type === "credit_refund" || type === "end_user_refund";
}

function formatAmount(amount: string | null, currency: string): string {
	if (amount === null) {
		return "—";
	}
	const value = Number(amount);
	if (!Number.isFinite(value)) {
		return "—";
	}
	if (currency === "USD") {
		return `$${value.toFixed(2)}`;
	}
	return `${value.toFixed(2)} ${currency}`;
}

function InvoiceDownloadButton({
	orgId,
	transaction,
}: {
	orgId: string;
	transaction: Transaction;
}) {
	const fetchClient = useFetchClient();
	const [loading, setLoading] = useState(false);

	const refund = isRefund(transaction.type);
	const label = refund ? "Credit note" : "Invoice";

	async function handleDownload() {
		setLoading(true);
		try {
			const { data, response } = await fetchClient.GET(
				"/orgs/{id}/transactions/{transactionId}/invoice",
				{
					params: { path: { id: orgId, transactionId: transaction.id } },
					parseAs: "blob",
				},
			);

			if (!response.ok || !data) {
				throw new Error("Failed to download document");
			}

			const url = URL.createObjectURL(data as unknown as Blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${refund ? "credit-note" : "invoice"}-${transaction.id}.pdf`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		} catch {
			toast.error(
				`Could not download ${label.toLowerCase()}. Please try again later.`,
			);
		} finally {
			setLoading(false);
		}
	}

	return (
		<Button
			variant="outline"
			size="sm"
			onClick={handleDownload}
			disabled={loading}
		>
			{loading ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : (
				<Download className="h-4 w-4" />
			)}
			<span className="sr-only sm:not-sr-only">{label}</span>
		</Button>
	);
}

export function ChatBillingHistory() {
	const api = useApi();

	const statusQuery = useQuery({
		...api.queryOptions("get", "/chat-plans/status"),
		staleTime: 30_000,
	});
	const orgId = statusQuery.data?.organizationId ?? null;

	const transactionsQuery = useQuery({
		...api.queryOptions("get", "/orgs/{id}/transactions", {
			params: { path: { id: orgId ?? "" } },
		}),
		enabled: Boolean(orgId),
	});

	const transactions = transactionsQuery.data?.transactions ?? [];

	if (!orgId || transactions.length === 0) {
		return null;
	}

	return (
		<section className="mx-auto mt-16 max-w-3xl">
			<h2 className="mb-1 text-base font-semibold text-foreground">
				Billing history
			</h2>
			<p className="mb-4 text-sm text-muted-foreground">
				Your chat plan and top-up charges. Download a PDF invoice for any
				purchase.
			</p>

			<div className="overflow-hidden rounded-xl border">
				<div className="hidden grid-cols-[1fr_1fr_auto_auto] gap-4 border-b bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground sm:grid">
					<div>Date</div>
					<div>Description</div>
					<div className="text-right">Amount</div>
					<div className="text-right">Invoice</div>
				</div>

				{transactions.map((transaction) => (
					<div
						key={transaction.id}
						className="grid grid-cols-2 gap-x-4 gap-y-1 border-b px-5 py-4 last:border-b-0 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center"
					>
						<div className="text-sm tabular-nums">
							{format(new Date(transaction.createdAt), "MMM d, yyyy")}
						</div>
						<div className="text-sm">
							<span>{typeLabel(transaction.type)}</span>
							{transaction.description && (
								<span className="block text-xs text-muted-foreground">
									{transaction.description}
								</span>
							)}
							{transaction.status !== "completed" && (
								<span className="mt-0.5 inline-block rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium capitalize text-muted-foreground">
									{transaction.status}
								</span>
							)}
						</div>
						<div className="text-right text-sm tabular-nums">
							<span className="text-xs text-muted-foreground sm:hidden">
								Amount{" "}
							</span>
							{formatAmount(transaction.amount, transaction.currency)}
						</div>
						<div className="col-span-2 mt-1 flex justify-end sm:col-span-1 sm:mt-0">
							{isInvoiceable(transaction) && (
								<InvoiceDownloadButton
									orgId={orgId}
									transaction={transaction}
								/>
							)}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
