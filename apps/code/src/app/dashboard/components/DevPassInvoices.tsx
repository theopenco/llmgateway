"use client";

import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useApi, useFetchClient } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

const PAGE_SIZE = 10;

type Invoice =
	paths["/dev-plans/invoices"]["get"]["responses"]["200"]["content"]["application/json"]["invoices"][number];

// A DevPass invoice is downloadable when it is a completed, positive charge
// (mirrors isInvoiceableTransaction on the API).
function isInvoiceable(invoice: Invoice): boolean {
	return (
		invoice.status === "completed" &&
		invoice.amount !== null &&
		Number(invoice.amount) > 0
	);
}

function InvoiceDownloadButton({ invoice }: { invoice: Invoice }) {
	const fetchClient = useFetchClient();
	const [loading, setLoading] = useState(false);

	async function handleDownload() {
		setLoading(true);
		try {
			const { data, response } = await fetchClient.GET(
				"/dev-plans/invoices/{invoiceId}/pdf",
				{
					params: { path: { invoiceId: invoice.id } },
					parseAs: "blob",
				},
			);

			if (!response.ok || !data) {
				throw new Error("Failed to download invoice");
			}

			const url = URL.createObjectURL(data as unknown as Blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `invoice-${invoice.id}.pdf`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		} catch {
			toast.error("Could not download invoice. Please try again later.");
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
			<span className="sr-only sm:not-sr-only">Invoice</span>
		</Button>
	);
}

const TYPE_LABELS: Record<Invoice["type"], string> = {
	dev_plan_start: "Plan started",
	dev_plan_renewal: "Renewal",
	dev_plan_upgrade: "Upgrade",
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

function formatAmount(amount: string | null, currency: string): string {
	if (amount === null) {
		return "—";
	}
	const value = Number(amount);
	if (!Number.isFinite(value)) {
		return "—";
	}
	if (currency === "USD") {
		return currencyFormatter.format(value);
	}
	return `${value.toFixed(2)} ${currency}`;
}

function formatCredits(creditAmount: string | null): string {
	if (creditAmount === null) {
		return "—";
	}
	const value = Number(creditAmount);
	if (!Number.isFinite(value)) {
		return "—";
	}
	return `$${value.toFixed(2)}`;
}

export default function DevPassInvoices() {
	const api = useApi();
	const { data } = api.useQuery("get", "/dev-plans/invoices", {});
	const [page, setPage] = useState(0);

	if (!data || data.invoices.length === 0) {
		return null;
	}

	const pageCount = Math.ceil(data.invoices.length / PAGE_SIZE);
	const currentPage = Math.min(page, pageCount - 1);
	const pageStart = currentPage * PAGE_SIZE;
	const pageInvoices = data.invoices.slice(pageStart, pageStart + PAGE_SIZE);

	return (
		<div>
			<h2 className="mb-1 font-semibold">Invoices</h2>
			<p className="mb-4 text-sm text-muted-foreground">
				A record of every DevPass charge, including the amount debited and the
				usage credits granted for that billing period.
			</p>

			<div className="overflow-hidden rounded-xl border">
				<div className="hidden grid-cols-[1fr_1fr_auto_auto_auto] gap-4 border-b bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground sm:grid">
					<div>Date</div>
					<div>Description</div>
					<div className="text-right">Amount debited</div>
					<div className="text-right">Credits granted</div>
					<div className="text-right">Invoice</div>
				</div>

				{pageInvoices.map((invoice) => (
					<div
						key={invoice.id}
						className="grid grid-cols-2 gap-x-4 gap-y-1 border-b px-5 py-4 last:border-b-0 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-center"
					>
						<div className="text-sm tabular-nums">
							{format(new Date(invoice.date), "MMM d, yyyy")}
						</div>
						<div className="text-sm">
							<span>{TYPE_LABELS[invoice.type]}</span>
							{invoice.description && (
								<span className="block text-xs text-muted-foreground">
									{invoice.description}
								</span>
							)}
							{invoice.status !== "completed" && (
								<span className="mt-0.5 inline-block rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium capitalize text-muted-foreground">
									{invoice.status}
								</span>
							)}
						</div>
						<div className="text-right text-sm tabular-nums sm:text-right">
							<span className="text-xs text-muted-foreground sm:hidden">
								Amount{" "}
							</span>
							{formatAmount(invoice.amount, invoice.currency)}
						</div>
						<div className="text-right text-sm tabular-nums text-muted-foreground sm:text-right">
							<span className="text-xs sm:hidden">Credits </span>
							{formatCredits(invoice.creditAmount)}
						</div>
						<div className="col-span-2 mt-1 flex justify-end sm:col-span-1 sm:mt-0">
							{isInvoiceable(invoice) && (
								<InvoiceDownloadButton invoice={invoice} />
							)}
						</div>
					</div>
				))}
			</div>

			{pageCount > 1 && (
				<div className="mt-4 flex items-center justify-between">
					<p className="text-xs text-muted-foreground">
						Page {currentPage + 1} of {pageCount}
					</p>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage(currentPage - 1)}
							disabled={currentPage === 0}
						>
							<ChevronLeft className="mr-1 h-4 w-4" />
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage(currentPage + 1)}
							disabled={currentPage >= pageCount - 1}
						>
							Next
							<ChevronRight className="ml-1 h-4 w-4" />
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
