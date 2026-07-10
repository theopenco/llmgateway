"use client";

import { format } from "date-fns";
import { Download, Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useIsMobile } from "@/hooks/use-mobile";
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
} from "@/lib/components/alert-dialog";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { useToast } from "@/lib/components/use-toast";
import { useFetchClient } from "@/lib/fetch-client";

interface RefundEligibility {
	eligible: boolean;
	reason?:
		| "unsupported_type"
		| "not_completed"
		| "already_refunded"
		| "window_expired"
		| "not_owner"
		| "not_latest_purchase"
		| "plan_inactive"
		| "credits_frozen"
		| "usage_exceeded";
}

interface Transaction {
	id: string;
	createdAt: string;
	type:
		| "credit_refund"
		| "credit_topup"
		| "credit_gift"
		| "subscription_start"
		| "subscription_cancel"
		| "subscription_end";
	creditAmount: string | null;
	amount: string | null;
	status: "pending" | "completed" | "failed";
	description: string | null;
	refund?: RefundEligibility;
}

const REFUND_INELIGIBILITY_COPY: Record<
	NonNullable<RefundEligibility["reason"]>,
	string
> = {
	unsupported_type: "This transaction cannot be refunded",
	not_completed: "Only completed payments can be refunded",
	already_refunded: "This purchase has already been refunded",
	window_expired: "Refunds are available for 14 days after purchase",
	not_owner: "Only the organization owner can request a refund",
	not_latest_purchase: "Only your most recent purchase can be self-refunded",
	plan_inactive: "The plan for this payment is no longer active",
	credits_frozen: "Refunds are unavailable while credits are frozen",
	usage_exceeded: "More than 10% of these credits have been used",
};

function RefundButton({
	orgId,
	transaction,
}: {
	orgId: string;
	transaction: Transaction;
}) {
	const fetchClient = useFetchClient();
	const router = useRouter();
	const { toast } = useToast();
	const [loading, setLoading] = useState(false);

	const refund = transaction.refund;
	if (!refund) {
		return null;
	}

	async function handleRefund() {
		setLoading(true);
		try {
			const { response } = await fetchClient.POST(
				"/orgs/{id}/transactions/{transactionId}/refund",
				{
					params: { path: { id: orgId, transactionId: transaction.id } },
				},
			);
			if (!response.ok) {
				throw new Error("Refund request failed");
			}
			toast({
				title: "Refund processing",
				description:
					"Your refund has been submitted and will appear in your transaction history shortly.",
			});
			router.refresh();
		} catch {
			toast({
				title: "Could not process refund",
				description: "Please try again later or contact support.",
				variant: "destructive",
			});
		} finally {
			setLoading(false);
		}
	}

	if (!refund.eligible) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						{/* span wrapper so the tooltip works on a disabled button */}
						<span tabIndex={0}>
							<Button variant="outline" size="sm" disabled>
								<Undo2 className="h-4 w-4" />
								Refund
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent>
						{REFUND_INELIGIBILITY_COPY[refund.reason ?? "unsupported_type"]}
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		);
	}

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button variant="outline" size="sm" disabled={loading}>
					{loading ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Undo2 className="h-4 w-4" />
					)}
					Refund
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Refund this purchase?</AlertDialogTitle>
					<AlertDialogDescription>
						${Number(transaction.amount ?? 0).toFixed(2)} will be refunded to
						your original payment method and{" "}
						{Number(transaction.creditAmount ?? 0).toFixed(2)} credits will be
						removed from your balance. This cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={handleRefund}>
						Request refund
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

interface TransactionsData {
	transactions: Transaction[];
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
	return type === "credit_refund";
}

// Refunds move money back to the customer, so show the paid amount as negative
// — matching the already-signed Credits column. The stored `amount` stays
// positive (it feeds invoice/credit-note generation).
function paidAmountDisplay(transaction: Transaction): string {
	if (transaction.amount === null) {
		return "—";
	}
	return isRefund(transaction.type)
		? `-${transaction.amount}`
		: transaction.amount;
}

function InvoiceDownloadButton({
	orgId,
	transaction,
}: {
	orgId: string;
	transaction: Transaction;
}) {
	const fetchClient = useFetchClient();
	const { toast } = useToast();
	const [loading, setLoading] = useState(false);

	if (!isInvoiceable(transaction)) {
		return null;
	}

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
			toast({
				title: `Could not download ${label.toLowerCase()}`,
				description: "Please try again later.",
				variant: "destructive",
			});
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
			{label}
		</Button>
	);
}

