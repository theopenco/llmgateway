"use client";

import { format } from "date-fns";

import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type Invoice =
	paths["/dev-plans/invoices"]["get"]["responses"]["200"]["content"]["application/json"]["invoices"][number];

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
	const value = Number(amount ?? 0);
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

	if (!data || data.invoices.length === 0) {
		return null;
	}

	return (
		<div>
			<h2 className="mb-1 font-semibold">Invoices</h2>
			<p className="mb-4 text-sm text-muted-foreground">
				A record of every DevPass charge, including the amount debited and the
				usage credits granted for that billing period.
			</p>

			<div className="overflow-hidden rounded-xl border">
				<div className="hidden grid-cols-[1fr_1fr_auto_auto] gap-4 border-b bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground sm:grid">
					<div>Date</div>
					<div>Description</div>
					<div className="text-right">Amount debited</div>
					<div className="text-right">Credits granted</div>
				</div>

				{data.invoices.map((invoice) => (
					<div
						key={invoice.id}
						className="grid grid-cols-2 gap-x-4 gap-y-1 border-b px-5 py-4 last:border-b-0 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center"
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
					</div>
				))}
			</div>
		</div>
	);
}