function TransactionCard({
	transaction,
	orgId,
}: {
	transaction: Transaction;
	orgId: string;
}) {
	const getTypeLabel = (type: Transaction["type"]) => {
		switch (type) {
			case "credit_topup":
				return "Credit Top-up";
			case "credit_refund":
				return "Credit Refund";
			case "credit_gift":
				return "Credit Gift";
			case "subscription_start":
				return "Subscription Start";
			case "subscription_cancel":
				return "Subscription Cancelled";
			case "subscription_end":
				return "Subscription Ended";
			default:
				return type;
		}
	};

	const getStatusColor = (status: Transaction["status"]) => {
		switch (status) {
			case "completed":
				return "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400";
			case "pending":
				return "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400";
			case "failed":
				return "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400";
			default:
				return "bg-gray-50 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400";
		}
	};

	return (
		<Card className="p-4">
			<div className="space-y-3">
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<p className="font-medium text-sm">
							{getTypeLabel(transaction.type)}
						</p>
						<p className="text-xs text-muted-foreground">
							{format(new Date(transaction.createdAt), "MMM d, yyyy HH:mm")}
						</p>
					</div>
					<Badge className={`text-xs ${getStatusColor(transaction.status)}`}>
						{transaction.status}
					</Badge>
				</div>

				<div className="grid grid-cols-2 gap-4 text-sm">
					{transaction.creditAmount && (
						<div>
							<p className="text-muted-foreground text-xs">Credits</p>
							<p className="font-medium">{transaction.creditAmount}</p>
						</div>
					)}
					{transaction.amount && (
						<div>
							<p className="text-muted-foreground text-xs">Total Paid</p>
							<p className="font-medium">{paidAmountDisplay(transaction)}</p>
						</div>
					)}
				</div>

				{transaction.description && (
					<div>
						<p className="text-muted-foreground text-xs">Description</p>
						<p className="text-sm">{transaction.description}</p>
					</div>
				)}

				{(isInvoiceable(transaction) || transaction.refund) && (
					<div className="pt-1 flex gap-2">
						<InvoiceDownloadButton orgId={orgId} transaction={transaction} />
						<RefundButton orgId={orgId} transaction={transaction} />
					</div>
				)}
			</div>
		</Card>
	);
}

export function TransactionsClient({
	data,
	orgId,
}: {
	data: TransactionsData;
	orgId: string;
}) {
	const isMobile = useIsMobile();

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						Transactions
					</h2>
				</div>
				<Card>
					<CardHeader>
						<CardTitle>Transaction History</CardTitle>
						<CardDescription>
							View your organization&apos;s transaction history, including
							credit top-ups and subscription events.
						</CardDescription>
					</CardHeader>
					<CardContent className={isMobile ? "p-4" : ""}>
						{isMobile ? (
							// Mobile card layout
							<div className="space-y-4">
								{data.transactions.length === 0 ? (
									<div className="text-center py-8 text-muted-foreground">
										No transactions found
									</div>
								) : (
									data.transactions.map((transaction) => (
										<TransactionCard
											key={transaction.id}
											transaction={transaction}
											orgId={orgId}
										/>
									))
								)}
							</div>
						) : (
							// Desktop table layout
							<div className="rounded-md border overflow-x-auto">
								<table className="w-full">
									<thead>
										<tr className="border-b bg-muted/50">
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Date
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Type
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Credits
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Total Paid
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Status
											</th>
											<th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">
												Description
											</th>
											<th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground whitespace-nowrap">
												Invoice
											</th>
										</tr>
									</thead>
									<tbody>
										{data.transactions.map((transaction) => (
											<tr
												key={transaction.id}
												className="border-b hover:bg-muted/50 transition-colors"
											>
												<td className="p-4 align-middle whitespace-nowrap">
													{format(
														new Date(transaction.createdAt),
														"MMM d, yyyy HH:mm",
													)}
												</td>
												<td className="p-4 align-middle whitespace-nowrap">
													{transaction.type === "credit_topup" &&
														"Credit Top-up"}
													{transaction.type === "credit_refund" &&
														"Credit Refund"}
													{transaction.type === "credit_gift" && "Credit Gift"}
													{transaction.type === "subscription_start" &&
														"Subscription Start"}
													{transaction.type === "subscription_cancel" &&
														"Subscription Cancelled"}
													{transaction.type === "subscription_end" &&
														"Subscription Ended"}
												</td>
												<td className="p-4 align-middle whitespace-nowrap">
													{transaction.creditAmount ?? "—"}
												</td>
												<td className="p-4 align-middle whitespace-nowrap">
													{paidAmountDisplay(transaction)}
												</td>
												<td className="p-4 align-middle whitespace-nowrap">
													<Badge
														className={`text-xs ${
															transaction.status === "completed"
																? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
																: transaction.status === "pending"
																	? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
																	: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
														}`}
													>
														{transaction.status}
													</Badge>
												</td>
												<td className="p-4 align-middle text-sm text-muted-foreground max-w-xs truncate">
													{transaction.description ?? "—"}
												</td>
												<td className="p-4 align-middle whitespace-nowrap text-right">
													{isInvoiceable(transaction) || transaction.refund ? (
														<div className="flex justify-end gap-2">
															<InvoiceDownloadButton
																orgId={orgId}
																transaction={transaction}
															/>
															<RefundButton
																orgId={orgId}
																transaction={transaction}
															/>
														</div>
													) : (
														"—"
													)}
												</td>
											</tr>
										))}
										{data.transactions.length === 0 && (
											<tr>
												<td
													colSpan={7}
													className="p-8 text-center text-muted-foreground"
												>
													No transactions found
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
